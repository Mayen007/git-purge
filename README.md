# Git-Purge (`git-purge-cli`)

> Find and safely clear local git branches that are dead on GitHub.

[![CI](https://github.com/Mayen007/git-purge/actions/workflows/ci.yml/badge.svg)](https://github.com/Mayen007/git-purge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

---

## Overview

Over time, local repositories accumulate dozens or hundreds of obsolete feature branches. Standard git tools like `git branch --merged` frequently miss squash-merged branches because GitHub creates a new commit on merge rather than retaining the branch's commit history.

**Git-Purge** queries GitHub's API to inspect the true state of corresponding Pull Requests (handling squash merges, rebase merges, standard merges, and closed PRs) and gives you an interactive, zero-data-loss workflow to clean up dead local branches.

---

## Key Features & Safety Guarantees

- **Accurate Merge Detection**: Checks the Pull Request merge state via GitHub API, correctly identifying squash-merged branches that `git branch --merged` misses.
- **Zero Data Loss Guarantee**:
  - **Current Branch Guard**: Never deletes the branch you are currently working on.
  - **Default Branch Guard**: Never deletes the repository's default branch (`main` / `master`), even if reported merged.
  - **Unpushed Commits Guard**: Skips and warns about any branch containing unpushed local commits.
  - **Human in the Loop**: Requires human confirmation before any destructive delete action. The `--yes` flag only bypasses per-branch prompts, never the final summary confirmation.
  - **Ambiguity Protection**: Flags branches with multiple matching PRs as `needs-review` rather than guessing.
- **Fast & Cached**: Scans are cached locally (`~/.git-purge/<repo>.json`) and respect GitHub API rate limits.

---

## Installation

```bash
npm install -g git-purge-cli
```

*Requirements: Node.js 20 LTS or newer.*

---

## Quick Start

### 1. Configure GitHub Token

Git-Purge requires a GitHub Personal Access Token (PAT) with `repo` read access (or public repo access):

```bash
git-purge config set-token <your-github-token>
```

Verify your token configuration:

```bash
git-purge config get-token
```

### 2. Scan Local Branches (`git-purge scan`)

Inspect all local branches and match them against GitHub PR status:

```bash
git-purge scan
```

Use the `--refresh` flag to bypass local cache and query GitHub for every branch:

```bash
git-purge scan --refresh
```

### 3. Clean Dead Branches (`git-purge clean`)

Interactively review and delete safe branches (`merged` or `closed`):

```bash
git-purge clean
```

Options:
- `-y, --yes`: Skip individual branch prompts and proceed directly to the final confirmation step.

---

## Branch Status Classifications

| Status | Description | Action |
| :--- | :--- | :--- |
| `merged` | Pull request was merged on GitHub (including squash & rebase merges). | Eligible for safe deletion |
| `closed` | Pull request was closed without merging. | Eligible for review/deletion |
| `open` | Pull request is currently open on GitHub. | Kept (not offered for deletion) |
| `no-pr` | No corresponding GitHub pull request found. | Kept |
| `needs-review` | Ambiguous match (multiple PRs matched) or API failure. | Skipped / flagged for manual review with specific reason |

---

## CLI Reference

```
Usage: git-purge [options] [command]

Find and safely clear local git branches that are dead on the remote.

Options:
  -V, --version    output the version number
  -h, --help       display help for command

Commands:
  scan [options]   Scan local branches and match against remote GitHub pull requests
                   Options:
                     -r, --refresh  Ignore cache and re-check every branch
  clean [options]  Safely delete local branches that are merged or closed on GitHub
                   Options:
                     -y, --yes      Skip individual branch confirmation prompts
  config           Manage git-purge configuration settings
                   Subcommands:
                     set-token <token>  Store GitHub personal access token
                     get-token          Check configured GitHub token status
```

---

## Configuration & Cache Storage

- **Configuration**: Stored at `~/.git-purge/config.json`
- **Scan Cache**: Stored per repository at `~/.git-purge/<owner>_<repo>.json` (includes default branch and branch states)

---

## Development & Testing

```bash
# Install dependencies
npm install

# Run linter
npm run lint

# Run test suite
npm test
```

---

## License

[MIT](LICENSE)
