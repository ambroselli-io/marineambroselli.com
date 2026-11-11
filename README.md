# marineambroselli.com

Monorepo cloné dans `/var/www/marineambroselli.com` sur le VPS. À chaque push sur `main`, `.github/workflows/deploy.yml` se connecte en SSH, fait un `git reset --hard origin/main`, installe les dépendances de `server/` et relance l'API avec pm2.

- `site/` : le site statique, **seul dossier servi par nginx** (`root /var/www/marineambroselli.com/site`)
  - `index.html`, `style.css`, `assets/` : la page d'accueil
  - `rdv/` : pages de réservation (`/rdv/`) et de gestion d'un rdv (`/rdv/gerer.html?id=…&t=…`), HTML/JS vanilla sans build
- `server/` : API Express + SQLite (`/api/…`, proxifiée par nginx vers pm2). Son `.env` et sa base `data/` restent sur le serveur, ignorés par git.

## Prise de rendez-vous

Parcours copié de cal.com/marine.ambroselli : choix du type (consultation 90 min ou rdv 30 min), du jour, de l'heure, puis nom / email / téléphone / formule / motif. À la réservation :

1. le rdv est enregistré en base (SQLite, `server/data/rdv.sqlite`), avec un verrou contre les doubles réservations ;
2. il est ajouté à l'agenda de Marine (`CALENDAR_PROVIDER`) ; ses créneaux déjà occupés dans cet agenda ne sont pas proposés ;
3. un mail part (Tipimail) à la personne et à Marine, avec le lien visio, un lien pour modifier/annuler et un `.ics` (invitation) en pièce jointe.

Marine reçoit aussi une notification push (création, déplacement, annulation) sur l'appli Niki via l'API Expo si `EXPO_PUSH_TOKENS` est renseigné.

Chacun a son propre lien de gestion (jeton différent pour Marine et pour la personne). Déplacer ou annuler met à jour l'agenda et renvoie un mail aux deux (avec un `.ics` de mise à jour ou d'annulation).

Visio : salle Jitsi fixe `https://meet.jit.si/marineambroselli` (`VIDEO_URL_TEMPLATE`). Fuseaux : les horaires de Marine sont en heure de Grèce (`HOST_TIMEZONE=Europe/Athens`, lun–ven 9h–17h), les clientes voient l'heure de Paris par défaut (modifiable sur la page), Marine reçoit ses mails en heure de Grèce.

Les types de rdv, horaires d'ouverture, préavis minimum (2 h) et horizon (60 jours) sont dans `server/src/config.js` (surchargeables par variables d'environnement).

### Agenda de Marine

- `google` : Google Agenda via OAuth (`GOOGLE_MEET=1` pour un lien Google Meet par rdv au lieu de la salle Jitsi). Obtenir le refresh token une fois avec `npm run google-auth` (instructions dans `server/scripts/google-auth.js`).
- `caldav` : Calendrier Apple / iCloud (ou tout serveur CalDAV). Identifiant Apple + **mot de passe pour app** (appleid.apple.com → Connexion et sécurité → Mots de passe pour app). 
- `none` : rien n'est synchronisé, Marine reçoit le `.ics` dans son mail.

### Mise en place sur le serveur (une fois)

```sh
cd /var/www/marineambroselli.com/server
cp .env.example .env && chmod 600 .env   # puis remplir les clés
npm ci --omit=dev
pm2 start ecosystem.config.cjs && pm2 save
```

Node ≥ 20 et pm2 doivent être installés. Dans le `server {}` nginx de marineambroselli.com, **en même temps que le merge** (le site a déménagé dans `site/`) :

```nginx
root /var/www/marineambroselli.com/site;

location /api/ {
    proxy_pass http://127.0.0.1:3210;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Comme nginx ne sert que `site/`, ni `server/.env`, ni `server/data/`, ni `.git` ne sont accessibles. Le `git reset --hard` du déploiement ne touche pas aux fichiers ignorés. Penser à sauvegarder `server/data/rdv.sqlite`.

### En local

```sh
cd server && npm install
SERVE_STATIC=1 MAIL_DUMP_DIR=/tmp/mails npm run dev   # http://127.0.0.1:3210/rdv/
npm test
```

Sans clés Tipimail, les mails ne partent pas ; avec `MAIL_DUMP_DIR` ils sont écrits sur le disque (HTML + .ics).

## Niki Coach (page de teasing)

`site/niki/` : page de présentation de l'appli (bouton « Télécharger l'appli » de l'accueil), en attendant sa sortie. Le formulaire « Je veux être notifié(e) du lancement » appelle `POST /api/niki/inscription` : l'email est enregistré dans la table `niki_waitlist` (même base SQLite), la personne reçoit un mail de confirmation (Tipimail) et Marine une notification push. Pour récupérer la liste : `cd server && npm run niki-export > inscrites.csv`.

## À compléter

Chercher les `[...]` dans `site/index.html` : LinkedIn, et deux phrases dans « À propos ».
