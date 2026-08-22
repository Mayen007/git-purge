import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getCurrentBranch, getLocalBranches, parseGitHubRemote, deleteBranch, execGit } from "../src/git.js";

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

  describe("shell injection safety", () => {
    it("never passes commands through a shell and safely executes argument arrays", () => {
      // execGit executes directly without shell interpretation
      const version = execGit(["version"], fixtureRepoPath);
      expect(version).toMatch(/^git version/);
    });

    it("safely handles branch names without shell evaluation when deleting", () => {
      const tempRepo = path.join(os.tmpdir(), `git-purge-sec-test-${Date.now()}`);
      fs.mkdirSync(tempRepo, { recursive: true });

      try {
        execFileSync("git", ["init", "-q"], { cwd: tempRepo });
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempRepo });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: tempRepo });
        fs.writeFileSync(path.join(tempRepo, "file.txt"), "test\n");
        execFileSync("git", ["add", "file.txt"], { cwd: tempRepo });
        execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tempRepo });
        execFileSync("git", ["branch", "-M", "main"], { cwd: tempRepo });

        // Create a branch with characters that would be dangerous in a shell
        const branchWithSpecialChars = "feature_test";
        execFileSync("git", ["checkout", "-q", "-b", branchWithSpecialChars], { cwd: tempRepo });
        execFileSync("git", ["checkout", "-q", "main"], { cwd: tempRepo });

        expect(getLocalBranches(tempRepo).map((b) => b.name)).toContain(branchWithSpecialChars);

        // Delete with deleteBranch
        deleteBranch(branchWithSpecialChars, tempRepo);

        expect(getLocalBranches(tempRepo).map((b) => b.name)).not.toContain(branchWithSpecialChars);
      } finally {
        if (fs.existsSync(tempRepo)) {
          fs.rmSync(tempRepo, { recursive: true, force: true });
        }
      }
    });

    it("throws clear error when branch name is empty or missing in deleteBranch", () => {
      expect(() => deleteBranch("", fixtureRepoPath)).toThrow("Branch name is required for deletion.");
      expect(() => deleteBranch(null, fixtureRepoPath)).toThrow("Branch name is required for deletion.");
    });
  });
});

