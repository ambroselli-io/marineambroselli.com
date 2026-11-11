import { DateTime } from 'luxon';
import { config } from './config.js';
import { confirmedBetween } from './db.js';
import { calendar } from './calendar/index.js';

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/**
 * Créneaux libres (début, en UTC ISO) pour un type de rdv entre deux dates (YYYY-MM-DD, fuseau de Marine).
 * excludeId : rdv à ignorer (quand on le déplace).
 */
export async function getSlots(eventType, fromDate, toDate, { excludeId = null, now = DateTime.utc() } = {}) {
  const tz = config.host.timeZone;
  const { minNoticeMinutes, horizonDays, bufferMinutes, weeklyHours } = config.booking;
  const earliest = now.plus({ minutes: minNoticeMinutes });
  const latest = now.plus({ days: horizonDays });

  let day = DateTime.fromISO(fromDate, { zone: tz }).startOf('day');
  const lastDay = DateTime.fromISO(toDate, { zone: tz }).startOf('day');
  if (!day.isValid || !lastDay.isValid || lastDay < day || lastDay.diff(day, 'days').days > 62) {
    throw Object.assign(new Error('Plage de dates invalide'), { status: 400 });
  }

  const candidates = [];
  for (; day <= lastDay; day = day.plus({ days: 1 })) {
    for (const [from, to] of weeklyHours[day.weekday] || []) {
      const [fh, fm] = from.split(':').map(Number);
      const [th, tm] = to.split(':').map(Number);
      const winEnd = day.set({ hour: th, minute: tm });
      for (
        let s = day.set({ hour: fh, minute: fm });
        s.plus({ minutes: eventType.duration }) <= winEnd;
        s = s.plus({ minutes: eventType.duration })
      ) {
        if (s < earliest || s > latest) continue;
        candidates.push(s.toUTC());
      }
    }
  }
  if (!candidates.length) return [];

  const rangeStart = candidates[0].minus({ minutes: bufferMinutes });
  const rangeEnd = candidates.at(-1).plus({ minutes: eventType.duration + bufferMinutes });
  const inRange = confirmedBetween(rangeStart.toISO(), rangeEnd.toISO());
  const busy = inRange
    .filter((b) => b.id !== excludeId)
    .map((b) => ({ start: Date.parse(b.start_utc), end: Date.parse(b.end_utc) }));
  let calOk = true;
  const calEvents = await calendar.busy(rangeStart.toJSDate(), rangeEnd.toJSDate()).catch((e) => {
    console.error('[calendar] busy failed:', e.message);
    calOk = false;
    return [];
  });

  // Rdv que Marine a supprimés de son agenda : on les annule (la cliente est prévenue) et le créneau se libère.
  if (calOk && calendar.name !== 'none') {
    const present = new Set(calEvents.map((e) => e.ref).filter(Boolean));
    const settled = Date.now() - 10 * 60000; // laisse à l'agenda le temps de refléter une création récente
    const deleted = inRange.filter(
      (b) =>
        b.calendar_ref &&
        !present.has(b.calendar_ref) &&
        Date.parse(b.updated_at) < settled &&
        b.start_utc >= rangeStart.toISO() &&
        b.end_utc <= rangeEnd.toISO()
    );
    if (deleted.length) {
      const { cancelDeletedFromCalendar } = await import('./bookings.js');
      for (const b of deleted) {
        await cancelDeletedFromCalendar(b).catch((e) => console.error('[calendar] sync failed:', e.message));
        const i = busy.findIndex((x) => x.start === Date.parse(b.start_utc) && x.end === Date.parse(b.end_utc));
        if (i >= 0) busy.splice(i, 1);
      }
    }
  }

  // Tous les événements « occupé » de l'agenda bloquent, y compris un rdv que Marine a déplacé à la main.
  // Seul l'événement du rdv qu'on est en train de déplacer est ignoré.
  const excludedRef = excludeId && inRange.find((b) => b.id === excludeId)?.calendar_ref;
  for (const e of calEvents) if (!e.free && !(excludedRef && e.ref === excludedRef)) busy.push(e);

  const buf = bufferMinutes * 60000;
  return candidates
    .filter((s) => {
      const start = s.toMillis();
      const end = start + eventType.duration * 60000;
      return !busy.some((b) => overlaps(start - buf, end + buf, b.start, b.end));
    })
    .map((s) => s.toISO({ suppressMilliseconds: true }));
}

export async function isSlotAvailable(eventType, startIso, opts = {}) {
  const start = DateTime.fromISO(startIso, { zone: 'utc' });
  if (!start.isValid) return false;
  const d = start.setZone(config.host.timeZone).toISODate();
  const slots = await getSlots(eventType, d, d, opts);
  return slots.includes(start.toISO({ suppressMilliseconds: true }));
}
