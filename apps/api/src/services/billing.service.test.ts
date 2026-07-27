import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked-Prisma unit tests for the credit engine. The reserve/settle/release/
// grant paths are gated behind WALLET_BILLING_ENABLED and dormant in the app, so
// these are the only exercise of the money math before billing is switched on.

const deps = vi.hoisted(() => ({
  walletFindFirst: vi.fn(),
  walletCreate: vi.fn(),
  walletTxnFindUnique: vi.fn(),
  txExecuteRaw: vi.fn(),
  txWalletUpdate: vi.fn(),
  txWalletFindUniqueOrThrow: vi.fn(),
  txWalletTxnCreate: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  const tx = {
    $executeRaw: deps.txExecuteRaw,
    wallet: {
      update: deps.txWalletUpdate,
      findUniqueOrThrow: deps.txWalletFindUniqueOrThrow,
    },
    walletTransaction: { create: deps.txWalletTxnCreate },
  };
  return {
    ...actual,
    prisma: {
      wallet: { findFirst: deps.walletFindFirst, create: deps.walletCreate },
      walletTransaction: { findUnique: deps.walletTxnFindUnique },
      // Run the interactive-transaction callback against the mock tx client.
      $transaction: (fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx)),
    },
  };
});

import {
  resolveAiCostCredits,
  reserveAi,
  settleAi,
  releaseAi,
  grantCredits,
} from "./billing.service";

const ON = () => (process.env.WALLET_BILLING_ENABLED = "true");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WALLET_BILLING_ENABLED;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("AI_COST_")) delete process.env[k];
  }
});
afterEach(() => {
  delete process.env.WALLET_BILLING_ENABLED;
});

describe("resolveAiCostCredits", () => {
  it("defaults unknown features to 1 credit", () => {
    expect(resolveAiCostCredits("nope")).toBe(1);
    expect(resolveAiCostCredits()).toBe(1);
  });

  it("uses the per-feature table", () => {
    expect(resolveAiCostCredits("gmb_image_generation")).toBe(5);
    expect(resolveAiCostCredits("gmb_ranking_advisor")).toBe(3);
  });

  it("rounds a fractional env override to a whole credit", () => {
    process.env.AI_COST_GMB_REVIEW_REPLY = "2.6";
    expect(resolveAiCostCredits("gmb_review_reply")).toBe(3);
    process.env.AI_COST_GMB_REVIEW_REPLY = "0.4";
    expect(resolveAiCostCredits("gmb_review_reply")).toBe(0);
  });

  it("ignores a negative override", () => {
    process.env.AI_COST_GMB_POST_CAPTION = "-5";
    expect(resolveAiCostCredits("gmb_post_caption")).toBe(1); // falls back to table
  });
});

describe("reserveAi", () => {
  it("no-ops (null) when billing is disabled", async () => {
    await expect(reserveAi("t1", "gmb_review_reply")).resolves.toBeNull();
    expect(deps.walletFindFirst).not.toHaveBeenCalled();
  });

  it("throws 402 when the tenant has no wallet", async () => {
    ON();
    deps.walletFindFirst.mockResolvedValue(null);
    await expect(reserveAi("t1", "gmb_review_reply")).rejects.toMatchObject({ statusCode: 402 });
  });

  it("throws 402 when the guarded UPDATE holds nothing (insufficient balance)", async () => {
    ON();
    deps.walletFindFirst.mockResolvedValue({ id: "w1" });
    deps.txExecuteRaw.mockResolvedValue(0); // held count
    await expect(reserveAi("t1", "gmb_review_reply")).rejects.toMatchObject({ statusCode: 402 });
    expect(deps.txWalletTxnCreate).not.toHaveBeenCalled();
  });

  it("holds credits and records a RESERVE row on success", async () => {
    ON();
    deps.walletFindFirst.mockResolvedValue({ id: "w1" });
    deps.txExecuteRaw.mockResolvedValue(1);
    deps.txWalletFindUniqueOrThrow.mockResolvedValue({ balanceCredits: 50 });
    const r = await reserveAi("t1", "gmb_image_generation");
    expect(r).toEqual({ walletId: "w1", tenantId: "t1", feature: "gmb_image_generation", cost: 5 });
    expect(deps.txWalletTxnCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: "w1",
        tenantId: "t1",
        type: "RESERVE",
        deltaCredits: 0,
        deltaReserved: 5,
        balanceAfter: 50,
      }),
    });
  });
});

