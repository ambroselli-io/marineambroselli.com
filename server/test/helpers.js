// Environnement de test commun : base SQLite jetable, Tipimail et Expo interceptés (rien ne part sur le réseau),
// agenda simulé en mémoire. À importer AVANT tout module de src/.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(path.join(tmpdir(), 'rdv-test-')),
  CALENDAR_PROVIDER: 'none',
  HOST_TIMEZONE: 'Europe/Athens',
  HOST_EMAIL: 'marine@example.com',
  TIPIMAIL_API_USER: 'test-user',
  TIPIMAIL_API_KEY: 'test-key',
  EXPO_PUSH_TOKENS: 'ExponentPushToken[test]',
  SITE_URL: 'https://marineambroselli.test',
});
delete process.env.EXPO_ACCESS_TOKEN;
delete process.env.MAIL_DUMP_DIR;

// --- Mails et notifications envoyés ---
export const sent = { mails: [], pushes: [] };
export const failures = { tipimail: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.tipimail.com/')) {
    const body = JSON.parse(init.body);
    if (failures.tipimail) return new Response('{"error":"down"}', { status: 500 });
    sent.mails.push({
      to: body.to[0].address,
      replyTo: body.msg.replyTo?.address,
      subject: body.msg.subject,
      html: body.msg.html,
      text: body.msg.text,
      attachments: body.msg.attachments.map((a) => ({ ...a, content: Buffer.from(a.content, 'base64').toString('utf8') })),
      headers: body.headers,
    });
    return new Response('{}', { status: 200 });
  }
  if (u.startsWith('https://exp.host/')) {
    sent.pushes.push(...JSON.parse(init.body));
    return Response.json({ data: [{ status: 'ok', id: 'x' }] });
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) return realFetch(url, init);
  throw new Error(`Appel réseau inattendu pendant les tests : ${u}`);
};
export function resetSent() {
  sent.mails.length = 0;
  sent.pushes.length = 0;
}
export const mailTo = (email) => sent.mails.filter((m) => m.to === email);

// --- Agenda simulé (remplace le provider « none ») ---
export const fakeCal = {
  events: new Map(), // ref -> { start, end, free? }
  calls: [],
  down: false, // l'agenda ne répond plus
  failWrites: false, // création / mise à jour / suppression en échec
  reset() {
    this.events.clear();
    this.calls.length = 0;
    this.down = false;
    this.failWrites = false;
  },
};
export async function installFakeCalendar() {
  const { calendar } = await import('../src/calendar/index.js');
  const { config } = await import('../src/config.js');
  config.calendarProvider = 'caldav'; // mails comme en prod (iCloud) : pas de .ics joint pour Marine
  const write = (op) => {
    fakeCal.calls.push(op);
    if (fakeCal.failWrites) throw new Error('agenda en panne');
  };
  Object.assign(calendar, {
    name: 'fake',
    async busy(start, end) {
      if (fakeCal.down) throw new Error('agenda injoignable');
      return [...fakeCal.events]
        .map(([ref, e]) => ({ ref, free: false, ...e }))
        .filter((e) => e.start < end.getTime() && e.end > start.getTime());
    },
    async get(b) {
      if (fakeCal.down) throw new Error('agenda injoignable');
      if (!b.calendar_ref) return undefined;
      return fakeCal.events.get(b.calendar_ref) ?? null;
    },
    async create(b, d) {
      write({ op: 'create', id: b.id, d });
      const ref = `${b.id}-marine@test`;
      fakeCal.events.set(ref, { start: d.start.getTime(), end: d.end.getTime() });
      return { ref };
    },
    async update(b, d) {
      write({ op: 'update', id: b.id, d });
      fakeCal.events.set(b.calendar_ref, { start: d.start.getTime(), end: d.end.getTime() });
    },
    async remove(b) {
      write({ op: 'remove', id: b.id });
      fakeCal.events.delete(b.calendar_ref);
    },
  });
  return calendar;
}

// --- Serveur HTTP sur un port libre ---
export async function startServer() {
  const { app } = await import('../src/app.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let ip = 0;
  // Chaque requête vient d'une « IP » différente (X-Forwarded-For, nginx devant) pour ne pas
  // déclencher l'anti-abus ; on peut en forcer une pour le tester.
  const api = async (method, url, body, { fromIp } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fromIp || `10.0.${Math.floor(++ip / 250)}.${ip % 250}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { base, api, close: () => new Promise((r) => server.close(r)) };
}

// --- Dates ---
// Jours ouvrés successifs, un par test, pour que les tests ne se marchent pas dessus.
let lastDay = null;
export function nextWorkday() {
  lastDay = lastDay ? workday(0, null, lastDay.plus({ days: 1 })) : workday(3);
  return lastDay;
}
// Jour ouvré en Grèce, au moins `minDays` jours plus tard (évite le préavis de 2 h et les week-ends).
export function workday(minDays = 3, weekday = null, from = DateTime.now().setZone('Europe/Athens').startOf('day')) {
  let d = from.plus({ days: minDays });
  while (d.weekday > 5 || (weekday && d.weekday !== weekday)) d = d.plus({ days: 1 });
  return d;
}
// Instant UTC ISO (format de /api/slots) pour une heure de Grèce d'un jour donné.
export const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return day.set({ hour: h, minute: m }).toUTC().toISO({ suppressMilliseconds: true });
};
