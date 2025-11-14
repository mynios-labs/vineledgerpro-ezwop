# Utility Scripts

This directory contains helpful utility scripts for managing the VineLedgerPro project.

## fix-git-lock.sh

**Purpose**: Safely removes stale git lock files that prevent git operations from completing.

### When to use this script

You may encounter errors like:
```
error: cannot lock ref 'refs/remotes/origin/branch-name': Unable to create '.git/refs/remotes/origin/branch-name.lock': File exists.
```

This happens when:
- A git process was interrupted or crashed
- Multiple git processes tried to run simultaneously
- A lock file wasn't properly cleaned up

### Usage

**In Replit or any environment:**

```bash
cd ~/workspace  # or your repository root
bash scripts/fix-git-lock.sh
```

Or make it executable and run directly:
```bash
chmod +x scripts/fix-git-lock.sh
./scripts/fix-git-lock.sh
```

### Manual fix (alternative)

If you prefer to fix it manually:

1. Find the lock file mentioned in the error message
2. Remove it: `rm .git/path/to/file.lock`
3. Retry your git operation

**Example for the specific error from Replit:**
```bash
rm /home/runner/workspace/.git/refs/remotes/origin/claude/resolve-replit-issues-01YVqVHhEjUAnw7JKYDkcHh5.lock
git pull
```

### Safety

The script will:
- ✅ List all lock files found before removing them
- ✅ Warn you if git processes are currently running
- ✅ Ask for confirmation before proceeding if git is running
- ✅ Only remove `.lock` files in the `.git` directory

It's safe to run this script - it only removes lock files, which are temporary files that should not persist between git operations.
