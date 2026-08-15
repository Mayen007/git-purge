/**
 * Formats and prints a structured table of scanned branches.
 *
 * @param {Array<import("./types.js").MatchedBranch & { isCurrent?: boolean, isDefault?: boolean }>} branches
 */
export function printScanReport(branches) {
  if (!branches || branches.length === 0) {
    console.log("No local branches found.");
    return;
  }

  console.log("");
  console.log("Git-Purge Branch Scan Report");
  console.log("============================");
  console.log("");

  // Column definitions and widths
  const headers = {
    branch: "BRANCH",
    status: "STATUS",
    pr: "PR #",
    sha: "SHA",
    details: "INFO",
  };

  const rows = branches.map((b) => {
    const details = [];
    if (b.isCurrent) details.push("current");
    if (b.isDefault) details.push("default");
    if (b.hasUnpushedCommits) details.push("unpushed work");

    return {
      branch: b.name,
      status: b.status,
      pr: b.prNumber ? `#${b.prNumber}` : "-",
      sha: (b.sha || "").slice(0, 7),
      details: details.length > 0 ? `[${details.join(", ")}]` : "",
    };
  });

  const colWidths = {
    branch: Math.max(headers.branch.length, ...rows.map((r) => r.branch.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
    pr: Math.max(headers.pr.length, ...rows.map((r) => r.pr.length)),
    sha: Math.max(headers.sha.length, ...rows.map((r) => r.sha.length)),
    details: Math.max(headers.details.length, ...rows.map((r) => r.details.length)),
  };

  const pad = (str, len) => (str + " ".repeat(Math.max(0, len - str.length)));

  // Print Header
  const headerLine = `${pad(headers.branch, colWidths.branch)}  ${pad(headers.status, colWidths.status)}  ${pad(headers.pr, colWidths.pr)}  ${pad(headers.sha, colWidths.sha)}  ${headers.details}`;
  const dividerLine = `${"-".repeat(colWidths.branch)}  ${"-".repeat(colWidths.status)}  ${"-".repeat(colWidths.pr)}  ${"-".repeat(colWidths.sha)}  ${"-".repeat(Math.max(4, colWidths.details))}`;

  console.log(headerLine);
  console.log(dividerLine);

  // Print Rows
  for (const row of rows) {
    console.log(
      `${pad(row.branch, colWidths.branch)}  ${pad(row.status, colWidths.status)}  ${pad(row.pr, colWidths.pr)}  ${pad(row.sha, colWidths.sha)}  ${row.details}`
    );
  }

  // Summary statistics
  const mergedCount = branches.filter((b) => b.status === "merged").length;
  const closedCount = branches.filter((b) => b.status === "closed").length;
  const openCount = branches.filter((b) => b.status === "open").length;
  const noPrCount = branches.filter((b) => b.status === "no-pr").length;
  const needsReviewCount = branches.filter((b) => b.status === "needs-review").length;

  console.log("");
  console.log(`Total: ${branches.length} branches scanned (${mergedCount} merged, ${closedCount} closed, ${openCount} open, ${noPrCount} no-pr, ${needsReviewCount} needs-review)`);
  console.log(`Eligible for cleanup in 'clean': ${mergedCount + closedCount} branch(es)`);
  console.log("");
}
