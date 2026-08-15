/**
 * GitHub API client for fetching pull requests and repository information.
 * Uses Node's built-in fetch without external HTTP libraries.
 */

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Handle rate limit headers from GitHub API.
 * If remaining requests fall below 50, pause execution until rate limit resets or back off.
 *
 * @param {Headers} headers
 */
export async function checkRateLimit(headers) {
  const remainingHeader = headers.get("x-ratelimit-remaining");
  const resetHeader = headers.get("x-ratelimit-reset");

  if (remainingHeader !== null) {
    const remaining = parseInt(remainingHeader, 10);
    if (remaining < 50 && resetHeader !== null) {
      const resetTime = parseInt(resetHeader, 10) * 1000;
      const now = Date.now();
      const waitMs = Math.max(0, resetTime - now + 1000);
      console.warn(`[GitHub API] Rate limit low (${remaining} remaining). Pausing for ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Make an authenticated GitHub API request.
 *
 * @param {string} endpoint - e.g. "/repos/owner/repo/pulls"
 * @param {string} token - Personal Access Token
 * @returns {Promise<{ data: any, headers: Headers, status: number }>}
 */
export async function githubRequest(endpoint, token) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("No GitHub token configured. Run: git-purge config set-token <token>");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token.trim()}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "git-purge-cli",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  await checkRateLimit(response.headers);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("GitHub authentication failed. Please check your token with: git-purge config set-token <token>");
    }
    if (response.status === 404) {
      throw new Error(`GitHub resource not found at ${url}. Check owner and repository name.`);
    }
    const errorBody = await response.text().catch(() => "");
    throw new Error(`GitHub API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  return {
    data,
    headers: response.headers,
    status: response.status,
  };
}

/**
 * Fetch repo details including default_branch.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @returns {Promise<{ defaultBranch: string }>}
 */
export async function fetchRepoInfo(owner, repo, token) {
  const { data } = await githubRequest(`/repos/${owner}/${repo}`, token);
  return {
    defaultBranch: data.default_branch || "main",
  };
}

/**
 * Fetch PRs for a given branch head.
 * Endpoint: GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} token
 * @returns {Promise<Array<Object>>}
 */
export async function fetchPullRequestsForBranch(owner, repo, branch, token) {
  // Encode head query parameter: head={owner}:{branch}
  const headQuery = encodeURIComponent(`${owner}:${branch}`);
  const { data } = await githubRequest(`/repos/${owner}/${repo}/pulls?head=${headQuery}&state=all`, token);
  return Array.isArray(data) ? data : [];
}
