import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getToken, setToken } from "@/lib/api";

describe("api helpers", () => {
  afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
  });

  it("setToken and getToken roundtrip", () => {
    setToken("abc");
    expect(getToken()).toBe("abc");
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it("api throws ApiError on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "nope" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(api("/api/auth/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("api returns parsed json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(api<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
  });
});
