import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchPullRequestsForBranch, fetchRepoInfo, checkRateLimit, githubRequest } from "../src/github.js";

describe("github API module", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const urlStr = url.toString();

        if (urlStr.includes("/repos/owner/repo/pulls")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => [{ number: 101, state: "closed", merged_at: "2026-08-10T12:00:00Z" }],
            text: async () => JSON.stringify([{ number: 101, state: "closed", merged_at: "2026-08-10T12:00:00Z" }]),
          };
        }

        if (urlStr.includes("/repos/owner/repo")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => ({ default_branch: "main" }),
            text: async () => JSON.stringify({ default_branch: "main" }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-ratelimit-remaining": "4999" }),
          json: async () => ({}),
          text: async () => "{}",
        };
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws clear error when token is missing", async () => {
    await expect(githubRequest("/repos/owner/repo", "")).rejects.toThrow("No GitHub token configured");
    await expect(githubRequest("/repos/owner/repo", "   ")).rejects.toThrow("No GitHub token configured");
  });

  it("fetches repo default branch", async () => {
    const info = await fetchRepoInfo("owner", "repo", "ghp_mock_token");
    expect(info.defaultBranch).toBe("main");
  });

  it("fetches pull requests for a given branch head", async () => {
    const prs = await fetchPullRequestsForBranch("owner", "repo", "feature/login", "ghp_mock_token");
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(101);
  });

  it("handles low rate-limit header check", async () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "49",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1),
    });

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => {
      fn();
      return 0;
    });

    await checkRateLimit(headers);
    expect(setTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});
