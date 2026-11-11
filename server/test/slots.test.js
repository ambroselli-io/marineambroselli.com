import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'rdv-'));
process.env.CALENDAR_PROVIDER = 'none';
process.env.HOST_TIMEZONE = 'Europe/Athens';
process.env.TIPIMAIL_API_USER = '';
process.env.TIPIMAIL_API_KEY = '';
const { getSlots } = await import('../src/slots.js');
const { getEventType } = await import('../src/config.js');
const { insertBookingIfFree } = await import('../src/db.js');
const { buildIcs, parseBusyFromIcs } = await import('../src/ics.js');

const now = DateTime.fromISO('2026-11-09T06:00:00Z'); // lundi 8h en Grèce

test('créneaux de 90 min du lundi, heures de Marine en Grèce', async () => {
  const slots = await getSlots(getEventType('consultation-de-naturopathie'), '2026-11-09', '2026-11-09', { now });
  // 9h00 en Grèce = 7h00 UTC ; préavis de 2h depuis 8h (Grèce) → 9h00 exclu, premier créneau 10h30
  assert.deepEqual(slots, ['2026-11-09T08:30:00Z', '2026-11-09T10:00:00Z', '2026-11-09T11:30:00Z', '2026-11-09T13:00:00Z']);
});

test('pas de créneau le week-end', async () => {
  assert.deepEqual(await getSlots(getEventType('30min'), '2026-11-14', '2026-11-15', { now }), []);
});

test('un rdv existant bloque les créneaux qui le chevauchent, et pas de double réservation', async () => {
  const b = {
    id: 'x1', event_type: '30min', start_utc: '2026-11-10T09:00:00.000Z', end_utc: '2026-11-10T09:30:00.000Z',
    name: 'A', email: 'a@b.c', phone: null, notes: null, option: null, time_zone: 'Europe/Paris',
    attendee_token: 'a', host_token: 'h', video_url: 'v',
  };
  assert.equal(insertBookingIfFree(b, 0), true);
  assert.equal(insertBookingIfFree({ ...b, id: 'x2', start_utc: '2026-11-10T09:15:00.000Z', end_utc: '2026-11-10T09:45:00.000Z' }, 0), false);
  const slots = await getSlots(getEventType('consultation-de-naturopathie'), '2026-11-10', '2026-11-10', { now });
  assert.ok(!slots.includes('2026-11-10T08:30:00Z'));
  assert.ok(slots.includes('2026-11-10T10:00:00Z'));
  const short = await getSlots(getEventType('30min'), '2026-11-10', '2026-11-10', { now });
  assert.ok(short.includes('2026-11-10T08:30:00Z') && !short.includes('2026-11-10T09:00:00Z') && short.includes('2026-11-10T09:30:00Z'));
});

test('ics : génération et relecture', () => {
  const ics = buildIcs({ uid: 'u1', start: '2026-11-10T09:00:00Z', end: '2026-11-10T10:30:00Z', title: 'Test, avec ; virgules', method: null });
  assert.match(ics, /SUMMARY:Test\\, avec \; virgules/);
  const busy = parseBusyFromIcs(ics, () => NaN);
  assert.deepEqual(busy, [{ start: Date.parse('2026-11-10T09:00:00Z'), end: Date.parse('2026-11-10T10:30:00Z'), ref: 'u1', free: false }]);
  const local = 'BEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=Europe/Paris:20261110T100000\r\nDTEND;TZID=Europe/Paris:20261110T110000\r\nEND:VEVENT';
  const conv = ({ y, mo, d, h, mi, s }, tz) => DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }, { zone: tz }).toMillis();
  assert.equal(parseBusyFromIcs(local, conv)[0].start, Date.parse('2026-11-10T09:00:00Z'));
  assert.equal(parseBusyFromIcs('BEGIN:VEVENT\nTRANSP:TRANSPARENT\nDTSTART:20261110\nEND:VEVENT', conv)[0].free, true);
});

test("agenda de Marine : rdv supprimé → annulé, rdv déplacé → déplacé ; mails envoyés", async () => {
  const { calendar } = await import('../src/calendar/index.js');
  const { db, getBooking } = await import('../src/db.js');
  const base = {
    event_type: '30min', name: 'B', email: 'b@b.c', phone: null, notes: null, option: null,
    time_zone: 'Europe/Paris', attendee_token: 'a2', host_token: 'h2', video_url: 'v',
  };
  const D = '2026-12-02'; // mercredi, dans le futur
  insertBookingIfFree({ ...base, id: 'del', start_utc: `${D}T07:00:00.000Z`, end_utc: `${D}T07:30:00.000Z` }, 0);
  insertBookingIfFree({ ...base, id: 'mov', start_utc: `${D}T08:00:00.000Z`, end_utc: `${D}T08:30:00.000Z` }, 0);
  insertBookingIfFree({ ...base, id: 'far', start_utc: `${D}T09:00:00.000Z`, end_utc: `${D}T09:30:00.000Z` }, 0);
  db.prepare("UPDATE bookings SET calendar_ref = id || '@ref', updated_at = '2026-01-01T00:00:00.000Z' WHERE id IN ('del','mov','far')").run();
  // Agenda simulé : « del » supprimé, « mov » déplacé à 10:00 UTC le même jour, « far » déplacé au mois suivant.
  Object.assign(calendar, {
    name: 'fake',
    busy: async () => [{ start: Date.parse(`${D}T10:00:00Z`), end: Date.parse(`${D}T10:30:00Z`), ref: 'mov@ref' }],
    get: async (b) =>
      b.id === 'far' ? { start: Date.parse('2027-01-06T09:00:00Z'), end: Date.parse('2027-01-06T09:30:00Z') } : null,
  });
  const now = DateTime.fromISO(`${D}T04:00:00Z`);
  const slots = await getSlots(getEventType('30min'), D, D, { now });
  assert.equal(getBooking('del').status, 'cancelled');
  assert.equal(getBooking('mov').start_utc, `${D}T10:00:00.000Z`);
  assert.equal(getBooking('mov').sequence, 1);
  assert.equal(getBooking('far').status, 'confirmed');
  assert.equal(getBooking('far').start_utc, '2027-01-06T09:00:00.000Z');
  for (const t of ['07:00', '08:00', '09:00']) assert.ok(slots.includes(`${D}T${t}:00Z`), `${t} libéré`);
  assert.ok(!slots.includes(`${D}T10:00:00Z`), 'nouvelle heure bloquée');
});
