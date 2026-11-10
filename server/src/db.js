import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, 'rdv.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  option TEXT,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  attendee_token TEXT NOT NULL,
  host_token TEXT NOT NULL,
  video_url TEXT,
  calendar_ref TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings(start_utc);
`);

const toBooking = (r) => r && { ...r };

export function getBooking(id) {
  return toBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
}

export function confirmedBetween(startUtc, endUtc, excludeId = null) {
  return db
    .prepare(
      `SELECT * FROM bookings WHERE status = 'confirmed' AND start_utc < ? AND end_utc > ? AND id IS NOT ?`
    )
    .all(endUtc, startUtc, excludeId);
}

// Vérification + insertion dans une même transaction : pas de double réservation.
export const insertBookingIfFree = db.transaction((b, bufferMin) => {
  const { start, end } = withBuffer(b.start_utc, b.end_utc, bufferMin);
  if (confirmedBetween(start, end).length) return false;
  db.prepare(
    `INSERT INTO bookings (id, event_type, start_utc, end_utc, name, email, phone, notes, option, time_zone, attendee_token, host_token, video_url)
     VALUES (@id, @event_type, @start_utc, @end_utc, @name, @email, @phone, @notes, @option, @time_zone, @attendee_token, @host_token, @video_url)`
  ).run(b);
  return true;
});

export const moveBookingIfFree = db.transaction((id, startUtc, endUtc, bufferMin) => {
  const { start, end } = withBuffer(startUtc, endUtc, bufferMin);
  if (confirmedBetween(start, end, id).length) return false;
  db.prepare(
    `UPDATE bookings SET start_utc = ?, end_utc = ?, sequence = sequence + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(startUtc, endUtc, id);
  return true;
});

export function updateBooking(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE bookings SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`).run({
    ...fields,
    id,
  });
}

function withBuffer(startIso, endIso, bufferMin) {
  const ms = bufferMin * 60000;
  return {
    start: new Date(Date.parse(startIso) - ms).toISOString(),
    end: new Date(Date.parse(endIso) + ms).toISOString(),
  };
}
