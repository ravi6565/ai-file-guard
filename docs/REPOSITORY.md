# Repository administration

The repository is public. Branch rules control changes to `main`; they do not prevent reading, cloning or forking source. Keep credentials and machine-local policies out of Git.

## Main branch rules

The policy in [.github/rulesets/main.json](../.github/rulesets/main.json) requires:

- Every change to `main` arrives through a pull request.
- `CI gate`, from the GitHub Actions app, passes against the current base branch.
- Review conversations are resolved.
- Force pushes and deletion of `main` are blocked.
- No user, administrator or app has a bypass entry.

The approval quota is zero for a sole-maintainer repository. PRs and CI remain mandatory, including for the owner. Set one or more required approvals when another maintainer can review owner-authored PRs. `CODEOWNERS` requests maintainer review but is not a substitute for an enforced approval rule.

Committing a ruleset file does not activate protection. An owner/admin must apply it in GitHub.

## Activate

Sign in as `ravi6565` using `gh auth login --hostname github.com --git-protocol https --web`. Do not paste tokens into chat or commit them.

For the first activation, run from the repository root:

```sh
gh api --method POST repos/ravi6565/ai-file-guard/rulesets --input .github/rulesets/main.json
gh api --method PATCH repos/ravi6565/ai-file-guard -F delete_branch_on_merge=true
```

If a ruleset with this name already exists, update its numeric ID using `--method PUT` and the endpoint `repos/ravi6565/ai-file-guard/rulesets/RULESET_ID` rather than creating a duplicate.

Alternatively, open repository **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, select the JSON file and confirm **Active**, the `main` target and an empty bypass list. In **Settings → General → Pull Requests**, enable automatic deletion of head branches.

## Verify

```sh
gh api repos/ravi6565/ai-file-guard/rulesets
gh api repos/ravi6565/ai-file-guard/rules/branches/main
gh api repos/ravi6565/ai-file-guard --jq .delete_branch_on_merge
```

Confirm an active PR rule, required `CI gate` from app 15368, strict status-check policy, deletion/force-push rules and no bypass actors. A file in Git is only the desired policy; the API response is the live state.

## Branch cleanup

Merge release work with a merge commit, then verify that each obsolete branch tip is an ancestor of `origin/main`. Check open PRs before deletion. Keep any branch with unmerged work.

```sh
git fetch --prune origin
git merge-base --is-ancestor origin/BRANCH origin/main
git push origin --delete BRANCH
```

The ancestry check must succeed before deleting that branch. After switching the local checkout to `main`, remove local merged branches with `git branch -d BRANCH` and prune remote-tracking references. Archive older VSIX attempts under `artifacts/`; qualified release files and their checksum sidecars must remain available for device testing.
