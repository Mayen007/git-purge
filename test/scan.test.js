import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { performScan } from "../src/commands/scan.js";
import { readCache, getCacheFilePath } from "../src/cache.js";
import { getLocalBranches } from "../src/git.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoPath = path.resolve(__dirname, "fixtures/repo");
const mocksPath = path.resolve(__dirname, "fixtures/github-api-mocks.json");
const mocks = JSON.parse(fs.readFileSync(mocksPath, "utf8"));

/**
 * Creates a mock fetch function that serves responses from github-api-mocks.json.
 */
function createMockFetch() {
  return vi.fn(async (url) => {
    const urlStr = url.toString();

    // Mock GET /repos/{owner}/{repo} (default branch)
    if (urlStr.match(/\/repos\/[^/]+\/[^/?]+$/)) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          "content-type": "application/json",
        }),
        json: async () => ({ default_branch: "main" }),
        text: async () => JSON.stringify({ default_branch: "main" }),
      };
    }

    // Mock GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all
    const match = urlStr.match(/[?&]head=([^&]+)/);
    if (match) {
      const headParam = decodeURIComponent(match[1]); // e.g. "test-owner:feature/squash-merge"
      const branchName = headParam.includes(":") ? headParam.split(":")[1] : headParam;
      const mockPR = mocks[branchName];

      const data = mockPR ? [mockPR] : [];
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          "content-type": "application/json",
        }),
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
  });
}

describe("scan command (MVP)", { timeout: 25000 }, () => {
  const testCacheDir = path.join(os.tmpdir(), `git-purge-scan-test-${Date.now()}`);

  beforeEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    // Stub global fetch with mocked GitHub API response handler
    vi.stubGlobal("fetch", createMockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear error message when no token is configured", async () => {
    await expect(
      performScan({
        token: "",
        owner: "test-owner",
        repo: "test-repo",
        cwd: fixtureRepoPath,
        cacheDir: testCacheDir,
      })
    ).rejects.toThrow("No GitHub token configured. Please set your token with: git-purge config set-token <token>");
  });

  it("scans fixture repo branches and classifies every branch accurately with mocked fetch", async () => {
    const branches = await performScan({
      token: "ghp_dummy_token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: fixtureRepoPath,
      cacheDir: testCacheDir,
    });

    const statusMap = Object.fromEntries(branches.map((b) => [b.name, b.status]));

    // Verify all 6 fixture branches + default branch
    expect(statusMap["feature/normal-merge"]).toBe("merged");
    expect(statusMap["feature/squash-merge"]).toBe("merged"); // Crucial squash-merge test!
    expect(statusMap["feature/closed-no-merge"]).toBe("closed");
    expect(statusMap["feature/still-open"]).toBe("open");
    expect(statusMap["feature/no-pr"]).toBe("no-pr");
    expect(statusMap["feature/unpushed-work"]).toBe("no-pr");

    // Verify cache file was written to disk with defaultBranch and branches
    const cacheFile = getCacheFilePath("test-owner_test-repo", testCacheDir);
    expect(fs.existsSync(cacheFile)).toBe(true);

    const cacheContent = readCache("test-owner_test-repo", testCacheDir);
    expect(cacheContent.defaultBranch).toBe("main");
    expect(cacheContent.branches["feature/squash-merge"]).toMatchObject({
      status: "merged",
      prNumber: 102,
    });
    expect(cacheContent.branches["feature/still-open"]).toMatchObject({
      status: "open",
      prNumber: 104,
    });
  });

  it("never deletes any branch during scan", async () => {
    const branchesBefore = getLocalBranches(fixtureRepoPath).map((b) => b.name);

    await performScan({
      token: "ghp_dummy_token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: fixtureRepoPath,
      cacheDir: testCacheDir,
    });

    const branchesAfter = getLocalBranches(fixtureRepoPath).map((b) => b.name);
    expect(branchesAfter).toEqual(branchesBefore);
  });
});
