import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoPath = path.resolve(__dirname, "../test/fixtures/repo");

export function setupFixtures() {
  if (fs.existsSync(fixtureRepoPath)) {
    fs.rmSync(fixtureRepoPath, { recursive: true, force: true });
  }
  fs.mkdirSync(fixtureRepoPath, { recursive: true });

  execFileSync("git", ["init", "-q"], { cwd: fixtureRepoPath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: fixtureRepoPath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: fixtureRepoPath });

  fs.writeFileSync(path.join(fixtureRepoPath, "file.txt"), "init\n");
  execFileSync("git", ["add", "file.txt"], { cwd: fixtureRepoPath });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: fixtureRepoPath });
  execFileSync("git", ["branch", "-M", "main"], { cwd: fixtureRepoPath });

  const branches = [
    "feature/normal-merge",
    "feature/squash-merge",
    "feature/closed-no-merge",
    "feature/still-open",
    "feature/no-pr",
    "feature/unpushed-work",
  ];

  for (const name of branches) {
    execFileSync("git", ["checkout", "-q", "-b", name], { cwd: fixtureRepoPath });
    fs.appendFileSync(path.join(fixtureRepoPath, "file.txt"), `${name}\n`);
    execFileSync("git", ["commit", "-q", "-am", `work on ${name}`], { cwd: fixtureRepoPath });
    execFileSync("git", ["checkout", "-q", "main"], { cwd: fixtureRepoPath });
  }

  console.log(`Fixture repo created at ${fixtureRepoPath}`);
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupFixtures();
}
