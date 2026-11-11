// Envoi via l'API HTTP Tipimail : https://docs.tipimail.com/fr/integrate/api/messages
import { config } from './config.js';

export async function sendMail({ to, replyTo, subject, html, text, attachments = [], tags = ['rdv'] }) {
  const { apiUser, apiKey, from, fromName } = config.mail;
  if (!apiUser || !apiKey) {
    console.warn(`[mail] TIPIMAIL_API_USER/KEY absents, mail non envoyé à ${to.email} : ${subject}`);
    if (process.env.MAIL_DUMP_DIR) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(process.env.MAIL_DUMP_DIR, { recursive: true });
      const base = `${process.env.MAIL_DUMP_DIR}/${Date.now()}-${to.email}`;
      writeFileSync(`${base}.html`, html);
      for (const a of attachments) writeFileSync(`${base}-${a.filename}`, a.content);
    }
    return { skipped: true };
  }
  const res = await fetch('https://api.tipimail.com/v1/messages/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tipimail-ApiUser': apiUser,
      'X-Tipimail-ApiKey': apiKey,
    },
    body: JSON.stringify({
      apiKey,
      to: [{ address: to.email, personalName: to.name }],
      msg: {
        from: { address: from, personalName: fromName },
        ...(replyTo && { replyTo: { address: replyTo.email, personalName: replyTo.name } }),
        subject,
        html,
        text,
        attachments: attachments.map((a) => ({
          // La doc Tipimail mentionne « type » et « contentType » : on envoie les deux.
          contentType: a.contentType,
          type: a.contentType,
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64'),
        })),
      },
      headers: {
        'X-TM-TAGS': tags,
        // Pas de suivi : les liens « modifier/annuler » contiennent un jeton privé et ne doivent pas
        // être réécrits vers le domaine de tracking (lien.marineambroselli.com, sans certificat HTTPS).
        'X-TM-TRACKING': { html: { open: 0, click: 0 }, text: { click: 0 } },
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Tipimail ${res.status}: ${body}`);
  return { ok: true };
}
