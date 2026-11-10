// À lancer une seule fois, en local, pour obtenir le GOOGLE_REFRESH_TOKEN de Marine.
//   1. Google Cloud Console : créer un projet, activer « Google Calendar API »,
//      écran de consentement (type Externe, ajouter Marine en utilisateur test, puis « Publier »
//      pour que le jeton n'expire pas au bout de 7 jours), puis un identifiant OAuth
//      de type « Application de bureau ».
//   2. GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-auth
//   3. Ouvrir le lien affiché, se connecter avec le compte Google de Marine, accepter.
//   4. Copier la ligne GOOGLE_REFRESH_TOKEN=... dans server/.env sur le serveur.
import http from 'node:http';
import '../src/env.js';

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont requis.');
  process.exit(1);
}
const port = 53682;
const redirectUri = `http://127.0.0.1:${port}`;
const url =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
  });

http
  .createServer(async (req, res) => {
    const code = new URL(req.url, redirectUri).searchParams.get('code');
    if (!code) return res.end('Pas de code.');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const json = await r.json();
    res.end(json.refresh_token ? 'C’est bon, vous pouvez fermer cet onglet.' : 'Erreur, voir le terminal.');
    if (json.refresh_token) console.log(`\nGOOGLE_REFRESH_TOKEN=${json.refresh_token}\n`);
    else console.error(json);
    process.exit(json.refresh_token ? 0 : 1);
  })
  .listen(port, () => console.log(`Ouvrir ce lien et se connecter avec le compte Google de Marine :\n\n${url}\n`));
