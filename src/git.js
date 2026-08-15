import { execSync } from "node:child_process";

/**
 * Execute a git command synchronously and return the trimmed stdout string.
 * @param {string} command
 * @param {string} [cwd]
 * @returns {string}
 */
function execGit(command, cwd = process.cwd()) {
  try {
    return execSync(`git ${command}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : "";
    throw new Error(`Git command failed (${command}): ${stderr || error.message}`);
  }
}

/**
 * Get the current active branch name.
 * Uses: git branch --show-current
 * @param {string} [cwd]
 * @returns {string}
 */
export function getCurrentBranch(cwd = process.cwd()) {
  return execGit("branch --show-current", cwd);
}

/**
 * List all local branches with their latest commit SHA.
 * @param {string} [cwd]
 * @returns {Array<{ name: string, sha: string }>}
 */
export function getLocalBranches(cwd = process.cwd()) {
  const output = execGit('for-each-ref --format="%(refname:short)|%(objectname)" refs/heads', cwd);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha] = line.split("|");
      return { name, sha };
    });
}

/**
 * Check if a local branch has unpushed commits.
 * Compares against its upstream tracking branch if configured,
 * or checks for unpushed commits against remote origin.
 * @param {string} branchName
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function hasUnpushedCommits(branchName, cwd = process.cwd()) {
  try {
    // Check if upstream tracking branch is set and compare
    const upstream = execGit(`rev-parse --abbrev-ref ${branchName}@{upstream}`, cwd);
    if (upstream) {
      const unpushedCount = execGit(`rev-list --count ${upstream}..${branchName}`, cwd);
      return parseInt(unpushedCount, 10) > 0;
    }
  } catch {
    // No upstream branch configured for this local branch.
    // If no upstream is configured, check against remote origin/<branchName> if it exists
    try {
      const originRef = `origin/${branchName}`;
      execGit(`rev-parse --verify ${originRef}`, cwd);
      const unpushedCount = execGit(`rev-list --count ${originRef}..${branchName}`, cwd);
      return parseInt(unpushedCount, 10) > 0;
    } catch {
      // Branch does not exist on origin at all - all commits are local
      return true;
    }
  }
  return false;
}

/**
 * Delete a local branch with `git branch -D`.
 * @param {string} branchName
 * @param {string} [cwd]
 * @returns {string}
 */
export function deleteBranch(branchName, cwd = process.cwd()) {
  if (!branchName || typeof branchName !== "string") {
    throw new Error("Branch name is required for deletion.");
  }
  return execGit(`branch -D "${branchName}"`, cwd);
}

/**
 * Extract GitHub owner and repo from a git remote URL.
 * Supports HTTPS, SSH, and git:// URL patterns.
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitHubRemote(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  const cleanUrl = url.trim();

  // Pattern: git@github.com:owner/repo.git or https://github.com/owner/repo.git
  const sshPattern = /^git@github\.com:([^/]+)\/(.+?)(\.git)?$/;
  const httpsPattern = /^https?:\/\/(?:[^@:]+@)?github\.com\/([^/]+)\/(.+?)(\.git)?$/;
  const sshProtocolPattern = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(\.git)?$/;

  const match = cleanUrl.match(sshPattern) || cleanUrl.match(httpsPattern) || cleanUrl.match(sshProtocolPattern);
  if (match) {
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, ""),
    };
  }

  return null;
}

/**
 * Get the remote URL for origin.
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function getRemoteOriginUrl(cwd = process.cwd()) {
  try {
    return execGit("config --get remote.origin.url", cwd);
  } catch {
    return null;
  }
}

/**
 * Detect GitHub owner and repo from local git remote.
 * @param {string} [cwd]
 * @returns {{ owner: string, repo: string } | null}
 */
export function detectGitHubRepo(cwd = process.cwd()) {
  const remoteUrl = getRemoteOriginUrl(cwd);
  if (!remoteUrl) {
    return null;
  }
  return parseGitHubRemote(remoteUrl);
}
