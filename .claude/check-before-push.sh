#!/usr/bin/env bash
# Hook PreToolUse de Claude Code : avant tout `git push`, lance scripts/check-secrets.sh. Exit 2 = commande bloquée.
input=$(cat)
printf '%s' "$input" | grep -qE 'git[^"]*[[:space:]]push' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if ! out=$(scripts/check-secrets.sh 2>&1 && scripts/check-secrets.sh HEAD --not --remotes 2>&1); then
  echo "$out" >&2
  exit 2
fi
exit 0
