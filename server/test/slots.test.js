import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'rdv-'));
process.env.CALENDAR_PROVIDER = 'none';
process.env.TIPIMAIL_API_USER = '';
process.env.TIPIMAIL_API_KEY = '';
const { getSlots } = await import('../src/slots.js');
const { getEventType } = await import('../src/config.js');
const { insertBookingIfFree } = await import('../src/db.js');
const { buildIcs, parseBusyFromIcs } = await import('../src/ics.js');

const now = DateTime.fromISO('2026-11-09T06:00:00Z'); // lundi 7h à Paris

test('créneaux de 90 min du lundi, heure de Paris', async () => {
  const slots = await getSlots(getEventType('consultation-de-naturopathie'), '2026-11-09', '2026-11-09', { now });
  // 9h00 Paris = 8h00 UTC ; préavis de 2h depuis 7h → premier créneau 9h00
  assert.deepEqual(slots, ['2026-11-09T08:00:00Z', '2026-11-09T09:30:00Z', '2026-11-09T11:00:00Z', '2026-11-09T12:30:00Z', '2026-11-09T14:00:00Z']);
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
  assert.ok(!slots.includes('2026-11-10T08:00:00Z'));
  assert.ok(!slots.includes('2026-11-10T09:00:00Z'));
  const short = await getSlots(getEventType('30min'), '2026-11-10', '2026-11-10', { now });
  assert.ok(short.includes('2026-11-10T08:30:00Z') && !short.includes('2026-11-10T09:00:00Z') && short.includes('2026-11-10T09:30:00Z'));
});

test('ics : génération et relecture', () => {
  const ics = buildIcs({ uid: 'u1', start: '2026-11-10T09:00:00Z', end: '2026-11-10T10:30:00Z', title: 'Test, avec ; virgules', method: null });
  assert.match(ics, /SUMMARY:Test\\, avec \; virgules/);
  const busy = parseBusyFromIcs(ics, () => NaN);
  assert.deepEqual(busy, [{ start: Date.parse('2026-11-10T09:00:00Z'), end: Date.parse('2026-11-10T10:30:00Z'), ref: 'u1' }]);
  const local = 'BEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=Europe/Paris:20261110T100000\r\nDTEND;TZID=Europe/Paris:20261110T110000\r\nEND:VEVENT';
  const conv = ({ y, mo, d, h, mi, s }, tz) => DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }, { zone: tz }).toMillis();
  assert.equal(parseBusyFromIcs(local, conv)[0].start, Date.parse('2026-11-10T09:00:00Z'));
  assert.equal(parseBusyFromIcs('BEGIN:VEVENT\nTRANSP:TRANSPARENT\nDTSTART:20261110\nEND:VEVENT', conv).length, 0);
});
