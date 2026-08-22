import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { filterBranchesForClean, verifyCandidateBranches, executeDeletions } from "../src/deleter.js";
import { performClean } from "../src/commands/clean.js";
import { writeCache, readCache } from "../src/cache.js";
import { getLocalBranches } from "../src/git.js";

describe("clean command and deleter guards", { timeout: 30000 }, () => {
  let testRepoDir;
  let testCacheDir;

  beforeEach(() => {
    // Stub global fetch with default mock handler for clean tests
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("fail-network")) {
          throw new Error("Network unreachable");
        }

        // Pull requests query
        if (urlStr.includes("/pulls")) {
          if (urlStr.includes("feature%2Fnormal-merge") || urlStr.includes("feature/normal-merge")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => [{ number: 101, state: "closed", merged_at: "2026-08-10" }],
            };
          }
          if (urlStr.includes("feature%2Fsquash-merge") || urlStr.includes("feature/squash-merge")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => [{ number: 102, state: "closed", merged_at: "2026-08-10" }],
            };
          }
          if (urlStr.includes("feature%2Fclosed-no-merge") || urlStr.includes("feature/closed-no-merge")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ "x-ratelimit-remaining": "4999" }),
              json: async () => [{ number: 103, state: "closed", merged_at: null }],
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "x-ratelimit-remaining": "4999" }),
            json: async () => [],
          };
        }

        // Repo default branch query
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

    // Initialize git repo with test branches using direct execFileSync (no shell)
    execFileSync("git", ["init", "-q"], { cwd: testRepoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: testRepoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testRepoDir });
    fs.writeFileSync(path.join(testRepoDir, "file.txt"), "init\n");
    execFileSync("git", ["add", "file.txt"], { cwd: testRepoDir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: testRepoDir });
    execFileSync("git", ["branch", "-M", "main"], { cwd: testRepoDir });

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
      execFileSync("git", ["checkout", "-q", "-b", b], { cwd: testRepoDir });
      fs.appendFileSync(path.join(testRepoDir, "file.txt"), `${b}\n`);
      execFileSync("git", ["commit", "-q", "-am", `work on ${b}`], { cwd: testRepoDir });
      execFileSync("git", ["checkout", "-q", "main"], { cwd: testRepoDir });
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

  it("offers squash-merged branch for deletion when cached SHA matches, ignoring raw git-history check", () => {
    const localBranches = [
      { name: "main", sha: "main-sha-000" },
      { name: "feature/squash-merge", sha: "squash-sha-123" },
    ];

    const mockCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": {
          sha: "squash-sha-123", // Matching cached SHA
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

    // Despite raw git history not showing squash commits on origin/main, the branch is safely offered
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toEqual(
      expect.objectContaining({
        name: "feature/squash-merge",
        status: "merged",
        sha: "squash-sha-123",
      })
    );
    expect(skipped).toEqual([]);
  });

  it("unpushed work guard: skips branch when new local commits were added after scan (SHA mismatch)", () => {
    const localBranches = [
      { name: "main", sha: "main-sha-000" },
      { name: "feature/squash-merge", sha: "new-local-sha-456" }, // Modified locally since scan
    ];

    const mockCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": {
          sha: "old-cached-sha-123", // Mismatched SHA indicates local changes since scan
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

  describe("verifyCandidateBranches (Verification-Driven Safety)", () => {
    it("live-verifies candidate branches against GitHub API and confirms merged/closed ones", async () => {
      const candidates = [
        { name: "feature/squash-merge", sha: "111", status: "merged", prNumber: 102 },
        { name: "feature/closed-no-merge", sha: "222", status: "closed", prNumber: 103 },
      ];

      const { verifiedEligible, liveSkipped, updatedCacheEntries } = await verifyCandidateBranches({
        candidates,
        owner: "test-owner",
        repo: "test-repo",
        token: "dummy-token",
      });

      expect(verifiedEligible).toHaveLength(2);
      expect(verifiedEligible.map((b) => b.name)).toEqual(["feature/squash-merge", "feature/closed-no-merge"]);
      expect(liveSkipped).toHaveLength(0);
      expect(updatedCacheEntries["feature/squash-merge"].status).toBe("merged");
      expect(updatedCacheEntries["feature/closed-no-merge"].status).toBe("closed");
    });

    it("safely skips candidate if live verification reveals the PR is now open (status changed since scan)", async () => {
      const candidates = [
        { name: "feature/squash-merge", sha: "111", status: "merged", prNumber: 102 },
      ];

      // Custom fetcher returning open PR
      const mockFetcher = async () => [{ number: 102, state: "open" }];

      const { verifiedEligible, liveSkipped, updatedCacheEntries } = await verifyCandidateBranches({
        candidates,
        owner: "test-owner",
        repo: "test-repo",
        fetcher: mockFetcher,
      });

      expect(verifiedEligible).toHaveLength(0);
      expect(liveSkipped).toHaveLength(1);
      expect(liveSkipped[0]).toEqual({
        name: "feature/squash-merge",
        reason: "Live check: status is 'open' (PR #102)",
      });
      expect(updatedCacheEntries["feature/squash-merge"].status).toBe("open");
    });

    it("safely skips candidate if live check encounters multiple PRs (needs-review)", async () => {
      const candidates = [
        { name: "feature/squash-merge", sha: "111", status: "merged", prNumber: 102 },
      ];

      const mockFetcher = async () => [
        { number: 102, state: "closed", merged_at: "2026-08-10" },
        { number: 105, state: "open" },
      ];

      const { verifiedEligible, liveSkipped } = await verifyCandidateBranches({
        candidates,
        owner: "test-owner",
        repo: "test-repo",
        fetcher: mockFetcher,
      });

      expect(verifiedEligible).toHaveLength(0);
      expect(liveSkipped).toHaveLength(1);
      expect(liveSkipped[0].reason).toContain("status is 'needs-review'");
    });

    it("safely skips candidate if live API check fails (never deletes unverified branch)", async () => {
      const candidates = [
        { name: "feature/squash-merge", sha: "111", status: "merged", prNumber: 102 },
      ];

      const mockFetcher = async () => {
        throw new Error("503 Service Unavailable");
      };

      const { verifiedEligible, liveSkipped } = await verifyCandidateBranches({
        candidates,
        owner: "test-owner",
        repo: "test-repo",
        fetcher: mockFetcher,
      });

      expect(verifiedEligible).toHaveLength(0);
      expect(liveSkipped).toHaveLength(1);
      expect(liveSkipped[0].reason).toContain("Live verification failed (503 Service Unavailable)");
    });
  });

  it("deletes confirmed branches using executeDeletions and updates cache file", () => {
    const repoKey = "test-owner_test-repo";
    const localBranches = getLocalBranches(testRepoDir);
    const squashBranch = localBranches.find((b) => b.name === "feature/squash-merge");

    const initialCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": { sha: squashBranch.sha, prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
        "feature/still-open": { sha: "555", prNumber: 104, status: "open", lastCheckedAt: "2026-08-10" },
      },
    };
    writeCache(repoKey, initialCache, testCacheDir);

    const branchesBefore = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesBefore).toContain("feature/squash-merge");

    const result = executeDeletions({
      branchesToDelete: [{ name: "feature/squash-merge", sha: squashBranch.sha }],
      repoKey,
      cacheDir: testCacheDir,
      cwd: testRepoDir,
    });

    expect(result.deleted).toEqual(["feature/squash-merge"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);

    const branchesAfter = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesAfter).not.toContain("feature/squash-merge");

    const updatedCache = readCache(repoKey, testCacheDir);
    expect(updatedCache.branches["feature/squash-merge"]).toBeUndefined();
    expect(updatedCache.branches["feature/still-open"]).toBeDefined();
    expect(updatedCache.defaultBranch).toBe("main");
  });

  it("executeDeletions hard safety boundary: skips deletion if local branch SHA changed right before deletion", () => {
    const repoKey = "test-owner_test-repo";
    const localBranches = getLocalBranches(testRepoDir);
    const squashBranch = localBranches.find((b) => b.name === "feature/squash-merge");

    const initialCache = {
      defaultBranch: "main",
      branches: {
        "feature/squash-merge": { sha: squashBranch.sha, prNumber: 102, status: "merged", lastCheckedAt: "2026-08-10" },
      },
    };
    writeCache(repoKey, initialCache, testCacheDir);

    // Pass a stale verified SHA that does not match the actual current local SHA
    const result = executeDeletions({
      branchesToDelete: [{ name: "feature/squash-merge", sha: "stale-verified-sha-999" }],
      repoKey,
      cacheDir: testCacheDir,
      cwd: testRepoDir,
    });

    // Deletion boundary guard must refuse to delete the branch
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("Branch modified after verification");

    const branchesAfter = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesAfter).toContain("feature/squash-merge");
  });

  it("performClean end-to-end race protection: preserves branch if modified during prompt after live verification", async () => {
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

    // Prompt handler simulates user making a new commit on the branch right while the prompt is open
    const mockPrompts = async (question) => {
      if (question.name === "confirmDelete") {
        // Commit new work onto feature/squash-merge during user interaction
        execFileSync("git", ["checkout", "-q", "feature/squash-merge"], { cwd: testRepoDir });
        fs.appendFileSync(path.join(testRepoDir, "file.txt"), "new commit during prompt\n");
        execFileSync("git", ["commit", "-q", "-am", "new commit during prompt"], { cwd: testRepoDir });
        execFileSync("git", ["checkout", "-q", "main"], { cwd: testRepoDir });
        return { confirmDelete: true };
      }
      if (question.name === "proceed") {
        return { proceed: true };
      }
      return {};
    };

    const result = await performClean({
      token: "dummy-token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    // Must NOT delete the branch because its SHA changed after verification
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "feature/squash-merge",
          reason: expect.stringContaining("Branch modified after verification"),
        }),
      ])
    );

    const branchesAfter = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branchesAfter).toContain("feature/squash-merge");
  });

  it("fails with a clear error when no GitHub token is configured for clean", async () => {
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

    await expect(
      performClean({
        token: "",
        owner: "test-owner",
        repo: "test-repo",
        cwd: testRepoDir,
        cacheDir: testCacheDir,
      })
    ).rejects.toThrow("No GitHub token configured. Please set your token with: git-purge config set-token <token>");
  });

  it("aborts deletion when user declines final confirmation", async () => {
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

    // Mock prompts to decline final confirmation
    const mockPrompts = async (question) => {
      if (question.name === "confirmDelete") return { confirmDelete: true };
      if (question.name === "proceed") return { proceed: false };
      return {};
    };

    const result = await performClean({
      token: "dummy-token",
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
      token: "dummy-token",
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

  it("aborts clean and throws clear error when GitHub API repository verification fails", async () => {
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

    await expect(
      performClean({
        token: "dummy-token",
        owner: "test-owner",
        repo: "test-repo",
        cwd: testRepoDir,
        cacheDir: testCacheDir,
      })
    ).rejects.toThrow(
      "Could not verify repository default branch from GitHub API: Network unreachable. Clean aborted to prevent accidental data loss."
    );
  });

  it("uses options.defaultBranch when explicitly provided without querying repo info", async () => {
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

    const mockPrompts = async () => ({ proceed: false });

    const result = await performClean({
      defaultBranch: "main",
      token: "dummy-token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    expect(result.deleted).toEqual([]);
  });

  it("verification-driven clean: live-verifies candidate branches and deletes confirmed ones", async () => {
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

    const mockPrompts = async (question) => {
      if (question.name === "confirmDelete") return { confirmDelete: true };
      if (question.name === "proceed") return { proceed: true };
      return {};
    };

    const result = await performClean({
      token: "dummy-token",
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    expect(result.deleted).toEqual(["feature/squash-merge"]);
    expect(result.skipped).toEqual([]);
    const branches = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branches).not.toContain("feature/squash-merge");
  });

  it("verification-driven clean: skips candidate if live verification detects PR was reopened", async () => {
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

    // Mock fetcher that reports PR 102 is now open
    const mockFetcher = async () => [{ number: 102, state: "open" }];

    const mockPrompts = async () => ({ confirmDelete: true, proceed: true });

    const result = await performClean({
      fetcher: mockFetcher,
      owner: "test-owner",
      repo: "test-repo",
      cwd: testRepoDir,
      cacheDir: testCacheDir,
      promptHandler: mockPrompts,
    });

    // Zero branches deleted because live check caught that the branch PR is open
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({
      name: "feature/squash-merge",
      reason: "Live check: status is 'open' (PR #102)",
    });
    const branches = getLocalBranches(testRepoDir).map((b) => b.name);
    expect(branches).toContain("feature/squash-merge");
  });
});

