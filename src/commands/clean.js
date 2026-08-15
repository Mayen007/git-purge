import prompts from "prompts";
import { getToken } from "../config.js";
import { getCurrentBranch, getLocalBranches, detectGitHubRepo } from "../git.js";
import { fetchRepoInfo } from "../github.js";
import { readCache } from "../cache.js";
import { filterBranchesForClean, executeDeletions } from "../deleter.js";

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

  if (Object.keys(cacheData).length === 0) {
    console.log("No cached scan results found. Please run 'git-purge scan' first.");
    return { deleted: [], skipped: [], failed: [] };
  }

  // 2. Resolve default branch
  let defaultBranch = options.defaultBranch || "main";
  const token = options.token !== undefined ? options.token : getToken();
  if (token && !options.defaultBranch) {
    try {
      const repoInfo = await fetchRepoInfo(owner, repo, token);
      defaultBranch = repoInfo.defaultBranch;
    } catch {
      // Keep default branch as fallback
    }
  }

  // 3. Resolve current branch and local branches
  let currentBranch = "";
  try {
    currentBranch = getCurrentBranch(cwd);
  } catch {
    // Detached head or no current branch
  }

  const localBranches = getLocalBranches(cwd);

  // 4. Filter safe branches with hard safety guards
  const { eligible, skipped } = filterBranchesForClean({
    cacheData,
    localBranches,
    currentBranch,
    defaultBranch,
    cwd,
  });

  // Display warnings for any skipped branches (e.g. unpushed commits)
  if (skipped.length > 0) {
    console.log("\nSkipped branches:");
    for (const item of skipped) {
      console.log(`  - ${item.name} (${item.reason})`);
    }
  }

  if (eligible.length === 0) {
    console.log("\nNo dead branches eligible for cleanup.");
    return { deleted: [], skipped, failed: [] };
  }

  console.log(`\nFound ${eligible.length} dead branch(es) eligible for deletion:`);
  for (const b of eligible) {
    console.log(`  - ${b.name} [${b.status}${b.prNumber ? `, PR #${b.prNumber}` : ""}]`);
  }
  console.log("");

  const promptFn = options.promptHandler || prompts;

  let branchesToDelete = [];

  if (options.yes) {
    // --yes flag skips per-branch confirmation
    branchesToDelete = eligible;
  } else {
    // Ask confirmation for each branch individually
    for (const branch of eligible) {
      const response = await promptFn({
        type: "confirm",
        name: "confirmDelete",
        message: `Delete branch '${branch.name}' (${branch.status}${branch.prNumber ? `, PR #${branch.prNumber}` : ""})?`,
        initial: true,
      });

      if (response.confirmDelete) {
        branchesToDelete.push(branch);
      }
    }
  }

  if (branchesToDelete.length === 0) {
    console.log("No branches selected for deletion.");
    return { deleted: [], skipped, failed: [] };
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
    return { deleted: [], skipped, failed: [] };
  }

  // 5. Execute deletions
  const { deleted, failed } = executeDeletions({
    branchesToDelete,
    repoKey,
    cacheDir: options.cacheDir,
    cwd,
  });

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

  return { deleted, skipped, failed };
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
