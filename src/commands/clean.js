import prompts from "prompts";
import { getToken } from "../config.js";
import { getCurrentBranch, getLocalBranches, detectGitHubRepo } from "../git.js";
import { fetchRepoInfo } from "../github.js";
import { readCache, writeCache } from "../cache.js";
import { filterBranchesForClean, verifyCandidateBranches, executeDeletions } from "../deleter.js";

/**
 * Executes the clean command workflow.
 *
 * @param {Object} options
 * @param {boolean} [options.yes] - Skip per-branch confirmation (final confirmation still required)
 * @param {string} [options.owner]
 * @param {string} [options.repo]
 * @param {string} [options.cwd]
 * @param {string} [options.cacheDir]
 * @param {string} [options.token]
 * @param {string} [options.defaultBranch]
 * @param {Function} [options.fetcher] - Custom fetcher for testing
 * @param {Function} [options.promptHandler] - Custom handler for automated tests
 * @returns {Promise<{ deleted: string[], skipped: Array<{ name: string, reason: string }>, failed: Array<{ name: string, error: string }> }>}
 */
export async function performClean(options = {}) {
  const cwd = options.cwd || process.cwd();

  // 1. Detect repository
  let owner = options.owner;
  let repo = options.repo;
  if (!owner || !repo) {
    const detected = detectGitHubRepo(cwd);
    if (!detected) {
      throw new Error("Could not detect GitHub repository from git remote. Ensure 'origin' is set to a GitHub URL.");
    }
    owner = detected.owner;
    repo = detected.repo;
  }

  const repoKey = `${owner}_${repo}`;
  const cacheData = readCache(repoKey, options.cacheDir);
  const cachedBranches = cacheData.branches || {};

  if (Object.keys(cachedBranches).length === 0) {
    console.log("No cached scan results found. Please run 'git-purge scan' first.");
    return { deleted: [], skipped: [], failed: [] };
  }

  // 2. Validate token (required for verification-driven clean, unless mock fetcher is passed)
  const token = options.token !== undefined ? options.token : getToken();
  if (!options.fetcher && (!token || typeof token !== "string" || token.trim() === "")) {
    throw new Error("No GitHub token configured. Please set your token with: git-purge config set-token <token>");
  }

  // 3. Live repository verification: resolve default branch from GitHub API
  // In verification-driven clean, we strictly verify the default branch live with GitHub API
  // and abort if live verification fails (never fall back to stale cached default branch).
  let defaultBranch = options.defaultBranch || null;

  if (!defaultBranch) {
    try {
      const repoInfo = await fetchRepoInfo(owner, repo, token);
      defaultBranch = repoInfo.defaultBranch;
    } catch (err) {
      throw new Error(
        `Could not verify repository default branch from GitHub API: ${err.message}. Clean aborted to prevent accidental data loss.`
      );
    }
  }

  if (!defaultBranch) {
    throw new Error(
      "Repository default branch could not be determined from GitHub API. Clean aborted to prevent accidental data loss."
    );
  }

  // 4. Resolve current branch and local branches
  let currentBranch = "";
  try {
    currentBranch = getCurrentBranch(cwd);
  } catch {
    // Detached head or no current branch
  }

  const localBranches = getLocalBranches(cwd);

  // 5. Initial candidate filtering with hard safety guards (default, current, unpushed SHA match)
  const { eligible: candidateBranches, skipped: initialSkipped } = filterBranchesForClean({
    cacheData,
    localBranches,
    currentBranch,
    defaultBranch,
    cwd,
  });

  if (candidateBranches.length === 0) {
    if (initialSkipped.length > 0) {
      console.log("\nSkipped branches:");
      for (const item of initialSkipped) {
        console.log(`  - ${item.name} (${item.reason})`);
      }
    }
    console.log("\nNo dead branches eligible for cleanup.");
    return { deleted: [], skipped: initialSkipped, failed: [] };
  }

  // 6. Live verification: Re-check candidate branches against GitHub API to guarantee zero data loss
  console.log(`\nVerifying ${candidateBranches.length} candidate branch(es) with GitHub API...`);
  const { verifiedEligible, liveSkipped, updatedCacheEntries } = await verifyCandidateBranches({
    candidates: candidateBranches,
    owner,
    repo,
    token,
    fetcher: options.fetcher,
  });

  // Update cache with freshly verified candidate statuses
  if (Object.keys(updatedCacheEntries).length > 0) {
    cacheData.branches = {
      ...(cacheData.branches || {}),
      ...updatedCacheEntries,
    };
    writeCache(repoKey, cacheData, options.cacheDir);
  }

  const allSkipped = [...initialSkipped, ...liveSkipped];

  // Display warnings for any skipped branches
  if (allSkipped.length > 0) {
    console.log("\nSkipped branches:");
    for (const item of allSkipped) {
      console.log(`  - ${item.name} (${item.reason})`);
    }
  }

  if (verifiedEligible.length === 0) {
    console.log("\nNo dead branches eligible for cleanup.");
    return { deleted: [], skipped: allSkipped, failed: [] };
  }

  console.log(`\nFound ${verifiedEligible.length} dead branch(es) eligible for deletion:`);
  for (const b of verifiedEligible) {
    console.log(`  - ${b.name} [${b.status}${b.prNumber ? `, PR #${b.prNumber}` : ""}]`);
  }
  console.log("");

  const promptFn = options.promptHandler || prompts;

  let branchesToDelete = [];

  if (options.yes) {
    // --yes flag skips per-branch confirmation
    branchesToDelete = verifiedEligible;
  } else {
    // Ask confirmation for each branch individually
    for (const branch of verifiedEligible) {
      const response = await promptFn({
        type: "confirm",
        name: "confirmDelete",
        message: `Delete branch '${branch.name}' (${branch.status}${branch.prNumber ? `, PR #${branch.prNumber}` : ""})?`,
        initial: false,
      });

      if (response.confirmDelete) {
        branchesToDelete.push(branch);
      }
    }
  }

  if (branchesToDelete.length === 0) {
    console.log("No branches selected for deletion.");
    return { deleted: [], skipped: allSkipped, failed: [] };
  }

  // Hard safety rule: Never run a delete step without final summary confirmation prompt
  const finalConfirmation = await promptFn({
    type: "confirm",
    name: "proceed",
    message: `Proceed with deleting ${branchesToDelete.length} branch(es) with 'git branch -D'?`,
    initial: false,
  });

  if (!finalConfirmation.proceed) {
    console.log("Deletion aborted by user. Zero branches deleted.");
    return { deleted: [], skipped: allSkipped, failed: [] };
  }

  // 7. Execute deletions with deletion-boundary SHA check
  const { deleted, skipped: executionSkipped, failed } = executeDeletions({
    branchesToDelete,
    repoKey,
    cacheDir: options.cacheDir,
    cwd,
  });

  const finalSkipped = [...allSkipped, ...executionSkipped];

  if (executionSkipped.length > 0) {
    console.log("\nSkipped during deletion execution (safety boundary):");
    for (const s of executionSkipped) {
      console.log(`  ⚠ ${s.name} (${s.reason})`);
    }
  }

  console.log("\nClean Summary:");
  for (const d of deleted) {
    console.log(`  ✓ Deleted branch: ${d}`);
  }

  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`  ✗ Failed to delete branch ${f.name}: ${f.error}`);
    }
  }

  console.log(`\nSuccessfully deleted ${deleted.length} branch(es).`);

  return { deleted, skipped: finalSkipped, failed };
}

/**
 * Registers the `clean` command on the Commander program.
 * @param {import("commander").Command} program
 */
export function registerCleanCommand(program) {
  program
    .command("clean")
    .description("Safely delete local branches that are merged or closed on GitHub")
    .option("-y, --yes", "Skip individual branch confirmation prompts (final confirmation still required)")
    .action(async (options) => {
      try {
        await performClean(options);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

