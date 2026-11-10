import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import { config, getEventType } from './config.js';
import { getBooking, insertBookingIfFree, moveBookingIfFree, updateBooking } from './db.js';
import { isSlotAvailable } from './slots.js';
import { calendar } from './calendar/index.js';
import { notify, calendarDescription } from './emails.js';

const token = (n = 24) => randomBytes(n).toString('base64url');
const httpError = (status, message) => Object.assign(new Error(message), { status });

const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const validZone = (z) => typeof z === 'string' && DateTime.local().setZone(z).isValid;

function calendarDetails(b, type) {
  return {
    title: `${type.title} – ${b.name}`,
    description: calendarDescription(b, type),
    start: new Date(b.start_utc),
    end: new Date(b.end_utc),
    attendee: { name: b.name, email: b.email },
    videoUrl: b.video_url,
  };
}

const endOf = (startIso, type) => DateTime.fromISO(startIso, { zone: 'utc' }).plus({ minutes: type.duration }).toJSDate().toISOString();

export async function createBooking(input) {
  const type = getEventType(input.eventType);
  if (!type) throw httpError(400, 'Type de rendez-vous inconnu');
  const name = clean(input.name, 120);
  const email = clean(input.email, 200).toLowerCase();
  if (!name) throw httpError(400, 'Merci d’indiquer votre nom');
  if (!isEmail(email)) throw httpError(400, 'Adresse email invalide');
  const option = type.options ? clean(input.option, 200) : '';
  if (type.options && !type.options.choices.includes(option)) throw httpError(400, `Merci de choisir : ${type.options.label}`);

  if (!(await isSlotAvailable(type, input.start))) throw httpError(409, 'Ce créneau n’est plus disponible, merci d’en choisir un autre.');

  const id = token(12);
  const startIso = new Date(input.start).toISOString();
  const b = {
    id,
    event_type: type.slug,
    start_utc: startIso,
    end_utc: endOf(startIso, type),
    name,
    email,
    phone: clean(input.phone, 40) || null,
    notes: clean(input.notes, 2000) || null,
    option: option || null,
    time_zone: validZone(input.timeZone) ? input.timeZone : config.host.timeZone,
    attendee_token: token(),
    host_token: token(),
    video_url: config.videoUrlTemplate.replace('{id}', id),
  };
  if (!insertBookingIfFree(b, config.booking.bufferMinutes)) throw httpError(409, 'Ce créneau vient d’être réservé, merci d’en choisir un autre.');

  let calendarError = null;
  try {
    const res = await calendar.create({ ...b, sequence: 0 }, calendarDetails(b, type));
    const fields = { calendar_ref: res.ref };
    if (res.videoUrl) fields.video_url = res.videoUrl;
    updateBooking(id, fields);
    // Met à jour la description de l'agenda si le lien visio a changé (Google Meet).
    if (res.videoUrl && res.videoUrl !== b.video_url) {
      const fresh = getBooking(id);
      await calendar.update(fresh, calendarDetails(fresh, type)).catch(() => {});
    }
  } catch (e) {
    console.error('[calendar] create failed:', e.message);
    calendarError = e.message.slice(0, 200);
  }
  const saved = getBooking(id);
  await notify('created', saved, type, { calendarError });
  return publicView(saved, 'attendee');
}

export function authorize(id, t) {
  const b = getBooking(id);
  if (!b || typeof t !== 'string') throw httpError(404, 'Rendez-vous introuvable');
  const eq = (a, c) => a.length === c.length && timingSafeEqual(Buffer.from(a), Buffer.from(c));
  if (eq(t, b.host_token)) return { b, role: 'host' };
  if (eq(t, b.attendee_token)) return { b, role: 'attendee' };
  throw httpError(404, 'Rendez-vous introuvable');
}

export function publicView(b, role) {
  const type = getEventType(b.event_type);
  return {
    id: b.id,
    role,
    status: b.status,
    eventType: { slug: type.slug, title: type.title, duration: type.duration },
    start: b.start_utc,
    end: b.end_utc,
    name: b.name,
    email: b.email,
    phone: role === 'host' ? b.phone : undefined,
    notes: b.notes,
    option: b.option,
    timeZone: b.time_zone,
    videoUrl: b.video_url,
    cancelReason: b.cancel_reason,
    hostName: config.host.name,
    hostTimeZone: config.host.timeZone,
    token: role === 'host' ? b.host_token : b.attendee_token,
  };
}

export async function cancelBooking(id, t, reason) {
  const { b, role } = authorize(id, t);
  if (b.status !== 'confirmed') throw httpError(409, 'Ce rendez-vous est déjà annulé.');
  if (role !== 'host' && Date.parse(b.start_utc) < Date.now()) throw httpError(409, 'Ce rendez-vous est déjà passé.');
  updateBooking(id, { status: 'cancelled', cancel_reason: clean(reason, 500) || null });
  const type = getEventType(b.event_type);
  let calendarError = null;
  await calendar.remove(b).catch((e) => {
    console.error('[calendar] remove failed:', e.message);
    calendarError = e.message.slice(0, 200);
  });
  const saved = getBooking(id);
  await notify('cancelled', saved, type, { by: role, calendarError });
  return publicView(saved, role);
}

export async function rescheduleBooking(id, t, start) {
  const { b, role } = authorize(id, t);
  if (b.status !== 'confirmed') throw httpError(409, 'Ce rendez-vous est annulé.');
  if (role !== 'host' && Date.parse(b.start_utc) < Date.now()) throw httpError(409, 'Ce rendez-vous est déjà passé.');
  const type = getEventType(b.event_type);
  if (!(await isSlotAvailable(type, start, { excludeId: id }))) throw httpError(409, 'Ce créneau n’est plus disponible, merci d’en choisir un autre.');
  const startIso = new Date(start).toISOString();
  if (!moveBookingIfFree(id, startIso, endOf(startIso, type), config.booking.bufferMinutes))
    throw httpError(409, 'Ce créneau vient d’être réservé, merci d’en choisir un autre.');
  const saved = getBooking(id);
  let calendarError = null;
  await calendar.update(saved, calendarDetails(saved, type)).catch((e) => {
    console.error('[calendar] update failed:', e.message);
    calendarError = e.message.slice(0, 200);
  });
  await notify('rescheduled', saved, type, { by: role, previous: b, calendarError });
  return publicView(saved, role);
}
