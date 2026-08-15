/**
 * @typedef {"merged" | "closed" | "open" | "no-pr" | "needs-review"} BranchStatus
 */

/**
 * @typedef {Object} LocalBranch
 * @property {string} name
 * @property {string} sha
 * @property {boolean} hasUnpushedCommits
 */

/**
 * @typedef {Object} MatchedBranch
 * @property {string} name
 * @property {string} sha
 * @property {boolean} hasUnpushedCommits
 * @property {number | null} prNumber
 * @property {BranchStatus} status
 * @property {string} [reason] - Explanatory reason for needs-review status (e.g. "multiple PRs matched", "API check failed")
 * @property {string} lastCheckedAt - ISO date string
 */

export const BranchStatuses = {
  MERGED: "merged",
  CLOSED: "closed",
  OPEN: "open",
  NO_PR: "no-pr",
  NEEDS_REVIEW: "needs-review",
};
