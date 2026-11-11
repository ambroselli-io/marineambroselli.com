// Liste d'attente de l'appli Niki Coach (page /niki/ du site).
import { db } from './db.js';
import { config } from './config.js';
import { sendMail } from './mail.js';
import { pushToHost } from './push.js';
import { layout } from './emails.js';

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
    sendToHost(email, count).catch((e) => console.error('[niki] mail Marine', e.message)),
    pushToHost({
      title: 'Niki Coach : nouvelle inscription',
      body: `${email} veut être prévenue du lancement (${count} inscrite${count > 1 ? 's' : ''}).`,
      url: `${config.siteUrl}/niki/`,
    }),
  ]);
  return { ok: true, already: false };
}

const h = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Mail à Marine : « Répondre » écrit directement à la personne inscrite.
function sendToHost(email, count) {
  const when = new Date().toLocaleString('fr-FR', { timeZone: config.host.timeZone, dateStyle: 'long', timeStyle: 'short' });
  const total = `${count} inscrite${count > 1 ? 's' : ''} au total`;
  const html = layout(
    'Nouvelle inscription Niki Coach',
    `<p style="font-size:15px;line-height:1.6;margin:0 0 8px"><b style="color:#2f2a24">${h(email)}</b> veut être prévenue du lancement.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#6b6257">Le ${h(when)} (heure de Grèce) · ${total}</p>
<p style="font-size:14px;line-height:1.6;margin:0">Pour lui écrire, réponds simplement à ce mail.</p>`
  );
  const text = [`Nouvelle inscription Niki Coach : ${email}`, `Le ${when} (heure de Grèce) · ${total}`, '', 'Pour lui écrire, réponds simplement à ce mail.'].join('\n');
  return sendMail({
    to: { email: config.host.email, name: config.host.name },
    replyTo: { email },
    subject: `Niki Coach : nouvelle inscription de ${email}`,
    html,
    text,
    tags: ['niki-waitlist'],
  });
}

function sendConfirmation(email) {
  const html = layout(
    'Merci, tu es sur la liste !',
    `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Bonjour,</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Merci pour ton inscription ! Tu fais partie des premières à attendre <b style="color:#2f2a24">Niki Coach</b>, l'appli pour accompagner ton SMOP (ex-SOPK) au naturel.</p>
<p style="font-size:15px;line-height:1.6;margin:0">Je t'écris dès que l'appli est disponible. D'ici là, n'hésite pas à répondre à ce mail si tu as une question.</p>`,
    { photo: true }
  );
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
