import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getCurrentBranch, getLocalBranches, parseGitHubRemote } from "../src/git.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoPath = path.resolve(__dirname, "fixtures/repo");

describe("git reader module", () => {
  beforeAll(() => {
    // Check that fixture repo exists
    if (!fs.existsSync(path.join(fixtureRepoPath, ".git"))) {
      throw new Error(`Fixture repo not found at ${fixtureRepoPath}. Run scripts/setup-fixtures.sh first.`);
    }
  });

  it("gets current active branch (main)", () => {
    const current = getCurrentBranch(fixtureRepoPath);
    expect(current).toBe("main");
  });

  it("lists all local branches from fixture repo", () => {
    const branches = getLocalBranches(fixtureRepoPath);
    const branchNames = branches.map((b) => b.name);

    expect(branchNames).toContain("main");
    expect(branchNames).toContain("feature/normal-merge");
    expect(branchNames).toContain("feature/squash-merge");
    expect(branchNames).toContain("feature/closed-no-merge");
    expect(branchNames).toContain("feature/still-open");
    expect(branchNames).toContain("feature/no-pr");
    expect(branchNames).toContain("feature/unpushed-work");

    for (const b of branches) {
      expect(b.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("parses HTTPS and SSH remote GitHub URLs correctly", () => {
    expect(parseGitHubRemote("https://github.com/Mayen007/git-purge.git")).toEqual({
      owner: "Mayen007",
      repo: "git-purge",
    });

    expect(parseGitHubRemote("https://github.com/Mayen007/git-purge")).toEqual({
      owner: "Mayen007",
      repo: "git-purge",
    });

    expect(parseGitHubRemote("git@github.com:Mayen007/git-purge.git")).toEqual({
      owner: "Mayen007",
      repo: "git-purge",
    });

    expect(parseGitHubRemote("ssh://git@github.com/Mayen007/git-purge.git")).toEqual({
      owner: "Mayen007",
      repo: "git-purge",
    });

    expect(parseGitHubRemote("https://gitlab.com/user/repo.git")).toBeNull();
    expect(parseGitHubRemote("")).toBeNull();
  });
});
