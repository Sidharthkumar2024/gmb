import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, tokenStore } from "./api";

// Node env (no jsdom): api.ts guards every localStorage access with
// `typeof window`, so a minimal window stub is enough to exercise tokenStore.
const store = new Map<string, string>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ok = <T>(data: T) => ({ success: true, data });
const err = (message: string) => ({ success: false, error: { code: "UNAUTHORIZED", message } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  };
  tokenStore.set({ accessToken: "access-old", refreshToken: "refresh-1", expiresIn: 3600 });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("api client — silent token refresh", () => {
  it("refreshes on a 401 and retries the original request once", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, err("expired")))
      .mockResolvedValueOnce(jsonResponse(200, ok({ accessToken: "access-new", refreshToken: "refresh-2" })))
      .mockResolvedValueOnce(jsonResponse(200, ok({ value: 42 })));

    const data = await api.get<{ value: number }>("/api/v1/thing");

    expect(data).toEqual({ value: 42 });
    expect(tokenStore.getAccess()).toBe("access-new");
    expect(tokenStore.getRefresh()).toBe("refresh-2");
    expect(fetchMock).toHaveBeenCalledTimes(3); // original → refresh → retry
    // the retry carried the rotated access token
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1].headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer access-new");
  });

  it("shares a single refresh across concurrent 401s", async () => {
    let refreshCalls = 0;
    const seen = new Set<string>();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/auth/refresh")) {
        refreshCalls += 1;
        return Promise.resolve(jsonResponse(200, ok({ accessToken: "access-new", refreshToken: "refresh-2" })));
      }
      if (!seen.has(url)) {
        seen.add(url);
        return Promise.resolve(jsonResponse(401, err("expired")));
      }
      return Promise.resolve(jsonResponse(200, ok({ url })));
    });

    await Promise.all([api.get("/api/v1/a"), api.get("/api/v1/b")]);

    expect(refreshCalls).toBe(1);
  });

  it("clears tokens and propagates the error when refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, err("expired")))
      .mockResolvedValueOnce(jsonResponse(401, err("refresh dead")));

    await expect(api.get("/api/v1/thing")).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
  });

  it("does not refresh-loop on authed auth endpoints (e.g. logout)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, err("bad")));

    await expect(api.post("/api/v1/auth/logout", { refreshToken: "r" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no /auth/refresh attempt
  });

  it("refreshes on a 401 from /auth/me (the session-establishing read), not just app calls", async () => {
    // Regression: /auth/me must NOT be lumped in with refresh/login/logout — an
    // expired access token on the shell's first read has to refresh silently
    // rather than bounce the user to /login.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, err("expired"))) // /auth/me
      .mockResolvedValueOnce(jsonResponse(200, ok({ accessToken: "access-new", refreshToken: "refresh-2" }))) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, ok({ user: { id: "u1" } }))); // /auth/me retry

    const data = await api.get<{ user: { id: string } }>("/api/v1/auth/me");

    expect(data).toEqual({ user: { id: "u1" } });
    expect(tokenStore.getAccess()).toBe("access-new");
    expect(fetchMock).toHaveBeenCalledTimes(3); // me → refresh → me retry
    expect((fetchMock.mock.calls[1][0] as string)).toContain("/api/v1/auth/refresh");
  });

  it("skips a redundant refresh for a request already in flight during a refresh", async () => {
    // Monotonic clock so the burst ordering (B starts, refresh completes, B's
    // 401 arrives) is deterministic rather than same-millisecond flaky.
    let clock = 1000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock++);
    let refreshCalls = 0;
    let bHit = false;
    let aHit = false;
    let releaseB!: (r: Response) => void;
    const bFirst = new Promise<Response>((res) => {
      releaseB = res;
    });

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/auth/refresh")) {
        refreshCalls += 1;
        return Promise.resolve(jsonResponse(200, ok({ accessToken: "access-new", refreshToken: "refresh-2" })));
      }
      if (url.endsWith("/api/v1/b")) {
        if (!bHit) {
          bHit = true;
          return bFirst; // hold B's first response until after A's refresh
        }
        return Promise.resolve(jsonResponse(200, ok({ who: "b" })));
      }
      if (!aHit) {
        aHit = true;
        return Promise.resolve(jsonResponse(401, err("expired")));
      }
      return Promise.resolve(jsonResponse(200, ok({ who: "a" })));
    });

    const bPromise = api.get<{ who: string }>("/api/v1/b"); // startedAt=1000, 401 held
    const aData = await api.get<{ who: string }>("/api/v1/a"); // 401 → refresh → retry
    expect(aData).toEqual({ who: "a" });
    expect(refreshCalls).toBe(1);

    releaseB(jsonResponse(401, err("expired"))); // B's 401 lands after the refresh
    const bData = await bPromise;
    expect(bData).toEqual({ who: "b" });
    expect(refreshCalls).toBe(1); // B retried on the fresh token — no second rotation

    nowSpy.mockRestore();
  });

  it("does not attempt refresh when there is no refresh token", async () => {
    tokenStore.clear();
    store.set("nx_access", "access-old"); // access present, refresh absent
    fetchMock.mockResolvedValueOnce(jsonResponse(401, err("expired")));

    await expect(api.get("/api/v1/thing")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
