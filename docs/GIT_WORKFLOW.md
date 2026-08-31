# Git workflow — GeoGovGadget

`main` is the protected, always-demoable branch. **Nobody but Swarnendu pushes to `main`
directly.** Everyone else works on their own branch and opens a PR.

Branch naming: `<yourname>-<what>`, e.g. `pranjal-ml`, `aditi-frontend`, `sheshadri-data`.

## One-time setup (each teammate, after accepting the collaborator invite)

```bash
git clone https://github.com/Swarnendu-Bhattacharjee/GeoGovGadget.git
cd GeoGovGadget
git config user.name "Your Name"
git config user.email "your@email.com"
```

## Daily loop (repeat this all day)

1. **Start of a work session — get latest `main` and branch off it:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b pranjal-ml        # only if you don't already have your branch
   # if you already have it:
   # git checkout pranjal-ml
   # git merge main                  # pull in anyone else's merged work
   ```

2. **Work, then commit often (small commits, not one giant one at the end):**
   ```bash
   git add -A
   git commit -m "short description of what changed"
   ```

3. **Push your branch:**
   ```bash
   git push -u origin pranjal-ml     # first push
   git push                          # subsequent pushes
   ```

4. **Open a PR into `main`:**
   ```bash
   gh pr create --base main --head pranjal-ml --title "ML: pretrained Mask R-CNN inference" --fill
   ```
   Or via the browser — GitHub shows a "Compare & pull request" button after you push.

5. **Swarnendu reviews and merges** (fast — today isn't a day for nitpicking, just check
   it doesn't break `/health` and `/segment`):
   ```bash
   gh pr list
   gh pr merge <number> --squash --delete-branch
   ```
   Merging auto-deletes the branch on GitHub (already configured). Locally:
   ```bash
   git checkout main
   git pull origin main
   git branch -d pranjal-ml          # clean up local branch after merge
   ```

## Given today's time pressure

- **Merge early, merge often** — don't sit on a branch for 4 hours. Open a PR the moment
  something runs, even if incomplete; Swarnendu merges in small increments so nobody's
  branch drifts far from `main` and conflicts stay small.
- **If you hit a merge conflict:** don't fight it alone past a couple minutes — ping
  Swarnendu, screen-share, resolve it live. Losing 20 minutes to a conflict nobody
  understands is the #1 way a hackathon day goes sideways.
- **Respect the API contract** (`docs/API_CONTRACT.md`). If you need to change the
  `/segment` response shape, say so in the team chat before pushing — everyone else's
  code depends on it staying stable.
- **Commit before you leave your desk.** An uncommitted afternoon of work that isn't
  pushed doesn't exist for the rest of the team.

## Quick reference

| Action | Command |
|---|---|
| New branch off latest main | `git checkout main && git pull && git checkout -b yourname-thing` |
| Save + push work | `git add -A && git commit -m "..." && git push` |
| Open PR | `gh pr create --base main --fill` |
| See open PRs | `gh pr list` |
| Merge a PR (Swarnendu only) | `gh pr merge <number> --squash --delete-branch` |
| Sync your branch with main mid-work | `git checkout main && git pull && git checkout yourname-thing && git merge main` |
