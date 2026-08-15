import { deleteBranch, hasUnpushedCommits } from "./git.js";
import { readCache, writeCache } from "./cache.js";

/**
 * Filter cached branches to identify branches that are safe to offer for deletion.
 *
 * Hard safety rules:
 * - Never offer current branch
 * - Never offer default branch (main/master)
 * - Only offer branches with status 'merged' or 'closed'
 * - Never offer branches with status 'needs-review', 'open', or 'no-pr'
 * - Skip any branch with unpushed commits (and flag with warning)
 *
 * @param {Object} params
 * @param {Record<string, { sha: string, prNumber: number | null, status: string, lastCheckedAt: string }> | { defaultBranch?: string | null, branches: Record<string, { sha: string, prNumber: number | null, status: string, lastCheckedAt: string }> }} params.cacheData
 * @param {Array<{ name: string, sha: string }>} params.localBranches
 * @param {string} params.currentBranch
 * @param {string} params.defaultBranch
 * @param {string} [params.cwd]
 * @returns {{ eligible: Array<{ name: string, sha: string, status: string, prNumber: number | null }>, skipped: Array<{ name: string, reason: string }> }}
 */
export function filterBranchesForClean({
  cacheData,
  localBranches,
  currentBranch,
  defaultBranch,
  cwd = process.cwd(),
}) {
  const eligible = [];
  const skipped = [];

  const branchesObj = cacheData && "branches" in cacheData ? cacheData.branches : cacheData;
  const localBranchMap = new Map(localBranches.map((b) => [b.name, b]));

  for (const [branchName, cached] of Object.entries(branchesObj || {})) {
    // If the branch doesn't exist locally anymore, skip it
    if (!localBranchMap.has(branchName)) {
      continue;
    }

    const localBranch = localBranchMap.get(branchName);

    // Hard safety guard: Never delete current branch
    if (branchName === currentBranch) {
      skipped.push({ name: branchName, reason: "Current active branch" });
      continue;
    }

    // Hard safety guard: Never delete repo default branch
    if (defaultBranch && branchName === defaultBranch) {
      skipped.push({ name: branchName, reason: "Repository default branch" });
      continue;
    }

    // Only merged and closed branches are candidates for cleanup (needs-review, open, no-pr are never offered)
    if (cached.status !== "merged" && cached.status !== "closed") {
      continue;
    }

    // Hard safety guard: Skip any branch with unpushed local commits
    if (hasUnpushedCommits(branchName, cwd)) {
      skipped.push({ name: branchName, reason: "Has unpushed local commits" });
      continue;
    }

    // Branch is safe and eligible for delete confirmation
    eligible.push({
      name: branchName,
      sha: localBranch.sha,
      status: cached.status,
      prNumber: cached.prNumber,
    });
  }

  return { eligible, skipped };
}

/**
 * Executes branch deletions with git branch -D and updates the cache.
 *
 * @param {Object} params
 * @param {Array<{ name: string }>} params.branchesToDelete
 * @param {string} params.repoKey
 * @param {string} [params.cacheDir]
 * @param {string} [params.cwd]
 * @returns {{ deleted: string[], failed: Array<{ name: string, error: string }> }}
 */
export function executeDeletions({
  branchesToDelete,
  repoKey,
  cacheDir,
  cwd = process.cwd(),
}) {
  const deleted = [];
  const failed = [];

  const cache = readCache(repoKey, cacheDir);
  const branchesObj = cache.branches || {};

  for (const branch of branchesToDelete) {
    try {
      deleteBranch(branch.name, cwd);
      deleted.push(branch.name);
      // Remove from cache after successful deletion
      delete branchesObj[branch.name];
    } catch (error) {
      failed.push({ name: branch.name, error: error.message });
    }
  }

  // Save updated cache
  cache.branches = branchesObj;
  writeCache(repoKey, cache, cacheDir);

  return { deleted, failed };
}
