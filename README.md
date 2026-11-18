# marineambroselli.com

Site de Marine Ambroselli (naturopathe) et son API de prise de rendez-vous. À chaque push sur `main`, `.github/workflows/deploy.yml` lance les tests puis déploie sur le serveur.

- `site/` : le site statique, seul dossier servi publiquement
  - `index.html`, `style.css`, `assets/` : la page d'accueil
  - `rdv/` : pages de réservation (`/rdv/`) et de gestion d'un rdv (`/rdv/gerer.html?id=…&t=…`), HTML/JS vanilla sans build
- `server/` : API Express + SQLite (`/api/…`). Sa configuration (`server/.env`, voir `server/.env.example`) et sa base `data/` restent sur le serveur, ignorées par git.

## Prise de rendez-vous

Choix du type (consultation 90 min ou rdv 30 min), du jour, de l'heure, puis nom / email / téléphone / formule / motif. À la réservation :

1. le rdv est enregistré en base (SQLite, `server/data/rdv.sqlite`), avec un verrou contre les doubles réservations ;
2. il est ajouté à l'agenda de Marine (`CALENDAR_PROVIDER`) ; ses créneaux déjà occupés dans cet agenda ne sont pas proposés ;
3. un mail part (Tipimail) à la personne et à Marine, avec le lien visio, un lien pour modifier/annuler et un `.ics` (invitation) en pièce jointe.

Marine reçoit aussi une notification push (création, déplacement, annulation) sur l'appli Niki via l'API Expo si `EXPO_PUSH_TOKENS` est renseigné dans `server/.env`.

Chacun a son propre lien de gestion (jeton différent pour Marine et pour la personne). Déplacer ou annuler met à jour l'agenda et renvoie un mail aux deux (avec un `.ics` de mise à jour ou d'annulation).

Visio : lien défini par `VIDEO_URL_TEMPLATE`. Fuseaux : les horaires de Marine sont en heure de Grèce (`HOST_TIMEZONE=Europe/Athens`, lun–ven 9h–17h), les clientes voient l'heure de Paris par défaut (modifiable sur la page), Marine reçoit ses mails en heure de Grèce.

Les types de rdv, horaires d'ouverture, préavis minimum (2 h) et horizon (60 jours) sont dans `server/src/config.js` (surchargeables par variables d'environnement).

### Agenda de Marine

- `google` : Google Agenda via OAuth (`GOOGLE_MEET=1` pour un lien Google Meet par rdv au lieu de la salle Jitsi). Obtenir le refresh token une fois avec `npm run google-auth` (instructions dans `server/scripts/google-auth.js`).
- `caldav` : Calendrier Apple / iCloud (ou tout serveur CalDAV). Identifiant Apple + **mot de passe pour app** (appleid.apple.com → Connexion et sécurité → Mots de passe pour app). 
- `none` : rien n'est synchronisé, Marine reçoit le `.ics` dans son mail.

### Mise en place sur le serveur

Copier `server/.env.example` en `server/.env` (droits 600) et le remplir, puis lancer `server/` avec pm2 (`ecosystem.config.cjs`). Seul `site/` doit être servi par le serveur web, l'API est derrière un reverse proxy sur `/api/`. Penser à sauvegarder la base SQLite.

### En local

```sh
cd server && npm install
SERVE_STATIC=1 MAIL_DUMP_DIR=/tmp/mails npm run dev   # http://127.0.0.1:3210/rdv/
```

Sans clés Tipimail, les mails ne partent pas ; avec `MAIL_DUMP_DIR` ils sont écrits sur le disque (HTML + .ics).

### Tests

```sh
cd server
npm test           # API : réserver, déplacer, annuler, mails, notifs, synchro avec l'agenda de Marine (~1 s)
npx playwright install chromium   # une fois
npm run test:e2e   # vrai navigateur : réservation puis déplacement et annulation depuis le site
```

Rien ne part sur le réseau : Tipimail, Expo et l'agenda sont simulés (`server/test/helpers.js`). Sur GitHub, les deux suites tournent à chaque push sur `main` ; si l'une casse, le déploiement n'a pas lieu et le site en ligne reste sur la version précédente.

## Niki Coach (page de teasing)

`site/niki/` : page de présentation de l'appli (bouton « Télécharger l'appli » de l'accueil), en attendant sa sortie. Le formulaire « Je veux être notifié(e) du lancement » appelle `POST /api/niki/inscription` : l'email est enregistré dans la table `niki_waitlist` (même base SQLite), la personne reçoit un mail de confirmation (Tipimail), et Marine reçoit un mail (« Répondre » écrit à la personne) et une notification push. Pour récupérer la liste : `cd server && npm run niki-export > inscrites.csv`.

## À compléter

Chercher les `[...]` dans `site/index.html` : LinkedIn, et deux phrases dans « À propos ».

## Avant de pousser : pas de secret ni de donnée perso

Le dépôt est public. Rien de secret ou de personnel ne doit être commité : tokens (Expo, API, OAuth), clés SSH, webhooks, mots de passe, adresses email ou numéros personnels, IP du serveur, `.env`, base SQLite. Tout ça va dans `server/.env` sur le serveur ou dans les secrets GitHub.

`scripts/check-secrets.sh` le vérifie :

- automatiquement avant chaque `git push` (hook `.githooks/pre-push`, activé par `npm install` dans `server/`, ou à la main : `git config core.hooksPath .githooks`) ;
- automatiquement avant chaque `git push` lancé par Claude Code (`.claude/settings.json`) ;
- sur GitHub, avant chaque déploiement (job `secrets` du workflow).

Les coordonnées publiques de Marine affichées sur le site sont autorisées dans `scripts/secrets-allowlist.txt`. Faux positif : l'ajouter dans ce fichier.
