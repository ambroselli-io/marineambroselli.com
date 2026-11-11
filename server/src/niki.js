// Liste d'attente de l'appli Niki Coach (page /niki/ du site).
import { db } from './db.js';
import { config } from './config.js';
import { sendMail } from './mail.js';
import { pushToHost } from './push.js';

db.exec(`
CREATE TABLE IF NOT EXISTS niki_waitlist (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

export function waitlistCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM niki_waitlist').get().n;
}

export async function joinWaitlist(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('Cette adresse email ne semble pas valide. Tu peux vérifier ?');

  const { changes } = db.prepare('INSERT OR IGNORE INTO niki_waitlist (email) VALUES (?)').run(email);
  if (!changes) return { ok: true, already: true };

  const count = waitlistCount();
  // Les envois ne doivent pas faire échouer l'inscription.
  await Promise.allSettled([
    sendConfirmation(email).catch((e) => console.error('[niki] mail', e.message)),
    pushToHost({
      title: 'Niki Coach : nouvelle inscription',
      body: `${email} veut être prévenue du lancement (${count} inscrite${count > 1 ? 's' : ''}).`,
      url: `${config.siteUrl}/niki/`,
    }),
  ]);
  return { ok: true, already: false };
}

function sendConfirmation(email) {
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#FFFDF8;font-family:Helvetica,Arial,sans-serif;color:#534b41">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="border:3px solid #fedf9e;background:#FFFDF8">
<div style="padding:28px 24px 0;text-align:center">
<img src="${config.siteUrl}/niki/soleil.png" alt="" width="96" height="95" style="display:inline-block">
<h1 style="margin:12px 0 0;font-family:Georgia,serif;font-weight:400;font-size:28px;color:#2f2a24">Niki Coach</h1>
</div>
<div style="padding:24px">
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Bonjour,</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Merci pour ton inscription ! Tu fais partie des premières à attendre Niki Coach, l'appli pour accompagner ton SMOP (ex-SOPK) au naturel.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Je t'écris dès que l'appli est disponible. D'ici là, n'hésite pas à répondre à ce mail si tu as une question.</p>
<p style="font-size:15px;line-height:1.6;margin:0">À très vite,<br>Marine</p>
</div>
</div>
<p style="text-align:center;font-size:12px;color:#6b6257;margin-top:16px">marineambroselli.com</p>
</div></body></html>`;
  const text = [
    'Bonjour,',
    '',
    "Merci pour ton inscription ! Tu fais partie des premières à attendre Niki Coach, l'appli pour accompagner ton SMOP (ex-SOPK) au naturel.",
    "Je t'écris dès que l'appli est disponible. D'ici là, n'hésite pas à répondre à ce mail si tu as une question.",
    '',
    'À très vite,',
    'Marine',
  ].join('\n');
  return sendMail({
    to: { email },
    replyTo: { email: config.host.email, name: config.host.name },
    subject: 'Tu seras prévenue du lancement de Niki Coach',
    html,
    text,
    tags: ['niki-waitlist'],
  });
}
