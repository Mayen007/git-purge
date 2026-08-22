import { deleteBranch, getBranchSha } from "./git.js";
import { readCache, writeCache } from "./cache.js";
import { fetchPullRequestsForBranch } from "./github.js";
import { classifyBranch } from "./classifier.js";

/**
 * Filter cached branches to identify candidate branches that are safe for verification and deletion.
 *
 * Hard safety rules:
 * - Never offer current branch
 * - Never offer default branch (main/master)
 * - Only offer branches with status 'merged' or 'closed'
 * - Never offer branches with status 'needs-review', 'open', or 'no-pr'
 * - Skip any branch with unpushed commits (local SHA modified after scan)
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

    // Safety guard: For merged or closed branches, rely on the SHA match between the cached SHA
    // and current local SHA. If the local SHA does not match the cached SHA, the branch was modified
    // locally after the scan/PR status was fetched, so it has unpushed local changes.
    if (cached.sha && localBranch.sha !== cached.sha) {
      skipped.push({ name: branchName, reason: "Has unpushed local commits" });
      continue;
    }

    // Branch is a candidate for live verification
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
 * Live-verifies candidate branches against GitHub API before deletion.
 *
 * For each candidate branch (previously marked merged/closed):
 * 1. Queries GitHub API for pull requests for the branch.
 * 2. Classifies the live PR status.
 * 3. If still 'merged' or 'closed', it is confirmed as eligible for deletion.
 * 4. If status changed to 'open', 'needs-review', or 'no-pr', skips with clear reason.
 * 5. If API query fails (network error, rate limit, etc.), skips with clear reason (never delete unverified branches).
 *
 * @param {Object} params
 * @param {Array<{ name: string, sha: string, status: string, prNumber: number | null }>} params.candidates
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} [params.token]
 * @param {Function} [params.fetcher]
 * @returns {Promise<{ verifiedEligible: Array<{ name: string, sha: string, status: string, prNumber: number | null }>, liveSkipped: Array<{ name: string, reason: string }>, updatedCacheEntries: Record<string, any> }>}
 */
export async function verifyCandidateBranches({
  candidates,
  owner,
  repo,
  token,
  fetcher,
}) {
  const verifiedEligible = [];
  const liveSkipped = [];
  const updatedCacheEntries = {};

  for (const candidate of candidates) {
    try {
      const prs = fetcher
        ? await fetcher(candidate.name)
        : await fetchPullRequestsForBranch(owner, repo, candidate.name, token);

      const classification = classifyBranch(prs);
      const lastCheckedAt = new Date().toISOString();

      updatedCacheEntries[candidate.name] = {
        sha: candidate.sha,
        prNumber: classification.prNumber,
        status: classification.status,
        reason: classification.reason,
        lastCheckedAt,
      };

      if (classification.status === "merged" || classification.status === "closed") {
        verifiedEligible.push({
          name: candidate.name,
          sha: candidate.sha,
          status: classification.status,
          prNumber: classification.prNumber,
        });
      } else {
        const prInfo = classification.prNumber ? ` (PR #${classification.prNumber})` : "";
        liveSkipped.push({
          name: candidate.name,
          reason: `Live check: status is '${classification.status}'${prInfo}`,
        });
      }
    } catch (error) {
      liveSkipped.push({
        name: candidate.name,
        reason: `Live verification failed (${error.message})`,
      });
    }
  }

  return { verifiedEligible, liveSkipped, updatedCacheEntries };
}

/**
 * Executes branch deletions with git branch -D and updates the cache.
 *
 * Hard safety boundary:
 * Immediately before calling deleteBranch(), re-reads the actual current local branch SHA.
 * If the current local SHA does not match the verified SHA (i.e. branch was modified
 * after live verification or during user confirmation), skips deletion with a clear warning.
 *
 * @param {Object} params
 * @param {Array<{ name: string, sha?: string }>} params.branchesToDelete
 * @param {string} params.repoKey
 * @param {string} [params.cacheDir]
 * @param {string} [params.cwd]
 * @returns {{ deleted: string[], skipped: Array<{ name: string, reason: string }>, failed: Array<{ name: string, error: string }> }}
 */
export function executeDeletions({
  branchesToDelete,
  repoKey,
  cacheDir,
  cwd = process.cwd(),
}) {
  const deleted = [];
  const skipped = [];
  const failed = [];

  const cache = readCache(repoKey, cacheDir);
  const branchesObj = cache.branches || {};

  for (const branch of branchesToDelete) {
    // Hard safety boundary: Re-verify actual current local SHA immediately before delete
    const currentSha = getBranchSha(branch.name, cwd);

    if (!currentSha) {
      skipped.push({
        name: branch.name,
        reason: "Branch no longer exists locally",
      });
      continue;
    }

    if (branch.sha && currentSha !== branch.sha) {
      skipped.push({
        name: branch.name,
        reason: `Branch modified after verification (SHA changed from ${branch.sha.slice(0, 7)} to ${currentSha.slice(0, 7)})`,
      });
      continue;
    }

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

  return { deleted, skipped, failed };
}


