// Génération de fichiers iCalendar (RFC 5545).
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Plie les lignes à 75 octets comme demandé par la RFC.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/**
 * method : 'REQUEST' (invitation), 'CANCEL' (annulation) ou null (objet brut pour CalDAV)
 */
export function buildIcs({ uid, sequence = 0, start, end, title, description, location, url, organizer, attendee, method = 'REQUEST', cancelled = false }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//marineambroselli.com//RDV//FR',
    'CALSCALE:GREGORIAN',
    method && `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(title)}`,
    description && `DESCRIPTION:${esc(description)}`,
    location && `LOCATION:${esc(location)}`,
    url && `URL:${esc(url)}`,
    organizer && `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}`,
    attendee &&
      `ATTENDEE;CN=${esc(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${cancelled ? 'DECLINED' : 'ACCEPTED'}:mailto:${attendee.email}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    !cancelled && 'BEGIN:VALARM',
    !cancelled && 'TRIGGER:-PT15M',
    !cancelled && 'ACTION:DISPLAY',
    !cancelled && `DESCRIPTION:${esc(title)}`,
    !cancelled && 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Lien « Ajouter à Google Agenda » (pratique pour les gens sur Gmail web).
export function googleCalendarLink({ start, end, title, description, location }) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${utc(start)}/${utc(end)}`,
    details: description || '',
    location: location || '',
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// Lecture minimale des VEVENT renvoyés par un serveur CalDAV (instances déjà « expand »ées).
export function parseBusyFromIcs(ics, hostZoneToMillis) {
  const out = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const ev = block.split('END:VEVENT')[0];
    const get = (name) => {
      const m = ev.match(new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, 'm'));
      return m && { params: m[1] || '', value: m[2].trim() };
    };
    if (get('STATUS')?.value === 'CANCELLED') continue;
    const ds = get('DTSTART');
    const de = get('DTEND');
    if (!ds) continue;
    const start = toMillis(ds, hostZoneToMillis);
    const end = de ? toMillis(de, hostZoneToMillis) : start + (/VALUE=DATE/.test(ds.params) ? 86400000 : 0);
    // « Disponible » (TRANSP:TRANSPARENT) : l'événement existe mais ne bloque pas de créneau.
    out.push({ start, end, ref: get('UID')?.value, free: get('TRANSP')?.value === 'TRANSPARENT' });
  }
  return out;
}

function toMillis({ params, value }, hostZoneToMillis) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const tzid = params.match(/TZID=([^;]+)/)?.[1]?.replace(/^"|"$/g, '');
  return hostZoneToMillis({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +s }, tzid);
}
