# Règles du dépôt

Ce dépôt est **public**. Avant tout commit ou push :

- Ne jamais écrire en dur un secret ou une donnée perso : token (Expo push, API, OAuth), clé, mot de passe, webhook, email ou téléphone perso, IP du serveur, chemin ou utilisateur de déploiement. Ça va dans `server/.env` (documenté sans valeur dans `server/.env.example`) ou dans les secrets GitHub du workflow.
- Lancer `scripts/check-secrets.sh` (fichiers actuels) et `scripts/check-secrets.sh HEAD --not --remotes` (commits pas encore poussés) avant chaque `git push`. S'il signale quelque chose, ne pas pousser : retirer la valeur, et si elle est déjà dans un commit, réécrire ce commit avant de pousser. Un hook Claude Code (`.claude/settings.json`) et le hook git `.githooks/pre-push` le font aussi automatiquement, mais ne pas compter uniquement dessus.
- Ne jamais contourner la vérification (`--no-verify`, modification de l'allowlist pour un vrai secret). `scripts/secrets-allowlist.txt` n'accueille que des valeurs déjà publiques (coordonnées affichées sur le site) ou fictives (tests).
- Ne jamais commiter `server/.env`, `server/data/` ni une base SQLite.
