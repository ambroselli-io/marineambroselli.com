#!/usr/bin/env bash
# Vérifie qu'aucun secret ni donnée perso n'est commité (dépôt public).
#
#   scripts/check-secrets.sh                 # fichiers suivis par git (état actuel)
#   scripts/check-secrets.sh <revisions...>  # lignes ajoutées par ces commits, ex. origin/main..HEAD
#
# Faux positif : ajouter une regex (ERE, testée sur « chemin:ligne ») dans scripts/secrets-allowlist.txt.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ALLOW=scripts/secrets-allowlist.txt
SELF='^(scripts/check-secrets\.sh|scripts/secrets-allowlist\.txt):'

# Secrets : tokens, clés, webhooks
SECRET='ExponentPushToken\[[A-Za-z0-9_-]{12,}\]|ExpoPushToken\[[A-Za-z0-9_-]{12,}\]|-----BEGIN [A-Z ]*PRIVATE KEY|hooks\.slack\.com/services/|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|GOCSPX-|sk-[A-Za-z0-9_-]{20,}|tskey-|[Aa][Pp][Ii]_?[Kk][Ee][Yy][A-Za-z_]*[\"'"'"']?[[:space:]]*[:=][[:space:]]*[\"'"'"'][A-Za-z0-9_/+=-]{16,}|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][A-Za-z_]*[\"'"'"']?[[:space:]]*[:=][[:space:]]*[\"'"'"'][^\"'"'"' ]{8,}'
# Données perso : emails de messageries perso, numéros de téléphone FR/GR
PERSO='[A-Za-z0-9._%+-]+@(icloud|me|mac|gmail|googlemail|hotmail|outlook|live|yahoo|protonmail|proton|orange|free|wanadoo|sfr|laposte|gmx)\.[a-z]{2,}|(\+|00)(33|30)[ .]?[1-9]([ .-]?[0-9]{2}){4}|(^|[^0-9A-Za-z])0[1-9]([ .-][0-9]{2}){4}([^0-9]|$)|(^|[^0-9A-Za-z/])0[67][0-9]{8}([^0-9]|$)'
# IPv4 publiques ou du réseau Tailscale (100.64.0.0/10)
IP='(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)'
IP_OK='(^|[^0-9.])(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.255\.)'
# Fichiers qui n'ont rien à faire dans git
BADFILE='(^|/)\.env$|(^|/)\.env\.(local|prod|production|dev)$|\.sqlite3?$|\.db$|\.pem$|\.key$|\.p12$|(^|/)id_(rsa|ed25519|ecdsa)|^server/data/'

allow() {
  local pats; pats=$(grep -vE '^[[:space:]]*(#|$)' "$ALLOW" 2>/dev/null || true)
  if [ -n "$pats" ]; then grep -vE -e "$pats" || true; else cat; fi
}

# Produit des lignes « chemin:contenu »
lines() {
  if [ $# -eq 0 ]; then
    git grep -I --full-name -e '' -- . ':!*package-lock.json' || true
  else
    git log -p -U0 --no-color --format= "$@" -- . ':!*package-lock.json' | awk '
      /^\+\+\+ / { p = substr($0, 5); sub(/^b\//, "", p); next }
      /^\+/      { print p ":" substr($0, 2) }'
  fi
}
files() {
  if [ $# -eq 0 ]; then git ls-files; else git log --format= --name-only --diff-filter=AR "$@" | sort -u; fi
}

found=$(
  {
    lines "$@" | grep -vE "$SELF" | grep -E "$SECRET|$PERSO" || true
    lines "$@" | grep -vE "$SELF" | grep -E "$IP" | grep -vE "$IP_OK" || true
    files "$@" | grep -E "$BADFILE" | sed 's/$/: fichier interdit/' || true
  } | allow | cut -c1-200 | sort -u
)

if [ -n "$found" ]; then
  echo "✋ Secret ou donnée perso détecté, push bloqué :" >&2
  echo "$found" | sed 's/^/   /' >&2
  echo "→ Mettre la valeur dans server/.env ou dans les secrets GitHub, et ne pas la commiter." >&2
  echo "→ Faux positif : ajouter une regex dans $ALLOW." >&2
  exit 1
fi
echo "check-secrets : rien de suspect${1:+ dans $*}."
