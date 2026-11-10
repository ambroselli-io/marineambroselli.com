// Agenda CalDAV (iCloud / Calendrier Apple, Fastmail, Nextcloud…).
// iCloud : CALDAV_USERNAME = identifiant Apple, CALDAV_PASSWORD = mot de passe pour app.
import { createDAVClient } from 'tsdav';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { buildIcs, parseBusyFromIcs } from '../ics.js';

export const name = 'caldav';
let clientPromise = null;
let calendarPromise = null;

function client() {
  clientPromise ??= createDAVClient({
    serverUrl: config.caldav.url,
    credentials: { username: config.caldav.username, password: config.caldav.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  }).catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

async function targetCalendar() {
  calendarPromise ??= (async () => {
    const c = await client();
    const cals = (await c.fetchCalendars()).filter((x) => !x.components || x.components.includes('VEVENT'));
    const wanted = config.caldav.calendarName;
    const cal = wanted ? cals.find((x) => x.displayName === wanted) : cals[0];
    if (!cal) throw new Error(`Calendrier CalDAV introuvable (${wanted || 'aucun'}). Disponibles : ${cals.map((x) => x.displayName).join(', ')}`);
    return cal;
  })().catch((e) => {
    calendarPromise = null;
    throw e;
  });
  return calendarPromise;
}

const hostZoneToMillis = ({ y, mo, d, h, mi, s }, tzid) => {
  const zone = tzid && DateTime.local().setZone(tzid).isValid ? tzid : config.host.timeZone;
  return DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }, { zone }).toMillis();
};

export async function busy(start, end) {
  const c = await client();
  const cal = await targetCalendar();
  const objects = await c.fetchCalendarObjects({
    calendar: cal,
    timeRange: { start: start.toISOString(), end: end.toISOString() },
    expand: true,
  });
  return objects
    .flatMap((o) => parseBusyFromIcs(o.data || '', hostZoneToMillis))
    .filter((b) => b.start < end.getTime() && b.end > start.getTime());
}

// UID différent de celui de l'invitation envoyée à la cliente (`${id}@marineambroselli.com`) :
// sinon iCloud confond l'événement de l'agenda de Marine et l'invitation mail quand un même compte
// voit les deux (calendrier partagé), et un déplacement laisse des doublons.
const uidOf = (booking) => `${booking.id}-marine@marineambroselli.com`;
// Les rdv créés avant ce changement gardent leur ancien UID/nom de fichier.
const isLegacy = (booking) => booking.calendar_ref === `${booking.id}@marineambroselli.com`;
const fileOf = (booking) => (isLegacy(booking) ? `${booking.id}.ics` : `${booking.id}-marine.ics`);

function ics(booking, d) {
  return buildIcs({
    uid: isLegacy(booking) ? booking.calendar_ref : uidOf(booking),
    sequence: booking.sequence,
    start: d.start,
    end: d.end,
    title: d.title,
    description: d.description,
    location: d.videoUrl,
    url: d.videoUrl,
    method: null,
  });
}

export async function create(booking, d) {
  const c = await client();
  const cal = await targetCalendar();
  const res = await c.createCalendarObject({ calendar: cal, filename: fileOf(booking), iCalString: ics(booking, d) });
  if (!res.ok) throw new Error(`CalDAV create: ${res.status}`);
  return { ref: uidOf(booking) };
}

export async function update(booking, d) {
  const c = await client();
  const cal = await targetCalendar();
  const res = await c.updateCalendarObject({
    calendarObject: { url: new URL(fileOf(booking), cal.url).href, data: ics(booking, d) },
  });
  if (!res.ok) throw new Error(`CalDAV update: ${res.status}`);
}

export async function remove(booking) {
  const c = await client();
  const cal = await targetCalendar();
  const res = await c.deleteCalendarObject({ calendarObject: { url: new URL(fileOf(booking), cal.url).href } });
  if (!res.ok && res.status !== 404) throw new Error(`CalDAV delete: ${res.status}`);
}
