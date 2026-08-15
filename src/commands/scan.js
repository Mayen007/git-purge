import { getToken } from "../config.js";
import { getCurrentBranch, getLocalBranches, hasUnpushedCommits, detectGitHubRepo } from "../git.js";
import { fetchRepoInfo, fetchPullRequestsForBranch } from "../github.js";
import { classifyBranch } from "../classifier.js";
import { readCache, writeCache } from "../cache.js";
import { printScanReport } from "../reporter.js";

/**
 * Executes the scan logic.
 *
 * @param {Object} options
 * @param {boolean} [options.refresh]
 * @param {string} [options.owner]
 * @param {string} [options.repo]
 * @param {string} [options.cwd]
 * @param {Function} [options.fetcher] - Custom fetcher for testing
 * @param {string} [options.cacheDir] - Custom cache dir for testing
 * @param {string} [options.defaultBranch]
 * @param {string} [options.token]
 * @returns {Promise<Array<import("../types.js").MatchedBranch>>}
 */
export async function performScan(options = {}) {
  const cwd = options.cwd || process.cwd();
  
  // 1. Verify token
  const token = options.token !== undefined ? options.token : getToken();
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("No GitHub token configured. Please set your token with: git-purge config set-token <token>");
  }

  // 2. Detect repository
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
  const existingBranches = cacheData.branches || {};
  const updatedBranches = { ...existingBranches };

  // 3. Detect current and default branch
  let currentBranch = "";
  try {
    currentBranch = getCurrentBranch(cwd);
  } catch {
    // Current branch might be detached HEAD
  }

  let defaultBranch = options.defaultBranch || null;
  if (!defaultBranch) {
    try {
      const repoInfo = await fetchRepoInfo(owner, repo, token);
      defaultBranch = repoInfo.defaultBranch;
    } catch (err) {
      if (cacheData.defaultBranch) {
        defaultBranch = cacheData.defaultBranch;
        console.warn(`Warning: Could not fetch default branch from GitHub: ${err.message}. Using cached default branch '${defaultBranch}'.`);
      } else {
        console.warn(`Warning: Could not fetch default branch from GitHub: ${err.message}.`);
      }
    }
  }

  // 4. List local branches
  const localBranches = getLocalBranches(cwd);
  if (localBranches.length === 0) {
    console.log("No local branches found.");
    return [];
  }

  const failedBranches = [];
  const matchedBranches = [];

  // 5. Match each branch
  for (const branch of localBranches) {
    const isCurrent = branch.name === currentBranch;
    const isDefault = defaultBranch ? branch.name === defaultBranch : false;
    const unpushed = hasUnpushedCommits(branch.name, cwd);

    const cachedEntry = existingBranches[branch.name];

    // Check if we can reuse cached status (skip API call if already merged/closed and not --refresh)
    const canUseCache =
      !options.refresh &&
      cachedEntry &&
      cachedEntry.sha === branch.sha &&
      (cachedEntry.status === "merged" || cachedEntry.status === "closed");

    if (canUseCache) {
      matchedBranches.push({
        name: branch.name,
        sha: branch.sha,
        hasUnpushedCommits: unpushed,
        prNumber: cachedEntry.prNumber,
        status: cachedEntry.status,
        lastCheckedAt: cachedEntry.lastCheckedAt,
        isCurrent,
        isDefault,
      });
      continue;
    }

    // Query GitHub API
    try {
      const prs = options.fetcher
        ? await options.fetcher(branch.name)
        : await fetchPullRequestsForBranch(owner, repo, branch.name, token);

      const classification = classifyBranch(prs);
      const lastCheckedAt = new Date().toISOString();

      const matched = {
        name: branch.name,
        sha: branch.sha,
        hasUnpushedCommits: unpushed,
        prNumber: classification.prNumber,
        status: classification.status,
        lastCheckedAt,
        isCurrent,
        isDefault,
      };

      matchedBranches.push(matched);

      // Update cache
      updatedBranches[branch.name] = {
        sha: branch.sha,
        prNumber: classification.prNumber,
        status: classification.status,
        lastCheckedAt,
      };
    } catch (apiError) {
      // Offline fallback: if network failed, try to use cache if available
      if (cachedEntry) {
        console.warn(`Warning: Network call failed for ${branch.name}. Using cached data from ${cachedEntry.lastCheckedAt}.`);
        matchedBranches.push({
          name: branch.name,
          sha: branch.sha,
          hasUnpushedCommits: unpushed,
          prNumber: cachedEntry.prNumber,
          status: cachedEntry.status,
          lastCheckedAt: cachedEntry.lastCheckedAt,
          isCurrent,
          isDefault,
        });
      } else {
        failedBranches.push({ branch: branch.name, error: apiError.message });
        matchedBranches.push({
          name: branch.name,
          sha: branch.sha,
          hasUnpushedCommits: unpushed,
          prNumber: null,
          status: "needs-review",
          lastCheckedAt: new Date().toISOString(),
          isCurrent,
          isDefault,
        });
      }
    }
  }

  // 6. Write updated cache to file (storing defaultBranch alongside branches)
  writeCache(
    repoKey,
    {
      defaultBranch: defaultBranch || cacheData.defaultBranch || null,
      branches: updatedBranches,
    },
    options.cacheDir
  );

  // 7. Print formatted report
  printScanReport(matchedBranches);

  if (failedBranches.length > 0) {
    console.warn("\nThe following branch(es) encountered errors during API check and were marked 'needs-review':");
    for (const f of failedBranches) {
      console.warn(` - ${f.branch}: ${f.error}`);
    }
  }

  return matchedBranches;
}

/**
 * Registers the `scan` command on the Commander program.
 * @param {import("commander").Command} program
 */
export function registerScanCommand(program) {
  program
    .command("scan")
    .description("Scan local branches and match against remote GitHub pull requests")
    .option("-r, --refresh", "Ignore cache and re-check every branch against GitHub")
    .action(async (options) => {
      try {
        await performScan(options);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
