# marineambroselli.com

Page statique (HTML + CSS) servie par nginx sur le VPS depuis `/var/www/marineambroselli.com`, plus une petite API Node pour la prise de rendez-vous (remplace cal.com). À chaque push sur `main`, `.github/workflows/deploy.yml` se connecte en SSH, fait un `git reset --hard origin/main`, installe les dépendances de `server/` et relance l'API avec pm2.

- `index.html`, `style.css`, `assets/` : la page d'accueil
- `rdv/` : pages de réservation (`/rdv/`) et de gestion d'un rdv (`/rdv/gerer.html?id=…&t=…`), HTML/JS vanilla sans build
- `server/` : API Express + SQLite (`/api/…`)

## Prise de rendez-vous

Parcours copié de cal.com/marine.ambroselli : choix du type (consultation 90 min ou rdv 30 min), du jour, de l'heure, puis nom / email / téléphone / formule / motif. À la réservation :

1. le rdv est enregistré en base (SQLite, `~/marineambroselli-rdv/data/rdv.sqlite`), avec un verrou contre les doubles réservations ;
2. il est ajouté à l'agenda de Marine (`CALENDAR_PROVIDER`) ; ses créneaux déjà occupés dans cet agenda ne sont pas proposés ;
3. un mail part (Tipimail) à la personne et à Marine, avec le lien visio, un lien pour modifier/annuler et un `.ics` (invitation) en pièce jointe.

Chacun a son propre lien de gestion (jeton différent pour Marine et pour la personne). Déplacer ou annuler met à jour l'agenda et renvoie un mail aux deux (avec un `.ics` de mise à jour ou d'annulation).

Les types de rdv, horaires d'ouverture, préavis minimum (2 h) et horizon (60 jours) sont dans `server/src/config.js` (surchargeables par variables d'environnement).

### Agenda de Marine

- `google` : Google Agenda via OAuth. Crée l'événement avec un lien **Google Meet** (comme cal.com). Obtenir le refresh token une fois avec `npm run google-auth` (instructions dans `server/scripts/google-auth.js`).
- `caldav` : Calendrier Apple / iCloud (ou tout serveur CalDAV). Identifiant Apple + **mot de passe pour app** (appleid.apple.com → Connexion et sécurité → Mots de passe pour app). Le lien visio vient alors de `VIDEO_URL_TEMPLATE` (Jitsi par défaut).
- `none` : rien n'est synchronisé, Marine reçoit le `.ics` dans son mail.

### Mise en place sur le serveur (une fois)

```sh
mkdir -p ~/marineambroselli-rdv
cp /var/www/marineambroselli.com/server/.env.example ~/marineambroselli-rdv/.env   # puis remplir les clés
cd /var/www/marineambroselli.com/server
npm ci --omit=dev
pm2 start ecosystem.config.cjs && pm2 save
```

Node ≥ 20 et pm2 doivent être installés. Ajouter dans le `server {}` nginx de marineambroselli.com :

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3210;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
# Le repo est servi tel quel : ne pas exposer le code serveur ni .git
location ~ ^/(server|\.git|\.github)(/|$) { return 404; }
```

Les secrets et la base sont dans `~/marineambroselli-rdv/` de l'utilisateur `deployer` (`RDV_HOME` pour changer), hors du dossier servi par nginx et hors git. Penser à sauvegarder `~/marineambroselli-rdv/data/rdv.sqlite`.

### En local

```sh
cd server && npm install
SERVE_STATIC=1 MAIL_DUMP_DIR=/tmp/mails npm run dev   # http://127.0.0.1:3210/rdv/
npm test
```

Sans clés Tipimail, les mails ne partent pas ; avec `MAIL_DUMP_DIR` ils sont écrits sur le disque (HTML + .ics).

## À compléter

Chercher les `[...]` dans `index.html` : lien de l'appli Niki Coach, LinkedIn, et deux phrases dans « À propos ».