describe("settleAi / releaseAi", () => {
  it("settle no-ops on a null reservation", async () => {
    await settleAi(null);
    expect(deps.txWalletUpdate).not.toHaveBeenCalled();
  });

  it("settle decrements balance and reserved and records SETTLE", async () => {
    deps.txWalletUpdate.mockResolvedValue({ balanceCredits: 45 });
    await settleAi({ walletId: "w1", tenantId: "t1", feature: "f", cost: 5 }, { aiUsageId: "u1" });
    expect(deps.txWalletUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { balanceCredits: { decrement: 5 }, reservedCredits: { decrement: 5 } },
      select: { balanceCredits: true },
    });
    expect(deps.txWalletTxnCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "SETTLE", deltaCredits: -5, deltaReserved: -5, balanceAfter: 45, aiUsageId: "u1" }),
    });
  });

  it("release returns only the reserved hold and records RELEASE", async () => {
    deps.txWalletUpdate.mockResolvedValue({ balanceCredits: 50 });
    await releaseAi({ walletId: "w1", tenantId: "t1", feature: "f", cost: 5 });
    expect(deps.txWalletUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { reservedCredits: { decrement: 5 } },
      select: { balanceCredits: true },
    });
    expect(deps.txWalletTxnCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "RELEASE", deltaCredits: 0, deltaReserved: -5, balanceAfter: 50 }),
    });
  });
});

describe("grantCredits", () => {
  it("no-ops on non-positive credits", async () => {
    await grantCredits("t1", 0);
    expect(deps.walletFindFirst).not.toHaveBeenCalled();
  });

  it("provisions a wallet when the tenant has none, then credits it", async () => {
    deps.walletFindFirst.mockResolvedValue(null);
    deps.walletCreate.mockResolvedValue({ id: "w_new" });
    deps.walletTxnFindUnique.mockResolvedValue(null);
    deps.txWalletUpdate.mockResolvedValue({ balanceCredits: 100 });
    await grantCredits("t1", 100, { idempotencyKey: "razorpay:pay_new" });
    expect(deps.walletCreate).toHaveBeenCalledWith({ data: { tenantId: "t1" }, select: { id: true } });
    expect(deps.txWalletUpdate).toHaveBeenCalledWith({
      where: { id: "w_new" },
      data: { balanceCredits: { increment: 100 } },
      select: { balanceCredits: true },
    });
  });

  it("is idempotent — a seen idempotencyKey short-circuits", async () => {
    deps.walletFindFirst.mockResolvedValue({ id: "w1" });
    deps.walletTxnFindUnique.mockResolvedValue({ id: "existing" });
    await grantCredits("t1", 100, { idempotencyKey: "razorpay:pay_1" });
    expect(deps.txWalletUpdate).not.toHaveBeenCalled();
  });

  it("increments the wallet and records a GRANT row", async () => {
    deps.walletFindFirst.mockResolvedValue({ id: "w1" });
    deps.walletTxnFindUnique.mockResolvedValue(null);
    deps.txWalletUpdate.mockResolvedValue({ balanceCredits: 600 });
    await grantCredits("t1", 500, { reason: "top-up", idempotencyKey: "razorpay:pay_2" });
    expect(deps.txWalletUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { balanceCredits: { increment: 500 } },
      select: { balanceCredits: true },
    });
    expect(deps.txWalletTxnCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "GRANT", deltaCredits: 500, balanceAfter: 600, idempotencyKey: "razorpay:pay_2" }),
    });
  });

  it("swallows a P2002 race (concurrent duplicate grant)", async () => {
    deps.walletFindFirst.mockResolvedValue({ id: "w1" });
    deps.walletTxnFindUnique.mockResolvedValue(null);
    deps.txWalletUpdate.mockRejectedValue({ code: "P2002" });
    await expect(grantCredits("t1", 500, { idempotencyKey: "k" })).resolves.toBeUndefined();
  });
});
