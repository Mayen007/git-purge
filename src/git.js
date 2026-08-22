import { execFileSync } from "node:child_process";

/**
 * Execute a git command synchronously using execFileSync (without shell parsing).
 *
 * Never constructs a shell command from branch names, repository names, paths, or remote data.
 *
 * @param {string[]} args - Array of command-line arguments passed directly to the git executable
 * @param {string} [cwd]
 * @returns {string}
 */
export function execGit(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : "";
    throw new Error(`Git command failed (git ${args.join(" ")}): ${stderr || error.message}`);
  }
}

/**
 * Get the current active branch name.
 * Uses: git branch --show-current
 * @param {string} [cwd]
 * @returns {string}
 */
export function getCurrentBranch(cwd = process.cwd()) {
  return execGit(["branch", "--show-current"], cwd);
}

/**
 * List all local branches with their latest commit SHA.
 * @param {string} [cwd]
 * @returns {Array<{ name: string, sha: string }>}
 */
export function getLocalBranches(cwd = process.cwd()) {
  const output = execGit(["for-each-ref", "--format=%(refname:short)|%(objectname)", "refs/heads"], cwd);
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
 *
 * Checks:
 * 1. Upstream tracking branch if configured (branch@{upstream})
 * 2. Remote tracking ref origin/<branchName> if it exists
 * 3. If remote is configured but no remote branch exists:
 *    checks whether commits are already contained in the default remote branch (origin/main).
 *    If not contained, the branch has unpushed local-only commits.
 *
 * @param {string} branchName
 * @param {string} [cwd]
 * @returns {boolean}
 */
export function hasUnpushedCommits(branchName, cwd = process.cwd()) {
  try {
    // 1. Check if upstream tracking branch is set
    const upstream = execGit(["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`], cwd);
    if (upstream) {
      const unpushedCount = execGit(["rev-list", "--count", `${upstream}..${branchName}`], cwd);
      return parseInt(unpushedCount, 10) > 0;
    }
  } catch {
    // No upstream branch configured
  }

  try {
    // 2. Check if remote tracking ref origin/<branchName> exists
    const originRef = `origin/${branchName}`;
    execGit(["rev-parse", "--verify", originRef], cwd);
    const unpushedCount = execGit(["rev-list", "--count", `${originRef}..${branchName}`], cwd);
    return parseInt(unpushedCount, 10) > 0;
  } catch {
    // No origin/<branchName> ref
  }

  // 3. If remotes exist, check if commits are in the default remote branch
  try {
    const remotes = execGit(["remote"], cwd);
    if (remotes && remotes.trim().length > 0) {
      const defaultRemoteBranches = ["origin/main", "origin/master", "origin/HEAD"];
      for (const ref of defaultRemoteBranches) {
        try {
          execGit(["rev-parse", "--verify", ref], cwd);
          const count = execGit(["rev-list", "--count", `${ref}..${branchName}`], cwd);
          if (parseInt(count, 10) === 0) {
            return false;
          }
        } catch {
          // Ref does not exist, continue
        }
      }
      // Commits not in default remote branch and no branch ref on origin
      return true;
    }
  } catch {
    // Ignore
  }

  return false;
}

/**
 * Delete a local branch with `git branch -D -- <branchName>`.
 * Uses '--' argument delimiter to prevent branch names starting with dashes from being parsed as flags.
 *
 * @param {string} branchName
 * @param {string} [cwd]
 * @returns {string}
 */
export function deleteBranch(branchName, cwd = process.cwd()) {
  if (!branchName || typeof branchName !== "string") {
    throw new Error("Branch name is required for deletion.");
  }
  return execGit(["branch", "-D", "--", branchName], cwd);
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
    return execGit(["config", "--get", "remote.origin.url"], cwd);
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

