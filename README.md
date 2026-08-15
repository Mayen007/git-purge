# Git-Purge (`git-purge-cli`)

Git-Purge is a CLI tool that finds and safely clears local git branches that are dead on GitHub. It inspects the true state of corresponding pull requests via GitHub's API (accurately identifying squash merges, rebase merges, and closed PRs that `git branch --merged` misses) and provides an interactive, safe cleanup workflow. Every deletion requires explicit human confirmation with zero risk of accidental data loss.

---

## Installation

```bash
npm install -g git-purge-cli
```

*Requirements: Node.js 20 LTS or newer.*

---

## Usage

### 1. `config` — Configure GitHub Personal Access Token

Store your GitHub Personal Access Token (PAT) with repository read permissions:

```bash
git-purge config set-token ghp_yourPersonalAccessToken123
```

Output:
```
GitHub personal access token stored successfully.
```

Check the status of your configured token:

```bash
git-purge config get-token
```

Output:
```
GitHub token is configured: ghp_...c123
```

---

### 2. `scan` — Scan and Classify Local Branches

Scan all local branches in the current repository and match them against GitHub pull requests. Scans are read-only and never delete anything.

```bash
git-purge scan
```

Real output from running against the test fixture repository:

```
Git-Purge Branch Scan Report
============================

BRANCH                   STATUS  PR #  SHA      INFO
-----------------------  ------  ----  -------  ---------------------------------
feature/closed-no-merge  closed  #103  2659436  [unpushed work]
feature/no-pr            no-pr   -     cb3cd04  [unpushed work]
feature/normal-merge     merged  #101  c916be7  [unpushed work]
feature/squash-merge     merged  #102  c55cf82  [unpushed work]
feature/still-open       open    #104  ce213a3  [unpushed work]
feature/unpushed-work    no-pr   -     60009f5  [unpushed work]
main                     no-pr   -     498f092  [current, default, unpushed work]

Total: 7 branches scanned (2 merged, 1 closed, 1 open, 3 no-pr, 0 needs-review)
Eligible for cleanup in 'clean': 3 branch(es)
```

Use `-r, --refresh` to ignore the local cache and query GitHub fresh for every branch:

```bash
git-purge scan --refresh
```

---

### 3. `clean` — Safely Delete Dead Branches

Interactively delete local branches that have been merged or closed on GitHub.

```bash
git-purge clean
```

Example run output:

```
Found 2 dead branch(es) eligible for deletion:
  - feature/squash-merge [merged, PR #102]
  - feature/closed-no-merge [closed, PR #103]

? Delete branch 'feature/squash-merge'? (y/N) › true
? Delete branch 'feature/closed-no-merge'? (y/N) › true
? Ready to delete 2 branch(es). Proceed? (y/N) › true

Clean Summary:
  ✓ Deleted branch: feature/squash-merge
  ✓ Deleted branch: feature/closed-no-merge

Successfully deleted 2 branch(es).
```

Options:
- `-y, --yes`: Skip individual per-branch confirmation prompts and proceed directly to the final summary confirmation.

---

## Safety Guarantees

- **Mandatory Confirmation**: `clean` **never** deletes any branch without human confirmation. The `--yes` flag only skips per-branch prompts; it never skips the final summary confirmation.
- **Protected Branches**:
  - **Default Branch**: The repository's default branch (`main` or `master`) is **never touched**, even if reported merged.
  - **Current Branch**: The branch you currently have checked out is **never touched**.
- **Unpushed Commits Guard**: Any branch containing unpushed local commits is automatically skipped and warned about.
- **Ambiguity Protection**: Ambiguous PR matches or API check failures are marked `needs-review` with specific reasons and are never offered for deletion.

---

## License

[MIT](LICENSE)
