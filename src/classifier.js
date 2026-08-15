import { BranchStatuses } from "./types.js";

/**
 * Classifies a branch's status based on GitHub PR data.
 *
 * @param {Array<Object> | Object | null} prData - The PR response from GitHub API or fixture mock
 * @returns {{ status: import("./types.js").BranchStatus, prNumber: number | null, reason?: string }}
 */
export function classifyBranch(prData) {
  // If null, undefined, or empty list -> no PR exists
  if (!prData) {
    return {
      status: BranchStatuses.NO_PR,
      prNumber: null,
    };
  }

  if (Array.isArray(prData)) {
    if (prData.length === 0) {
      return {
        status: BranchStatuses.NO_PR,
        prNumber: null,
      };
    }

    // Never guess ambiguous matches: if more than 1 PR result is returned, flag as needs-review with reason
    if (prData.length > 1) {
      return {
        status: BranchStatuses.NEEDS_REVIEW,
        prNumber: null,
        reason: "multiple PRs matched",
      };
    }

    // Exactly one PR in array
    return classifySinglePR(prData[0]);
  }

  // Single PR object passed directly (e.g. from mock fixture)
  return classifySinglePR(prData);
}

/**
 * Classify a single PR object.
 * Handles both GitHub REST API format (number, merged_at, state)
 * and test mock format (prNumber, merged, state).
 *
 * @param {Object} pr
 * @returns {{ status: import("./types.js").BranchStatus, prNumber: number | null, reason?: string }}
 */
function classifySinglePR(pr) {
  const prNumber = pr.number ?? pr.prNumber ?? null;

  // Check if merged (either via boolean flag in mock/detailed API, or via merged_at timestamp)
  const isMerged = pr.merged === true || Boolean(pr.merged_at);

  if (isMerged) {
    return {
      status: BranchStatuses.MERGED,
      prNumber,
    };
  }

  const state = (pr.state || "").toLowerCase();
  if (state === "closed") {
    return {
      status: BranchStatuses.CLOSED,
      prNumber,
    };
  }

  if (state === "open") {
    return {
      status: BranchStatuses.OPEN,
      prNumber,
    };
  }

  // If state is unhandled or unrecognized, mark as needs-review with reason
  return {
    status: BranchStatuses.NEEDS_REVIEW,
    prNumber,
    reason: `unrecognized PR state: ${state || "unknown"}`,
  };
}
