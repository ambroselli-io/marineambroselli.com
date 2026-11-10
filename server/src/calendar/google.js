// Google Agenda via l'API REST (OAuth refresh token de Marine, voir scripts/google-auth.js).
// Crée l'événement avec un lien Google Meet, comme cal.com.
import { DateTime } from 'luxon';
import { config } from '../config.js';

export const name = 'google';
const API = 'https://www.googleapis.com/calendar/v3';
let token = null;
let tokenExp = 0;

async function accessToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const { clientId, clientSecret, refreshToken } = config.google;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token: ${res.status} ${JSON.stringify(json)}`);
  token = json.access_token;
  tokenExp = Date.now() + json.expires_in * 1000;
  return token;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 410) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google ${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const cal = () => `/calendars/${encodeURIComponent(config.google.calendarId)}`;

export async function busy(start, end) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      singleEvents: 'true',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults: '250',
      ...(pageToken && { pageToken }),
    });
    const json = await api('GET', `${cal()}/events?${q}`);
    for (const e of json.items || []) {
      if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
      if (!e.start?.dateTime) {
        // Journée entière marquée « occupé » (ex. vacances) : bloque toute la journée.
        const s = DateTime.fromISO(e.start.date, { zone: config.host.timeZone });
        const en = DateTime.fromISO(e.end.date, { zone: config.host.timeZone });
        out.push({ start: s.toMillis(), end: en.toMillis(), ref: e.id });
        continue;
      }
      if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
      out.push({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), ref: e.id });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

function eventBody(d) {
  return {
    summary: d.title,
    description: d.description,
    start: { dateTime: d.start.toISOString() },
    end: { dateTime: d.end.toISOString() },
    attendees: [{ email: d.attendee.email, displayName: d.attendee.name }],
    extendedProperties: { private: { source: 'marineambroselli-rdv' } },
    reminders: { useDefault: true },
  };
}

export async function create(booking, d) {
  if (!config.googleMeet) {
    const ev = await api('POST', `${cal()}/events?sendUpdates=none`, { ...eventBody(d), location: d.videoUrl });
    return { ref: ev.id };
  }
  const ev = await api('POST', `${cal()}/events?conferenceDataVersion=1&sendUpdates=none`, {
    ...eventBody(d),
    conferenceData: {
      createRequest: { requestId: booking.id, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  });
  let videoUrl = ev.hangoutLink;
  // La création du Meet peut être asynchrone : on relit l'événement quelques fois.
  for (let i = 0; !videoUrl && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 800));
    videoUrl = (await api('GET', `${cal()}/events/${ev.id}`)).hangoutLink;
  }
  return { ref: ev.id, videoUrl };
}

export async function update(booking, d) {
  if (!booking.calendar_ref) return;
  await api('PATCH', `${cal()}/events/${booking.calendar_ref}?sendUpdates=none`, {
    summary: d.title,
    description: d.description,
    start: { dateTime: d.start.toISOString() },
    end: { dateTime: d.end.toISOString() },
  });
}

export async function remove(booking) {
  if (!booking.calendar_ref) return;
  await api('DELETE', `${cal()}/events/${booking.calendar_ref}?sendUpdates=none`);
}
