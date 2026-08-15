# ROADMAP.md — Git-Purge

## North star

v1.0 is done when a developer can install Git-Purge, run `scan` and `clean` on a real repo with 100+ branches, and trust the tool with zero data loss.

## Phase 0: setup

Tasks:
- `package.json`, `.gitignore`, `LICENSE`, and the CI workflow already exist. Do not recreate them — see AGENTS.md.
- Run `scripts/setup-fixtures.sh` once to confirm it works in your environment.
- Build the CLI skeleton around the existing `bin` entry in `package.json`.
- Add the config command. Store the GitHub token.

Verify:
- `git-purge --help` lists all three commands.
- `git-purge config set-token <token>` stores the token correctly.
- `npm test` runs and the CI workflow passes on the first push.

## Phase 1: read-only scan (MVP)

Tasks:
- Build the git reader module.
- Build the remote matcher module.
- Build the classifier.
- Build the cache file (write only, in this phase).
- Build the dry-run report.

Verify:
- Run `scan` against the fixture repo. Every branch gets the correct status.
- The squash-merged fixture branch is labeled `merged`, not `open`.
- No branch is deleted. The cache file is created.

## Phase 2: safe delete

Tasks:
- Build the clean command, with per-branch confirmation.
- Build the delete executor.
- Add the default-branch guard and the current-branch guard.
- Add the unpushed-commits guard.

Verify:
- Run `clean` against the fixture repo. Only `merged` and `closed` branches are offered.
- The default branch and current branch never appear in the offered list.
- A branch with unpushed commits is skipped, with a warning.

## Phase 3: reliability

Tasks:
- Add the `--refresh` flag.
- Add rate-limit handling, using the `X-RateLimit-Remaining` header.
- Add the no-network fallback to cached data.
- Add `needs-review` flagging for ambiguous matches.

Verify:
- Simulate a low rate-limit response. Confirm the tool pauses instead of failing.
- Simulate no network. Confirm the tool uses cached data and shows a warning.

## Phase 4: polish and ship

Tasks:
- Write the README.
- Publish as an npm package.
- Add CI, running the full test suite on every push.

Verify:
- `npm install -g` from a fresh clone works end to end.
- CI passes on a clean checkout.

## Phase 5: stretch goals (explicitly out of v1.0 scope)

- Add a GitLab adapter, behind the same matcher interface.
- Build a VS Code sidebar, on top of the same cache and classifier.
- Add team mode: one shared config across many repos.
