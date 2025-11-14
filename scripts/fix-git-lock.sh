#!/bin/bash

# Git Lock File Cleanup Script
# This script safely removes stale git lock files that prevent git operations

set -e

echo "🔍 Checking for git lock files..."

# Find all .lock files in the .git directory
LOCK_FILES=$(find .git -name "*.lock" -type f 2>/dev/null || true)

if [ -z "$LOCK_FILES" ]; then
    echo "✅ No lock files found. Your repository is clean!"
    exit 0
fi

echo "Found the following lock files:"
echo "$LOCK_FILES"
echo ""

# Check if any git processes are running
GIT_PROCESSES=$(ps aux | grep -E '[g]it' || true)

if [ -n "$GIT_PROCESSES" ]; then
    echo "⚠️  Warning: Git processes are currently running:"
    echo "$GIT_PROCESSES"
    echo ""
    read -p "Do you want to continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted. Please stop running git processes first."
        exit 1
    fi
fi

# Remove lock files
echo "🧹 Removing lock files..."
echo "$LOCK_FILES" | while read -r lockfile; do
    if [ -f "$lockfile" ]; then
        echo "  Removing: $lockfile"
        rm -f "$lockfile"
    fi
done

echo ""
echo "✅ Lock files removed successfully!"
echo "You can now retry your git operation."
