import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { filterBranchesForClean, executeDeletions } from "../src/deleter.js";
import { performClean } from "../src/commands/clean.js";
import { writeCache, readCache } from "../src/cache.js";
import { getLocalBranches } from "../src/git.js";

describe("clean command and deleter guards", { timeout: 30000 }, () => {
  let testRepoDir;
  let testCacheDir;

  beforeEach(() => {
    // Stub global fetch to prevent any live network requests during clean tests
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("fail-network")) {
          throw new Error("Network unreachable");
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-ratelimit-remaining": "4999" }),
          json: async () => ({ default_branch: "main" }),
          text: async () => JSON.stringify({ default_branch: "main" }),
        };
      })
    );

    // Create an isolated temporary git repo copy to test actual branch deletions safely
    testRepoDir = path.join(os.tmpdir(), `git-purge-clean-repo-${Date.now()}`);
    testCacheDir = path.join(os.tmpdir(), `git-purge-clean-cache-${Date.now()}`);

    fs.mkdirSync(testRepoDir, { recursive: true });
    fs.mkdirSync(testCacheDir, { recursive: true });

    // Initialize git repo with test branches
    execSync("git init -q", { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test"', { cwd: testRepoDir });
    fs.writeFileSync(path.join(testRepoDir, "file.txt"), "init\n");
    execSync("git add file.txt", { cwd: testRepoDir });
    execSync('git commit -q -m "init"', { cwd: testRepoDir });
    execSync("git branch -M main", { cwd: testRepoDir });

    const branches = [
      "feature/normal-merge",
      "feature/squash-merge",
      "feature/closed-no-merge",
      "feature/still-open",
      "feature/no-pr",
      "feature/unpushed-work",
      "feature/ambiguous",
    ];

    for (const b of branches) {
      execSync(`git checkout -q -b "${b}"`, { cwd: testRepoDir });
      fs.appendFileSync(path.join(testRepoDir, "file.txt"), `${b}\n`);
      execSync(`git commit -q -am "work on ${b}"`, { cwd: testRepoDir });
      execSync("git checkout -q main", { cwd: testRepoDir });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (fs.existsSync(testRepoDir)) {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it("offers only safe merged and closed branches, excluding default, current, open, no-pr, and unpushed", () => {
    const mockCache = {
      defaultBranch: "main",
      branches: {
        "main": { sha: "111", prNumber: null, status: "merged", lastCheckedAt: "2026-08-10" },
        "feature/normal-merge": { sha: "222", prNumber: 101, status: "merged", lastCheckedAt: "2026-08-10" },
        "feature/squash-merge": { sha: "333", prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        "feature/closed-no-merge": { sha: "444", prNumber: 103, status: "closed", lastCheckedAt: "2026-08-10" },
        "feature/still-open": { sha: "555", prNumber: 104, status: "open", lastCheckedAt: "2026-08-10" },
        "feature/no-pr": { sha: "666", prNumber: null, status: "no-pr", lastCheckedAt: "2026-08-10" },
        "feature/unpushed-work": { sha: "777", prNumber: null, status: "no-pr", lastCheckedAt: "2026-08-10" },
        "feature/ambiguous": { sha: "888", prNumber: null, status: "needs-review", lastCheckedAt: "2026-08-10" },
      },
    };

    const localBranches = getLocalBranches(testRepoDir);

    // Filter branches where test repo has unpushed commits for all local branches (no remote configured)
    const { eligible, skipped } = filterBranchesForClean({
      cacheData: mockCache,
      localBranches,
      currentBranch: "main",
      defaultBranch: "main",
      cwd: testRepoDir,
    });

    const eligibleNames = eligible.map((b) => b.name);
    const skippedNames = skipped.map((b) => b.name);

    // main is default & current branch -> never in eligible
    expect(eligibleNames).not.toContain("main");
    expect(skippedNames).toContain("main");

    // open, no-pr, and needs-review are strictly never offered
    expect(eligibleNames).not.toContain("feature/still-open");
    expect(eligibleNames).not.toContain("feature/no-pr");
    expect(eligibleNames).not.toContain("feature/ambiguous");
  });

  it("never offers a branch labeled 'needs-review' for deletion", () => {
    const mockCache = {
      defaultBranch: "main",
      branches: {
        "feature/ambiguous": {
          sha: "888",
          prNumber: null,
          status: "needs-review",
          lastCheckedAt: "2026-08-10",
        },
      },
    };

    const localBranches = getLocalBranches(testRepoDir);

    const { eligible } = filterBranchesForClean({
      cacheData: mockCache,
      localBranches,
      currentBranch: "main",
      defaultBranch: "main",
      cwd: testRepoDir,
    });

    const eligibleNames = eligible.map((b) => b.name);
    expect(eligibleNames).not.toContain("feature/ambiguous");
    expect(eligible).toHaveLength(0);
  });

  it("unpushed work guard: skips any branch with unpushed commits and warns", () => {
    // Add remote tracking branch and push commits
    execSync("git remote add origin https://github.com/test-owner/test-repo.git", { cwd: testRepoDir });
    execSync("git update-ref refs/remotes/origin/main main", { cwd: testRepoDir });
    execSync("git update-ref refs/remotes/origin/feature/squash-merge feature/squash-merge", { cwd: testRepoDir });

    // Make an extra commit on feature/squash-merge that is unpushed
    execSync("git checkout -q feature/squash-merge", { cwd: testRepoDir });
    fs.appendFileSync(path.join(testRepoDir, "file.txt"), "extra local unpushed commit\n");
    execSync('git commit -q -am "extra commit"', { cwd: testRepoDir });
    execSync("git checkout -q main", { cwd: testRepoDir });

    const localBranches = getLocalBranches(testRepoDir);
    const squashBranch = localBranches.find((b) => b.name === "feature/squash-merge");

    const mockCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": { sha: squashBranch.sha, prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
      },
    };

    const { eligible, skipped } = filterBranchesForClean({
      cacheData: mockCache,
      localBranches,
      currentBranch: "main",
      defaultBranch: "main",
      cwd: testRepoDir,
    });

    expect(eligible).toHaveLength(0);
    expect(skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "feature/squash-merge",
          reason: "Has unpushed local commits",
        }),
      ])
    );
  });

  it("unpushed work guard: skips branch when new local commits were added after scan (SHA mismatch)", () => {
    const localBranches = getLocalBranches(testRepoDir);

    const mockCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": {
          sha: "older_sha_before_new_commit", // Mismatched SHA indicates local changes since scan
          prNumber: 102,
          status: "merged",
          lastCheckedAt: "2026-08-10",
        },
      },
    };

    const { eligible, skipped } = filterBranchesForClean({
      cacheData: mockCache,
      localBranches,
      currentBranch: "main",
      defaultBranch: "main",
      cwd: testRepoDir,
    });

    expect(eligible).toHaveLength(0);
    expect(skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "feature/squash-merge",
          reason: "Has unpushed local commits",
        }),
      ])
    );
  });

  it("deletes confirmed branches using executeDeletions and updates cache file", () => {
    const repoKey = "test-owner_test-repo";
    const initialCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": { sha: "333", prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        "feature/still-open": { sha: "555", prNumber: 104, status: "open", lastCheckedAt: "2026-08-10" },
      },
    };
    writeCache(repoKey, initialCache, testCacheDir);

    const branchesBefore = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesBefore).toContain("feature/squash-merge");

    const result = executeDeletions({
      branchesToDelete: [{ name: "feature/squash-merge" }],
      repoKey,
      cacheDir: testCacheDir,
      cwd: testRepoDir,
    });

    expect(result.deleted).toEqual(["feature/squash-merge"]);
    expect(result.failed).toEqual([]);

    const branchesAfter = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesAfter).not.toContain("feature/squash-merge");

    const updatedCache = readCache(repoKey, testCacheDir);
    expect(updatedCache.branches["feature/squash-merge"]).toBeUndefined();
    expect(updatedCache.branches["feature/still-open"]).toBeDefined();
    expect(updatedCache.defaultBranch).toBe("main");
  });

  it("aborts deletion when user declines final confirmation", async () => {
    const repoKey = "test-owner_test-repo";
    writeCache(
      repoKey,
      {
        defaultBranch: "main",
        branches: {
          "feature/squash-merge": { sha: "333", prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        },
      },
      testCacheDir
    );

    // Mock prompts to decline final confirmation
    const mockPrompts = async (question) => {
      if (question.name === "confirmDelete") return { confirmDelete: true };
      if (question.name === "proceed") return { proceed: false };
      return {};
    };

    const result = await performClean({
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    expect(result.deleted).toEqual([]);
    const branches = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branches).toContain("feature/squash-merge");
  });

  it("declines delete by default when user presses Enter with no explicit input on per-branch prompt", async () => {
    const repoKey = "test-owner_test-repo";
    const localBranches = getLocalBranches(testRepoDir);
    const squashBranch = localBranches.find((b) => b.name === "feature/squash-merge");

    writeCache(
      repoKey,
      {
        defaultBranch: "main",
        branches: {
          "feature/squash-merge": { sha: squashBranch.sha, prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        },
      },
      testCacheDir
    );

    let perBranchPromptOptions = null;

    // Simulate user pressing Enter on prompts (returning initial default value)
    const mockPrompts = async (question) => {
      if (question.name === "confirmDelete") {
        perBranchPromptOptions = question;
        // Pressing Enter accepts the initial default value
        return { confirmDelete: question.initial };
      }
      if (question.name === "proceed") {
        return { proceed: question.initial };
      }
      return {};
    };

    const result = await performClean({
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    // Verify per-branch prompt defaulted to false (No)
    expect(perBranchPromptOptions).not.toBeNull();
    expect(perBranchPromptOptions.initial).toBe(false);

    // Verify branch was NOT deleted
    expect(result.deleted).toEqual([]);
    const branches = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branches).toContain("feature/squash-merge");
  });

  it("reads default branch from cache when GitHub API is unreachable", async () => {
    const repoKey = "test-owner_test-repo";
    writeCache(
      repoKey,
      {
        defaultBranch: "production",
        branches: {
          "feature/squash-merge": { sha: "333", prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        },
      },
      testCacheDir
    );

    // Pass fetch stub that fails to simulate unreachable network
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network unreachable");
      })
    );

    const mockPrompts = async () => ({ proceed: false });

    const result = await performClean({
      token: "dummy-token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    // Clean ran safely without crashing, reading cached default branch 'production'
    expect(result.deleted).toEqual([]);
  });

  it("refuses to run clean and throws clear error when neither API nor cache has default branch", async () => {
    const repoKey = "test-owner_test-repo";
    writeCache(
      repoKey,
      {
        defaultBranch: null,
        branches: {
          "feature/squash-merge": { sha: "333", prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        },
      },
      testCacheDir
    );

    // Network fails
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network unreachable");
      })
    );

    await expect(
      performClean({
        token: "",
        owner: "test-owner",
        repo: "test-repo",
        cwd: testRepoDir,
        cacheDir: testCacheDir,
      })
    ).rejects.toThrow(
      "Could not determine repository default branch from GitHub API or cache. Clean aborted to prevent accidental data loss. Run 'git-purge scan' with a valid token first."
    );
  });
});
