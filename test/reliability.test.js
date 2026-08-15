import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { performScan } from "../src/commands/scan.js";
import { checkRateLimit } from "../src/github.js";
import { writeCache } from "../src/cache.js";
import { getLocalBranches } from "../src/git.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoPath = path.resolve(__dirname, "fixtures/repo");
const mocksPath = path.resolve(__dirname, "fixtures/github-api-mocks.json");
const mocks = JSON.parse(fs.readFileSync(mocksPath, "utf8"));

describe("Phase 3: Reliability & Edge Cases", { timeout: 30000 }, () => {
  let testCacheDir;

  beforeEach(() => {
    testCacheDir = path.join(os.tmpdir(), `git-purge-reliability-test-${Date.now()}`);
    fs.mkdirSync(testCacheDir, { recursive: true });

    // Stub global fetch with default mock handler
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const urlStr = url.toString();

        // Default branch query
        if (urlStr.match(/\/repos\/[^/]+\/[^/?]+$/)) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => ({ default_branch: "main" }),
            text: async () => JSON.stringify({ default_branch: "main" }),
          };
        }

        // Pull requests query
        const match = urlStr.match(/[?&]head=([^&]+)/);
        if (match) {
          const headParam = decodeURIComponent(match[1]);
          const branchName = headParam.includes(":") ? headParam.split(":")[1] : headParam;
          const mockPR = mocks[branchName];
          const data = mockPR ? [mockPR] : [];
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => data,
            text: async () => JSON.stringify(data),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-ratelimit-remaining": "4999" }),
          json: async () => [],
          text: async () => "[]",
        };
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  describe("Rate-Limit Boundary Handling", () => {
    it("boundary test: X-RateLimit-Remaining of 50 does NOT pause", async () => {
      const headers = new Headers({
        "x-ratelimit-remaining": "50",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
      });

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      await checkRateLimit(headers);

      // Should not pause when remaining is 50
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it("boundary test: X-RateLimit-Remaining of 49 DOES pause", async () => {
      const resetTimeSeconds = Math.floor(Date.now() / 1000) + 2;
      const headers = new Headers({
        "x-ratelimit-remaining": "49",
        "x-ratelimit-reset": String(resetTimeSeconds),
      });

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => {
        fn();
        return 0;
      });

      await checkRateLimit(headers);

      // Must pause when remaining drops below 50 (49)
      expect(setTimeoutSpy).toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });
  });

  describe("--refresh flag", () => {
    it("skips API calls for cached merged/closed branches on normal scan, but re-checks them on --refresh", async () => {
      const repoKey = "test-owner_test-repo";
      const localBranches = getLocalBranches(fixtureRepoPath);
      const normalMergeBranch = localBranches.find((b) => b.name === "feature/normal-merge");

      const initialCache = {
        defaultBranch: "main",
        branches: {
          "feature/normal-merge": {
            sha: normalMergeBranch ? normalMergeBranch.sha : "mock-sha",
            prNumber: 101,
            status: "merged",
            lastCheckedAt: "2026-08-01T00:00:00Z",
          },
        },
      };
      writeCache(repoKey, initialCache, testCacheDir);

      const fetchSpy = vi.fn(async (url) => {
        const urlStr = url.toString();
        if (urlStr.match(/\/repos\/[^/]+\/[^/?]+$/)) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => ({ default_branch: "main" }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-ratelimit-remaining": "4999" }),
          json: async () => [{ number: 101, state: "closed", merged_at: "2026-08-15T00:00:00Z" }],
        };
      });
      vi.stubGlobal("fetch", fetchSpy);

      // Normal scan without refresh: feature/normal-merge should use cached entry
      const scan1 = await performScan({
        token: "ghp_mock_token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
        refresh: false,
      });

      const normalMergeItem1 = scan1.find((b) => b.name === "feature/normal-merge");
      expect(normalMergeItem1.lastCheckedAt).toBe("2026-08-01T00:00:00Z");

      // Scan with --refresh: feature/normal-merge must be re-checked from API
      const scan2 = await performScan({
        token: "ghp_mock_token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
        refresh: true,
      });

      const normalMergeItem2 = scan2.find((b) => b.name === "feature/normal-merge");
      expect(normalMergeItem2.lastCheckedAt).not.toBe("2026-08-01T00:00:00Z");
    });
  });

  describe("No-Network & Failed API Call Handling", () => {
    it("falls back to cached data and shows warning when network is completely unreachable", async () => {
      const repoKey = "test-owner_test-repo";
      const localBranches = getLocalBranches(fixtureRepoPath);
      const squashBranchObj = localBranches.find((b) => b.name === "feature/squash-merge");

      const initialCache = {
        defaultBranch: "main",
        branches: {
          "feature/squash-merge": {
            sha: squashBranchObj ? squashBranchObj.sha : "mock-sha",
            prNumber: 102,
            status: "merged",
            lastCheckedAt: "2026-08-01T00:00:00Z",
          },
        },
      };
      writeCache(repoKey, initialCache, testCacheDir);

      // Network throws error
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ENOTFOUND api.github.com");
        })
      );

      const branches = await performScan({
        token: "ghp_mock_token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
        refresh: true, // Force network attempt to test error handling
      });

      const squashBranch = branches.find((b) => b.name === "feature/squash-merge");
      expect(squashBranch).toBeDefined();
      // Should fallback to cached status and timestamp
      expect(squashBranch.status).toBe("merged");
      expect(squashBranch.lastCheckedAt).toBe("2026-08-01T00:00:00Z");
    });

    it("handles a single failed API call by marking that branch needs-review and continuing scan", async () => {
      // Stub fetch to fail only for feature/still-open
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          const urlStr = url.toString();
          if (urlStr.includes("feature%2Fstill-open") || urlStr.includes("feature/still-open")) {
            throw new Error("500 Internal Server Error on branch query");
          }
          if (urlStr.match(/\/repos\/[^/]+\/[^/?]+$/)) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => ({ default_branch: "main" }),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => [{ number: 101, state: "closed", merged_at: "2026-08-10" }],
          };
        })
      );

      const branches = await performScan({
        token: "ghp_mock_token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
      });

      const failedBranch = branches.find((b) => b.name === "feature/still-open");
      const otherBranch = branches.find((b) => b.name === "feature/normal-merge");

      expect(failedBranch.status).toBe("needs-review");
      expect(otherBranch.status).toBe("merged");
    });
  });

  describe("Ambiguous Multi-PR Handling", () => {
    it("flags branches with multiple matching PR results as needs-review without guessing", async () => {
      // Mock returns 2 PRs for feature/still-open
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          const urlStr = url.toString();
          if (urlStr.includes("feature%2Fstill-open") || urlStr.includes("feature/still-open")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => [
                { number: 201, state: "open" },
                { number: 202, state: "closed", merged_at: "2026-08-10" },
              ],
            };
          }
          if (urlStr.match(/\/repos\/[^/]+\/[^/?]+$/)) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => ({ default_branch: "main" }),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => [],
          };
        })
      );

      const branches = await performScan({
        token: "ghp_mock_token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
      });

      const ambiguousBranch = branches.find((b) => b.name === "feature/still-open");
      expect(ambiguousBranch.status).toBe("needs-review");
      expect(ambiguousBranch.prNumber).toBeNull();
    });
  });
});
