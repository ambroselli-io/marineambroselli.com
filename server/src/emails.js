import { DateTime } from 'luxon';
import { config } from './config.js';
import { buildIcs, googleCalendarLink } from './ics.js';
import { sendMail } from './mail.js';

const h = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const manageUrl = (b, role) =>
  `${config.siteUrl}/rdv/gerer.html?id=${b.id}&t=${role === 'host' ? b.host_token : b.attendee_token}`;

export function formatWhen(b, zone) {
  const s = DateTime.fromISO(b.start_utc, { zone }).setLocale('fr');
  const e = DateTime.fromISO(b.end_utc, { zone }).setLocale('fr');
  const label = zone === 'Europe/Paris' ? 'heure de Paris' : zone.replace(/_/g, ' ');
  return `${s.toFormat("cccc d LLLL yyyy 'de' HH'h'mm")} à ${e.toFormat("HH'h'mm")} (${label})`;
}

export function calendarDescription(b, type) {
  return [
    `${type.title} avec ${b.name}`,
    `Email : ${b.email}`,
    b.phone && `Téléphone : ${b.phone}`,
    b.option && `${type.options?.label || 'Option'} : ${b.option}`,
    b.notes && `Notes : ${b.notes}`,
    b.video_url && `Visio : ${b.video_url}`,
    `Modifier ou annuler : ${manageUrl(b, 'host')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#FFFDF8;font-family:Helvetica,Arial,sans-serif;color:#534b41">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="border:3px solid #fedf9e;padding:28px 24px;background:#FFFDF8">
<h1 style="margin:0 0 20px;font-family:Georgia,serif;font-weight:400;font-size:24px;color:#2f2a24">${h(title)}</h1>
${bodyHtml}
</div>
<p style="text-align:center;font-size:12px;color:#6b6257;margin-top:16px">marineambroselli.com</p>
</div></body></html>`;
}

const row = (label, value) =>
  value ? `<tr><td style="padding:6px 12px 6px 0;color:#6b6257;vertical-align:top;white-space:nowrap">${h(label)}</td><td style="padding:6px 0;color:#2f2a24">${value}</td></tr>` : '';
const button = (href, label, dark = false) =>
  `<a href="${h(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:12px 20px;text-decoration:none;font-size:15px;${
    dark ? 'background:#2f2a24;color:#FFFDF8' : 'background:#fedf9e;color:#3f3830'
  }">${h(label)}</a>`;

function details(b, type, zone, forHost) {
  return `<table style="border-collapse:collapse;font-size:15px;margin-bottom:20px">
${row('Quoi', h(type.title))}
${row('Quand', h(formatWhen(b, zone)))}
${row(forHost ? 'Avec' : 'Avec', h(forHost ? b.name : config.host.name))}
${forHost ? row('Email', `<a href="mailto:${h(b.email)}" style="color:#2f2a24">${h(b.email)}</a>`) : ''}
${forHost && b.phone ? row('Téléphone', h(b.phone)) : ''}
${b.option ? row(type.options?.label || 'Option', h(b.option)) : ''}
${b.notes ? row('Notes', h(b.notes).replace(/\n/g, '<br>')) : ''}
${b.video_url ? row('Visio', `<a href="${h(b.video_url)}" style="color:#2f2a24">${h(b.video_url)}</a>`) : ''}
</table>`;
}

function icsFor(b, type, cancelled) {
  return buildIcs({
    uid: `${b.id}@marineambroselli.com`,
    sequence: b.sequence + (cancelled ? 1 : 0),
    start: b.start_utc,
    end: b.end_utc,
    title: `${type.title} avec ${config.host.name}`,
    description: `Visio : ${b.video_url || ''}\nModifier ou annuler : ${manageUrl(b, 'attendee')}`,
    location: b.video_url,
    url: b.video_url,
    organizer: { name: config.host.name, email: config.host.email },
    attendee: { name: b.name, email: b.email },
    method: cancelled ? 'CANCEL' : 'REQUEST',
    cancelled,
  });
}

const textVersion = (lines) => lines.filter(Boolean).join('\n');

/** kind : 'created' | 'rescheduled' | 'cancelled' ; by : 'attendee' | 'host' */
export async function notify(kind, b, type, { by = 'attendee', previous = null, calendarError = null } = {}) {
  const host = config.host;
  const cancelled = kind === 'cancelled';
  const titles = {
    created: ['Votre rendez-vous est confirmé', `Nouveau rendez-vous : ${b.name}`],
    rescheduled: ['Votre rendez-vous a été déplacé', `Rendez-vous déplacé : ${b.name}`],
    cancelled: ['Votre rendez-vous est annulé', `Rendez-vous annulé : ${b.name}`],
  }[kind];
  const ics = icsFor(b, type, cancelled);
  const icsAttachment = { filename: cancelled ? 'annulation.ics' : 'rendez-vous.ics', contentType: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'REQUEST'}`, content: ics };

  // --- Personne qui réserve ---
  const az = b.time_zone;
  const gcal = googleCalendarLink({
    start: b.start_utc,
    end: b.end_utc,
    title: `${type.title} avec ${host.name}`,
    description: `Visio : ${b.video_url}\nModifier ou annuler : ${manageUrl(b, 'attendee')}`,
    location: b.video_url,
  });
  const whoCancelled = by === 'host' ? `${host.name} a annulé le rendez-vous.` : 'Vous avez annulé le rendez-vous.';
  const intro = {
    created: `Bonjour ${b.name},<br><br>Votre rendez-vous avec ${host.name} est bien réservé.`,
    rescheduled: `Bonjour ${b.name},<br><br>Votre rendez-vous a été déplacé${previous ? ` (il était prévu le ${h(formatWhen(previous, az))})` : ''}.`,
    cancelled: `Bonjour ${b.name},<br><br>${whoCancelled}${b.cancel_reason ? `<br>Motif : ${h(b.cancel_reason)}` : ''}`,
  }[kind];
  const attendeeHtml = layout(
    titles[0],
    `<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${intro}</p>
${details(b, type, az, false)}
${
  cancelled
    ? `<p>${button(`${config.siteUrl}/rdv/`, 'Reprendre un rendez-vous', true)}</p>`
    : `<p>${button(b.video_url, 'Rejoindre la visio', true)}${button(manageUrl(b, 'attendee'), 'Modifier ou annuler')}</p>
<p style="font-size:14px;line-height:1.6">Pour l'ajouter à votre agenda, ouvrez le fichier joint <b>rendez-vous.ics</b>, ou <a href="${h(gcal)}" style="color:#2f2a24">ajoutez-le à Google Agenda</a>.</p>`
}
<p style="font-size:14px;line-height:1.6;color:#6b6257">Une question ? Répondez simplement à ce mail, ou contactez-moi au ${h(host.phone)} (appel ou WhatsApp).</p>`
  );
  const attendeeText = textVersion([
    `Bonjour ${b.name},`,
    '',
    { created: `Votre rendez-vous avec ${host.name} est bien réservé.`, rescheduled: 'Votre rendez-vous a été déplacé.', cancelled: whoCancelled }[kind],
    '',
    `${type.title}`,
    formatWhen(b, az),
    !cancelled && `Visio : ${b.video_url}`,
    !cancelled && `Modifier ou annuler : ${manageUrl(b, 'attendee')}`,
    '',
    `Une question ? ${host.phone} (appel ou WhatsApp)`,
  ]);

  // --- Marine ---
  const hz = host.timeZone;
  const hostIntro = {
    created: `${h(b.name)} a réservé un rendez-vous.`,
    rescheduled: `${by === 'host' ? 'Tu as déplacé' : `${h(b.name)} a déplacé`} le rendez-vous${previous ? ` (il était prévu le ${h(formatWhen(previous, hz))})` : ''}.`,
    cancelled: `${by === 'host' ? 'Tu as annulé' : `${h(b.name)} a annulé`} le rendez-vous.${b.cancel_reason ? `<br>Motif : ${h(b.cancel_reason)}` : ''}`,
  }[kind];
  const calNote =
    calendarError
      ? `<p style="font-size:14px;color:#a33">⚠️ Le rendez-vous n'a pas pu être mis à jour automatiquement dans ton agenda (${h(calendarError)}). Ouvre le fichier joint pour l'ajouter à la main.</p>`
      : '';
  const hostHtml = layout(
    titles[1],
    `<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${hostIntro}</p>
${details(b, type, hz, true)}
${calNote}
${cancelled ? '' : `<p>${button(b.video_url, 'Rejoindre la visio', true)}${button(manageUrl(b, 'host'), 'Modifier ou annuler')}</p>`}`
  );
  const hostText = textVersion([
    titles[1],
    '',
    `${type.title} — ${formatWhen(b, hz)}`,
    `${b.name} <${b.email}>`,
    b.phone && `Tél : ${b.phone}`,
    b.option && `${type.options?.label} : ${b.option}`,
    b.notes && `Notes : ${b.notes}`,
    !cancelled && `Visio : ${b.video_url}`,
    !cancelled && `Modifier ou annuler : ${manageUrl(b, 'host')}`,
  ]);
  // Si l'agenda est synchronisé, pas besoin de .ics pour Marine (sinon doublon).
  const hostAttachments = config.calendarProvider === 'none' || calendarError ? [icsAttachment] : [];

  const results = await Promise.allSettled([
    sendMail({ to: { email: b.email, name: b.name }, replyTo: { email: host.email, name: host.name }, subject: `${titles[0]} : ${type.title}`, html: attendeeHtml, text: attendeeText, attachments: [icsAttachment] }),
    sendMail({ to: { email: host.email, name: host.name }, replyTo: { email: b.email, name: b.name }, subject: titles[1], html: hostHtml, text: hostText, attachments: hostAttachments }),
  ]);
  for (const r of results) if (r.status === 'rejected') console.error('[mail]', r.reason.message);
}
