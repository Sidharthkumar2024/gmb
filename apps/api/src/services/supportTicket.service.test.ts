import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketAuthor, TicketPriority, TicketStatus } from "@nexaflow/db";

// Support tickets: customer calls are tenant-scoped (a foreign id 404s), admin
// calls (tenantId null) span all tenants, empty subject/body/reply is rejected,
// and a reply appends a message + stamps lastReply* in one transaction.

const deps = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  msgCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return {
    ...actual,
    prisma: {
      supportTicket: {
        create: deps.create,
        findMany: deps.findMany,
        findFirst: deps.findFirst,
        findUnique: deps.findUnique,
        update: deps.update,
      },
      supportTicketMessage: { create: deps.msgCreate },
      $transaction: deps.transaction,
    },
  };
});

import { createTicket, getTicket, replyToTicket, updateTicket } from "./supportTicket.service";

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tk-1",
    tenantId: "t1",
    subject: "Help",
    status: TicketStatus.PENDING,
    priority: TicketPriority.NORMAL,
    lastReplyAt: new Date("2026-01-01T00:00:00Z"),
    lastReplyBy: TicketAuthor.CUSTOMER,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    tenant: { name: "Acme" },
    messages: [],
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("createTicket", () => {
  it("rejects a blank subject or body (400)", async () => {
    await expect(createTicket({ tenantId: "t1", subject: "  ", body: "b" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(createTicket({ tenantId: "t1", subject: "s", body: "  " })).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("creates the ticket with a trimmed first CUSTOMER message and default priority", async () => {
    deps.create.mockResolvedValue(ticketRow());
    await createTicket({ tenantId: "t1", subject: "  Help  ", body: "  please  " });
    const data = deps.create.mock.calls[0][0].data;
    expect(data.subject).toBe("Help");
    expect(data.priority).toBe(TicketPriority.NORMAL);
    expect(data.lastReplyBy).toBe(TicketAuthor.CUSTOMER);
    expect(data.messages.create.body).toBe("please");
    expect(data.messages.create.author).toBe(TicketAuthor.CUSTOMER);
  });
});

describe("getTicket scope isolation", () => {
  it("scopes the lookup by tenant for a customer caller", async () => {
    deps.findFirst.mockResolvedValue(ticketRow());
    await getTicket("tk-1", "t1");
    expect(deps.findFirst.mock.calls[0][0].where).toEqual({ id: "tk-1", tenantId: "t1" });
  });

  it("omits the tenant filter for an admin caller (null)", async () => {
    deps.findFirst.mockResolvedValue(ticketRow());
    await getTicket("tk-1", null);
    expect(deps.findFirst.mock.calls[0][0].where).toEqual({ id: "tk-1" });
  });

  it("404s when the ticket is missing or out of scope", async () => {
    deps.findFirst.mockResolvedValue(null);
    await expect(getTicket("tk-x", "t1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("replyToTicket", () => {
  it("rejects an empty body (400)", async () => {
    await expect(
      replyToTicket({ ticketId: "tk-1", tenantId: "t1", author: TicketAuthor.CUSTOMER, body: "   " }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s when the ticket isn't in the caller's scope", async () => {
    deps.findFirst.mockResolvedValue(null); // ownership check fails
    await expect(
      replyToTicket({ ticketId: "tk-x", tenantId: "t1", author: TicketAuthor.CUSTOMER, body: "hi" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("appends a message and stamps lastReply* + PENDING in one transaction", async () => {
    deps.findFirst
      .mockResolvedValueOnce({ id: "tk-1", status: TicketStatus.RESOLVED }) // ownership check
      .mockResolvedValueOnce(ticketRow({ lastReplyBy: TicketAuthor.STAFF })); // final getTicket read
    deps.transaction.mockResolvedValue([]);
    await replyToTicket({ ticketId: "tk-1", tenantId: null, author: TicketAuthor.STAFF, body: "on it" });

    expect(deps.transaction).toHaveBeenCalledOnce();
    expect(deps.msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ author: TicketAuthor.STAFF, body: "on it" }) }),
    );
    const updateData = deps.update.mock.calls[0][0].data;
    expect(updateData.lastReplyBy).toBe(TicketAuthor.STAFF);
    expect(updateData.status).toBe(TicketStatus.PENDING);
    expect(updateData.lastReplyAt).toBeInstanceOf(Date);
  });
});

describe("updateTicket", () => {
  it("404s when the ticket doesn't exist", async () => {
    deps.findUnique.mockResolvedValue(null);
    await expect(updateTicket("tk-x", { status: TicketStatus.RESOLVED })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("applies only the provided status/priority patch", async () => {
    deps.findUnique.mockResolvedValue({ id: "tk-1" });
    deps.update.mockResolvedValue(ticketRow({ status: TicketStatus.RESOLVED }));
    await updateTicket("tk-1", { status: TicketStatus.RESOLVED });
    expect(deps.update.mock.calls[0][0].data).toEqual({ status: TicketStatus.RESOLVED });
  });
});
