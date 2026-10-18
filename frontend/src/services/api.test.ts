import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, fetchAuthMe, loginUrl, loginWithPassword, logout, saveProfile } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apiFetch sends credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/health");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", { credentials: "include" });
  });

  it("fetchAuthMe parses auth payload", async () => {
    const body = { enabled: false, required: false, providers: [], user: null, profile: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(fetchAuthMe()).resolves.toEqual(body);
  });

  it("loginUrl builds provider path", () => {
    expect(loginUrl("google")).toBe("/api/auth/login/google");
  });

  it("loginWithPassword returns the server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid email or password." }), { status: 401 })),
    );
    await expect(loginWithPassword("a@b.com", "nope")).resolves.toBe("Invalid email or password.");
  });

  it("logout posts to logout endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await logout();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", credentials: "include" });
  });

  it("saveProfile throws on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(saveProfile({})).rejects.toThrow(/save profile/i);
  });
});
