# AGENTS.md — Git-Purge

## Purpose

This file gives build instructions to an AI coding agent. Read it in full before you write any code.

## North star

v1.0 is done when a developer can install Git-Purge, run `scan` and `clean` on a real repo with 100+ branches, and trust the tool with zero data loss.

## Non-goals for v1

- No GUI. CLI only.
- No GitLab or Bitbucket support. GitHub only.
- No team mode or shared config across repos.
- No automatic delete. Every delete needs a human confirmation.

## Decisions already made — do not revisit these

- Language: Node.js. Do not propose Python, Go, or Rust.
- Storage: a local JSON file. Do not propose SQLite or a remote database.
- CLI framework: Commander.
- Package manager: npm.
- npm package name: `git-purge-cli`. The plain name `git-purge` is already taken on npm by another project. The command the user types stays `git-purge` — only the published package name changes.
- HTTP client: Node's built-in `fetch`. Do not add `axios` or `node-fetch` as a dependency.
- Confirmation prompts: the `prompts` package. Do not add `inquirer`.
- Default branch detection: read it from the GitHub API response (`repos.get().default_branch`), not from local git guesswork.
- Current branch detection: `git branch --show-current`.

## Repo scaffolding — already created, do not rewrite

These files already exist. Use them as they are. Only edit `package.json` to add real dependency versions as you install them.

- `package.json` — name, bin entry, and scripts are already set.
- `.gitignore`
- `LICENSE` (MIT — replace `<your name>` with the real copyright holder before publishing)
- `.github/workflows/ci.yml`
- `scripts/setup-fixtures.sh`
- `test/fixtures/github-api-mocks.json`

## Environment

- Node version: 20 LTS or newer.
- Linter: ESLint, standard config.
- Test runner: Vitest or Jest. Pick one. State your choice in the first commit message.

## Data contracts

Define these types first. Write the logic after the types exist.

```ts
type BranchStatus = "merged" | "closed" | "open" | "no-pr" | "needs-review";

interface LocalBranch {
  name: string;
  sha: string;
  hasUnpushedCommits: boolean;
}

interface MatchedBranch extends LocalBranch {
  prNumber: number | null;
  status: BranchStatus;
  lastCheckedAt: string; // ISO date
}
```

## Hard safety rules — never break these

- Never delete the current branch.
- Never delete the repo's default branch (main or master), even if GitHub reports it merged.
- Never run a delete step without a confirmation prompt. A `--yes` flag skips the per-branch prompt only. It never skips the final summary confirmation.
- Never trust `git branch --merged` alone. GitHub often uses squash merges. A squash-merged branch shows no local merge commit. Check the PR's merged state through the API instead.
- Never guess an ambiguous match. Flag it as `needs-review` instead.

## GitHub API specifics

- Endpoint: `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all`
- Check the `X-RateLimit-Remaining` header on every response. Pause requests if it drops below 50.
- Read the personal access token from `git-purge config`. Do not fall back to an environment variable silently. Fail with a clear message if no token is set.

## Commands to build

### `git-purge scan`

Steps:
- List all local branches and their last commit SHA.
- For each branch, find a matching PR through the endpoint above.
- Label each branch: `merged`, `closed`, `open`, `no-pr`, or `needs-review`.
- Write the result to the cache file.
- Print a table. Delete nothing in this step.

Definition of done:
- Run against the test fixture repo (see Testing). Every branch gets the correct status.
- The squash-merged fixture branch is labeled `merged`, not `open` or `no-pr`.
- The cache file exists after the run, with one entry per branch.

### `git-purge clean`

Steps:
- Read the last scan from the cache.
- Show only branches labeled `merged` or `closed`.
- Ask the user to confirm each branch, or confirm all at once.
- Delete only confirmed branches, with `git branch -D`.
- Skip any branch with unpushed local commits. Warn instead of deleting.

Definition of done:
- Run against the fixture repo. Only safe branches are offered for delete.
- The default branch and the current branch never appear in the offered list.
- A branch with unpushed commits is skipped, with a warning shown to the user.

### `git-purge config`

Steps:
- Store a GitHub personal access token.
- Store the repo owner and name, or detect it from the git remote.

Definition of done:
- `git-purge config set-token <token>` stores the token.
- `scan` fails with a clear message if no token is set yet.

## Cache file

- Path: `~/.git-purge/<owner>_<repo>.json`
- One entry per branch: name, SHA, PR number, status, last checked time.
- Example entry:

```json
{
  "feature/login-page": {
    "sha": "a1b2c3d",
    "prNumber": 142,
    "status": "merged",
    "lastCheckedAt": "2026-08-10T09:00:00Z"
  }
}
```

- Add a `--refresh` flag to `scan` that ignores the cache and re-checks every branch.

## Rate limits

- An authenticated user gets 5,000 requests per hour.
- Skip branches already marked `merged` or `closed` on a normal scan.
- Only `--refresh` re-checks them.

## Error handling

- No network: use the cached data. Print a clear warning that the data may be old.
- Ambiguous match (more than one PR result): label the branch `needs-review`. Never guess.
- A single failed API call: skip that branch, report it at the end, and keep scanning the rest.

## Testing

- Run `scripts/setup-fixtures.sh` to build the fixture repo. Do not build it by hand — the script is the single source of truth for fixture branches. It runs automatically before `npm test`.
- The fixture repo has six branches: `feature/normal-merge`, `feature/squash-merge`, `feature/closed-no-merge`, `feature/still-open`, `feature/no-pr`, `feature/unpushed-work`.
- `test/fixtures/github-api-mocks.json` holds the mocked PR state for each branch. Load this file in tests instead of calling the live GitHub API.
- Write a unit test for the classifier for every branch in the mock file. The `feature/squash-merge` case is the most important one — it is the case a naive implementation gets wrong.

## Review checkpoints

Stop after each phase in ROADMAP.md. Before starting the next phase, report:
- What was built.
- The test output.
- Any assumption you made that was not covered in this file.

## Style

- Use small, plain functions. One task per function.
- Keep GitHub API calls in one module. Keep local git calls in a separate module.
- Comment any code where the intent is not obvious from the code itself.
