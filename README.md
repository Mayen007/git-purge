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

Git-Purge uses GitHub's API to check pull request merge statuses and repository metadata. To authenticate, you will need a GitHub Personal Access Token (PAT).

#### How to get a token:
1. Visit **[GitHub → Personal access tokens (classic)](https://github.com/settings/tokens/new)**.
2. Under **Note**, enter a name (e.g., `git-purge-cli`).
3. Select an expiration period (e.g. 90 days or No expiration).
4. Select scopes:
   - For **public repositories only**: check `public_repo`.
   - For **private & public repositories**: check `repo` (Full control of private repositories).
5. Click **Generate token** at the bottom and copy the token (starts with `ghp_`).

> [!TIP]
> **Using Fine-Grained Personal Access Tokens?**
> You can also create a [Fine-Grained Token](https://github.com/settings/personal-access-tokens/new) with **Repository permissions**:
> - `Pull requests`: **Read-only**
> - `Metadata`: **Read-only**

#### Store your token:
```bash
git-purge config set-token ghp_yourPersonalAccessToken123
```

Output:
```
GitHub personal access token stored successfully.
```

#### Check token status:
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
-----------------------  ------  ----  -------  ------------------
feature/closed-no-merge  closed  #103  2659436  
feature/no-pr            no-pr   -     cb3cd04  
feature/normal-merge     merged  #101  c916be7  
feature/squash-merge     merged  #102  c55cf82  
feature/still-open       open    #104  ce213a3  
feature/unpushed-work    no-pr   -     60009f5  
main                     no-pr   -     498f092  [current, default]

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

Real output from running against the test fixture repository:

```
Skipped branches:
  - main (Current active branch)

Found 3 dead branch(es) eligible for deletion:
  - feature/closed-no-merge [closed, PR #103]
  - feature/normal-merge [merged, PR #101]
  - feature/squash-merge [merged, PR #102]

? Delete branch 'feature/closed-no-merge' (closed, PR #103)? (y/N)
? Delete branch 'feature/normal-merge' (merged, PR #101)? (y/N)
? Delete branch 'feature/squash-merge' (merged, PR #102)? (y/N)
? Ready to delete 3 branch(es). Proceed? (y/N)

Clean Summary:
  ✓ Deleted branch: feature/closed-no-merge
  ✓ Deleted branch: feature/normal-merge
  ✓ Deleted branch: feature/squash-merge

Successfully deleted 3 branch(es).
```

Options:
- `-y, --yes`: Skip individual per-branch confirmation prompts and proceed directly to the final summary confirmation.

---

## Safety Guarantees

- **Mandatory Confirmation**: `clean` **never** deletes any branch without human confirmation. The `--yes` flag only skips per-branch prompts; it never skips the final summary confirmation.
- **Protected Branches**:
  - **Default Branch**: The repository's default branch (`main` or `master`) is **never touched**, even if reported merged.
  - **Current Branch**: The branch you currently have checked out is **never touched**.
- **Unpushed Commits Guard**: Any branch containing unpushed local commits or modified locally since scan is automatically skipped and warned about.
- **Ambiguity Protection**: Ambiguous PR matches or API check failures are marked `needs-review` with specific reasons and are never offered for deletion.

---

## Releasing a New Version

*(For maintainers only)*

1. Run: `npm version patch` (or `minor` / `major` for bigger changes). This bumps the version in `package.json`, commits it, and creates a correctly-placed git tag automatically — no manual editing of `package.json` needed.
2. Run: `git push --follow-tags` (pushes both the commit and the new tag together).
3. Confirm the new version is visible on the main branch on GitHub before continuing.
4. Go to the Actions tab, select "Publish to npm," and click "Run workflow."
5. Do not run `npm publish` locally. The workflow publishes via npm trusted publishing (OIDC) — no token, no login, no browser prompt needed. Running a manual publish at the same time can cause the workflow to fail with a "cannot publish over previous version" error if it loses the race.

---

## License

[MIT](LICENSE)
