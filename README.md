# marineambroselli.com

Page statique (HTML + CSS), servie par nginx sur le VPS depuis `/var/www/marineambroselli.com`. À chaque push sur `main`, `.github/workflows/deploy.yml` se connecte en SSH et fait un `git reset --hard origin/main` sur le serveur.

- `index.html` : contenu de la page
- `style.css` : styles
- `assets/` : images (photo de profil, etc.)

## À compléter

Chercher les `[...]` dans `index.html` : lien de l'appli Niki Coach, lien de prise de RDV, LinkedIn, et deux phrases dans « À propos ».
