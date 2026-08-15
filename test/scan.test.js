import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

describe("scan command (MVP)", { timeout: 25000 }, () => {
  const testCacheDir = path.join(os.tmpdir(), `git-purge-scan-test-${Date.now()}`);

  beforeEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
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

  it("scans fixture repo branches and classifies every branch accurately", async () => {
    // Custom fetcher that returns the mocked PR state for each branch
    const mockFetcher = async (branchName) => {
      const mockResult = mocks[branchName];
      return mockResult ? [mockResult] : [];
    };

    const branches = await performScan({
      token: "ghp_dummy_token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: fixtureRepoPath,
      fetcher: mockFetcher,
      cacheDir: testCacheDir,
      defaultBranch: "main",
    });

    const statusMap = Object.fromEntries(branches.map((b) => [b.name, b.status]));

    // Verify all 6 fixture branches + default branch
    expect(statusMap["feature/normal-merge"]).toBe("merged");
    expect(statusMap["feature/squash-merge"]).toBe("merged"); // Crucial squash-merge test!
    expect(statusMap["feature/closed-no-merge"]).toBe("closed");
    expect(statusMap["feature/still-open"]).toBe("open");
    expect(statusMap["feature/no-pr"]).toBe("no-pr");
    expect(statusMap["feature/unpushed-work"]).toBe("no-pr");

    // Verify cache file was written to disk with one entry per branch
    const cacheFile = getCacheFilePath("test-owner_test-repo", testCacheDir);
    expect(fs.existsSync(cacheFile)).toBe(true);

    const cacheContent = readCache("test-owner_test-repo", testCacheDir);
    expect(cacheContent["feature/squash-merge"]).toMatchObject({
      status: "merged",
      prNumber: 102,
    });
    expect(cacheContent["feature/still-open"]).toMatchObject({
      status: "open",
      prNumber: 104,
    });
  });

  it("never deletes any branch during scan", async () => {
    const branchesBefore = getLocalBranches(fixtureRepoPath).map((b) => b.name);

    const mockFetcher = async (branchName) => {
      const mockResult = mocks[branchName];
      return mockResult ? [mockResult] : [];
    };

    await performScan({
      token: "ghp_dummy_token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: fixtureRepoPath,
      fetcher: mockFetcher,
      cacheDir: testCacheDir,
      defaultBranch: "main",
    });

    const branchesAfter = getLocalBranches(fixtureRepoPath).map((b) => b.name);
    expect(branchesAfter).toEqual(branchesBefore);
  });
});
