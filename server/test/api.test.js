// Parcours complets via l'API HTTP, comme le site les appelle : réserver, consulter, déplacer, annuler,
// et ce qui se passe quand Marine touche au rdv dans son agenda. Vérifie aussi les mails, les notifs et l'agenda.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sent, failures, resetSent, mailTo, fakeCal, installFakeCalendar, startServer, nextWorkday, at } from './helpers.js';

const { db, getBooking } = await import('../src/db.js');
await installFakeCalendar();

const MARINE = 'marine@example.com';
const CONSULT = 'consultation-de-naturopathie';
const FORMULE = 'Consultation unique (80 €)';
let srv;
let api;

before(async () => {
  srv = await startServer();
  api = srv.api;
});
after(() => srv.close());
beforeEach(() => {
  resetSent();
  fakeCal.reset();
  failures.tipimail = false;
});

const slotsOf = async (day, type = CONSULT, extra = '') => {
  const d = day.toISODate();
  const r = await api('GET', `/api/slots?type=${type}&from=${d}&to=${d}${extra}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.slots;
};

const book = (start, over = {}, opts) =>
  api('POST', '/api/bookings', {
    eventType: CONSULT,
    start,
    timeZone: 'Europe/Paris',
    name: 'Julie Test',
    email: 'julie@example.com',
    phone: '06 12 34 56 78',
    option: FORMULE,
    notes: 'Fatigue et sommeil',
    ...over,
  }, opts);

const hostTokenOf = (id) => getBooking(id).host_token;
// Simule un rdv créé/modifié il y a longtemps (la synchro avec l'agenda attend 10 min).
const age = (id) => db.prepare("UPDATE bookings SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

test('santé et types de rdv', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const t = await api('GET', '/api/event-types');
  assert.equal(t.body.hostTimeZone, 'Europe/Athens');
  assert.deepEqual(t.body.eventTypes.map((e) => e.slug), [CONSULT, '30min', 'appel-decouverte']);
});

test('réservation : rdv créé, mails cliente + Marine, notif, agenda, créneau pris', async () => {
  const day = nextWorkday();
  const start = at(day, '10:30');
  assert.deepEqual(await slotsOf(day), ['09:00', '10:30', '12:00', '13:30', '15:00'].map((h) => at(day, h)));

  const r = await book(start);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.status, 'confirmed');
  assert.equal(b.role, 'attendee');
  assert.equal(b.start, new Date(start).toISOString());
  assert.equal(Date.parse(b.end) - Date.parse(b.start), 90 * 60000);
  assert.equal(b.phone, undefined, 'la cliente ne reçoit pas les données réservées à Marine');
  const saved = getBooking(b.id);
  assert.equal(b.token, saved.attendee_token);
  assert.notEqual(saved.host_token, saved.attendee_token);
  assert.equal(saved.option, FORMULE);
  assert.equal(saved.video_url, 'https://meet.jit.si/marineambroselli');

  // Mail à la cliente
  assert.equal(sent.mails.length, 2);
  const [toClient] = mailTo('julie@example.com');
  assert.equal(toClient.subject, 'Votre rendez-vous est confirmé : Consultation de naturopathie');
  assert.equal(toClient.replyTo, MARINE);
  assert.match(toClient.html, /heure de Paris/);
  assert.ok(toClient.html.includes(`/rdv/gerer.html?id=${b.id}&amp;t=${saved.attendee_token}`), 'lien modifier/annuler de la cliente');
  assert.ok(!toClient.html.includes(saved.host_token), 'jamais le lien de Marine dans le mail de la cliente');
  assert.ok(toClient.html.includes('https://meet.jit.si/marineambroselli'));
  assert.deepEqual(toClient.headers['X-TM-TRACKING'], { html: { open: 0, click: 0 }, text: { click: 0 } }, 'pas de réécriture des liens par Tipimail');
  const [ics] = toClient.attachments;
  assert.equal(ics.filename, 'rendez-vous.ics');
  assert.match(ics.content, /METHOD:REQUEST/);
  assert.match(ics.content, new RegExp(`UID:${b.id}@marineambroselli.com`));
  assert.match(ics.content, /SEQUENCE:0/);
  assert.match(ics.content, new RegExp(`DTSTART:${start.replace(/[-:]/g, '')}`));

  // Mail à Marine
  const [toMarine] = mailTo(MARINE);
  assert.equal(toMarine.subject, 'Nouveau rendez-vous : Julie Test');
  assert.equal(toMarine.replyTo, 'julie@example.com');
  assert.match(toMarine.html, /heure de Grèce/);
  assert.ok(toMarine.html.includes(`t=${saved.host_token}`), 'lien modifier/annuler de Marine');
  assert.ok(toMarine.html.includes('href="tel:+33612345678"'), 'téléphone cliquable');
  assert.ok(toMarine.html.includes('06&nbsp;12&nbsp;34&nbsp;56&nbsp;78'), 'téléphone jamais coupé');
  assert.ok(toMarine.html.includes('https://wa.me/33612345678'));
  assert.match(toMarine.html, /Fatigue et sommeil/);
  assert.match(toMarine.html, /Consultation unique \(80 €\)/);
  assert.equal(toMarine.attachments.length, 0, "l'agenda est à jour, pas de .ics en double");

  // Notif sur le téléphone de Marine
  assert.equal(sent.pushes.length, 1);
  assert.equal(sent.pushes[0].to, 'ExponentPushToken[test]');
  assert.equal(sent.pushes[0].title, '📅 Nouveau rdv');
  assert.match(sent.pushes[0].body, /Julie Test · Consultation de naturopathie/);
  assert.match(sent.pushes[0].body, /Notes : Fatigue et sommeil/);
  assert.match(sent.pushes[0].body, /Tél : 06 12 34 56 78/);

  // Agenda de Marine
  assert.deepEqual(fakeCal.calls.map((c) => c.op), ['create']);
  assert.equal(fakeCal.calls[0].d.title, 'Consultation de naturopathie – Julie Test');
  assert.match(fakeCal.calls[0].d.description, /Téléphone : 06 12 34 56 78/);
  assert.equal(saved.calendar_ref, `${b.id}-marine@test`);

  // Le créneau n'est plus proposé, les autres oui
  const after = await slotsOf(day);
  assert.ok(!after.includes(start));
  assert.ok(after.includes(at(day, '09:00')) && after.includes(at(day, '12:00')));
  const short = await slotsOf(day, '30min');
  for (const h of ['10:30', '11:00', '11:30']) assert.ok(!short.includes(at(day, h)), `30 min à ${h} bloqué`);
  assert.ok(short.includes(at(day, '12:00')));
});

test('pas de double réservation, même pour un rdv qui chevauche', async () => {
  const day = nextWorkday();
  assert.equal((await book(at(day, '12:00'))).status, 201);
  resetSent();
  const again = await book(at(day, '12:00'), { email: 'autre@example.com' });
  assert.equal(again.status, 409);
  const overlap = await api('POST', '/api/bookings', { eventType: '30min', start: at(day, '13:00'), name: 'X', email: 'x@example.com' });
  assert.equal(overlap.status, 409);
  assert.equal(sent.mails.length + sent.pushes.length, 0, 'aucun mail ni notif pour un refus');
  // Deux réservations simultanées du même créneau : une seule passe.
  const both = await Promise.all([book(at(day, '15:00'), { email: 'a@example.com' }), book(at(day, '15:00'), { email: 'b@example.com' })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
});

test("un événement « occupé » de l'agenda de Marine bloque le créneau, un « disponible » non", async () => {
  const day = nextWorkday();
  fakeCal.events.set('perso', { start: Date.parse(at(day, '09:30')), end: Date.parse(at(day, '10:00')) });
  fakeCal.events.set('dispo', { start: Date.parse(at(day, '12:00')), end: Date.parse(at(day, '13:00')), free: true });
  const slots = await slotsOf(day);
  assert.ok(!slots.includes(at(day, '09:00')));
  assert.ok(slots.includes(at(day, '12:00')));
  assert.equal((await book(at(day, '09:00'))).status, 409);
});

test('demandes invalides refusées sans rien créer ni envoyer', async () => {
  const day = nextWorkday();
  const saturday = day.plus({ days: 6 - day.weekday });
  const cases = [
    [{ name: '' }, 400, /nom/],
    [{ email: 'pas-un-email' }, 400, /email/i],
    [{ option: '' }, 400, /Formule/],
    [{ option: 'Gratuit' }, 400, /Formule/],
    [{ eventType: 'inconnu' }, 400, /inconnu/],
    [{ website: 'http://spam' }, 400, /invalide/], // pot de miel anti-robots
    [{ start: at(day, '08:00') }, 409], // avant les heures de Marine
    [{ start: at(day, '10:45') }, 409], // pas un début de créneau
    [{ start: at(saturday, '10:30') }, 409], // week-end
    [{ start: '2020-01-06T08:00:00Z' }, 409], // passé
    [{ start: at(day.plus({ days: 90 }), '10:30') }, 409], // trop loin
    [{ start: 'n importe quoi' }, 409],
  ];
  for (const [over, status, msg] of cases) {
    const r = await book(at(day, '10:30'), over);
    assert.equal(r.status, status, `${JSON.stringify(over)} → ${JSON.stringify(r.body)}`);
    if (msg) assert.match(r.body.error, msg);
  }
  const bad = await api('GET', `/api/slots?type=${CONSULT}&from=2026-01-10&to=2025-01-01`);
  assert.equal(bad.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings WHERE start_utc LIKE ?').get(`${day.toISODate()}%`).n, 0);
  assert.equal(sent.mails.length + sent.pushes.length + fakeCal.calls.length, 0);
});

test('page « gérer mon rdv » : accès par lien uniquement, vue cliente / vue Marine, .ics', async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '09:00'));
  const host = hostTokenOf(b.id);

  const asClient = await api('GET', `/api/bookings/${b.id}?t=${b.token}`);
  assert.equal(asClient.status, 200);
  assert.equal(asClient.body.role, 'attendee');
  assert.equal(asClient.body.phone, undefined);
  assert.equal(asClient.body.token, b.token);

  const asHost = await api('GET', `/api/bookings/${b.id}?t=${host}`);
  assert.equal(asHost.body.role, 'host');
  assert.equal(asHost.body.phone, '06 12 34 56 78');
  assert.equal(asHost.body.hostTimeZone, 'Europe/Athens');

  for (const url of [`/api/bookings/${b.id}?t=mauvais`, `/api/bookings/${b.id}`, `/api/bookings/inexistant?t=${b.token}`]) {
    assert.equal((await api('GET', url)).status, 404, url);
  }

  const ics = await api('GET', `/api/bookings/${b.id}/ics?t=${b.token}`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.body, /BEGIN:VEVENT/);
  assert.match(ics.body, /STATUS:CONFIRMED/);
  assert.equal((await api('GET', `/api/bookings/${b.id}/ics?t=x`)).status, 404);
});

test('la cliente déplace son rdv : nouveau créneau, mails, notif, agenda mis à jour', async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '10:30'));
  resetSent();
  fakeCal.calls.length = 0;

  // Les créneaux proposés pour le déplacement incluent le sien
  const choices = await slotsOf(day, CONSULT, `&id=${b.id}&t=${b.token}`);
  assert.ok(choices.includes(at(day, '10:30')));
  assert.equal((await api('GET', `/api/slots?type=${CONSULT}&from=${day.toISODate()}&to=${day.toISODate()}&id=${b.id}&t=x`)).status, 404);

  const r = await api('POST', `/api/bookings/${b.id}/reschedule`, { t: b.token, start: at(day, '13:30') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.start, new Date(at(day, '13:30')).toISOString());
  assert.equal(getBooking(b.id).sequence, 1);

  const [toClient] = mailTo('julie@example.com');
  assert.equal(toClient.subject, 'Votre rendez-vous a été déplacé : Consultation de naturopathie');
  assert.match(toClient.html, /il était prévu le/);
  assert.match(toClient.attachments[0].content, /SEQUENCE:1/);
  assert.match(toClient.attachments[0].content, new RegExp(`UID:${b.id}@marineambroselli.com`), "même UID : l'agenda de la cliente remplace l'ancien");
  const [toMarine] = mailTo(MARINE);
  assert.equal(toMarine.subject, 'Rendez-vous déplacé : Julie Test');
  assert.match(toMarine.html, /Julie Test a déplacé le rendez-vous/);
  assert.equal(sent.pushes[0].title, '🔁 Rdv déplacé');
  assert.match(sent.pushes[0].body, /→/);

  assert.deepEqual(fakeCal.calls.map((c) => c.op), ['update']);
  assert.equal(fakeCal.events.get(getBooking(b.id).calendar_ref).start, Date.parse(at(day, '13:30')));

  const slots = await slotsOf(day);
  assert.ok(slots.includes(at(day, '10:30')), 'ancien créneau libéré');
  assert.ok(!slots.includes(at(day, '13:30')), 'nouveau créneau pris');

  // Vers un créneau déjà pris : refusé
  const { body: other } = await book(at(day, '15:00'), { email: 'autre@example.com' });
  assert.ok(other.id);
  const clash = await api('POST', `/api/bookings/${b.id}/reschedule`, { t: b.token, start: at(day, '15:00') });
  assert.equal(clash.status, 409);
  assert.equal(getBooking(b.id).start_utc, new Date(at(day, '13:30')).toISOString());
});

test('Marine déplace un rdv depuis son lien : la cliente est prévenue', async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '09:00'));
  resetSent();
  const r = await api('POST', `/api/bookings/${b.id}/reschedule`, { t: hostTokenOf(b.id), start: at(day, '12:00') });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'host');
  assert.equal(mailTo('julie@example.com')[0].subject, 'Votre rendez-vous a été déplacé : Consultation de naturopathie');
  assert.match(mailTo(MARINE)[0].html, /Tu as déplacé le rendez-vous/);
  assert.equal(sent.pushes[0].title, '🔁 Rdv déplacé (par toi)');
});

test('la cliente annule : rdv annulé avec motif, mails, notif, retiré de l’agenda, créneau libéré', async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '12:00'));
  resetSent();
  fakeCal.calls.length = 0;

  const r = await api('POST', `/api/bookings/${b.id}/cancel`, { t: b.token, reason: 'Empêchement' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.cancelReason, 'Empêchement');

  const [toClient] = mailTo('julie@example.com');
  assert.equal(toClient.subject, 'Votre rendez-vous est annulé : Consultation de naturopathie');
  assert.match(toClient.html, /Vous avez annulé le rendez-vous/);
  assert.match(toClient.html, /Motif : Empêchement/);
  assert.equal(toClient.attachments[0].filename, 'annulation.ics');
  assert.match(toClient.attachments[0].content, /METHOD:CANCEL/);
  assert.match(toClient.attachments[0].content, /STATUS:CANCELLED/);
  const [toMarine] = mailTo(MARINE);
  assert.equal(toMarine.subject, 'Rendez-vous annulé : Julie Test');
  assert.match(toMarine.html, /Motif : Empêchement/);
  assert.equal(sent.pushes[0].title, '❌ Rdv annulé');
  assert.match(sent.pushes[0].body, /Motif : Empêchement/);
  assert.deepEqual(fakeCal.calls.map((c) => c.op), ['remove']);
  assert.ok((await slotsOf(day)).includes(at(day, '12:00')));

  resetSent();
  assert.equal((await api('POST', `/api/bookings/${b.id}/cancel`, { t: b.token })).status, 409);
  assert.equal((await api('POST', `/api/bookings/${b.id}/reschedule`, { t: b.token, start: at(day, '15:00') })).status, 409);
  assert.equal((await api('POST', `/api/bookings/${b.id}/cancel`, { t: 'mauvais' })).status, 404);
  assert.equal(sent.mails.length, 0);
  const ics = await api('GET', `/api/bookings/${b.id}/ics?t=${b.token}`);
  assert.match(ics.body, /STATUS:CANCELLED/);
});

test('Marine annule depuis son lien : la cliente reçoit le motif', async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '13:30'));
  resetSent();
  const r = await api('POST', `/api/bookings/${b.id}/cancel`, { t: hostTokenOf(b.id), reason: 'Malade' });
  assert.equal(r.status, 200);
  const [toClient] = mailTo('julie@example.com');
  assert.match(toClient.html, /Marine Ambroselli a annulé le rendez-vous/);
  assert.match(toClient.html, /Motif : Malade/);
  assert.equal(sent.pushes[0].title, '❌ Rdv annulé (par toi)');
});

test("agenda en panne à la réservation : le rdv est quand même pris et Marine reçoit le .ics", async () => {
  const day = nextWorkday();
  fakeCal.failWrites = true;
  const r = await book(at(day, '10:30'));
  assert.equal(r.status, 201);
  assert.equal(getBooking(r.body.id).status, 'confirmed');
  assert.equal(mailTo('julie@example.com').length, 1);
  const [toMarine] = mailTo(MARINE);
  assert.match(toMarine.html, /n'a pas pu être mis à jour automatiquement dans ton agenda/);
  assert.equal(toMarine.attachments[0].filename, 'rendez-vous.ics');
});

test("Tipimail en panne : le rdv est quand même pris et Marine a sa notif", async () => {
  const day = nextWorkday();
  failures.tipimail = true;
  const r = await book(at(day, '09:00'));
  assert.equal(r.status, 201);
  assert.equal(getBooking(r.body.id).status, 'confirmed');
  assert.equal(sent.pushes.length, 1);
});

test("Marine supprime le rdv dans son agenda : annulé, cliente prévenue, créneau libéré", async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '10:30'));
  age(b.id);
  fakeCal.events.delete(getBooking(b.id).calendar_ref);
  resetSent();

  const slots = await slotsOf(day); // n'importe qui ouvre la page de réservation
  assert.ok(slots.includes(at(day, '10:30')));
  assert.equal(getBooking(b.id).status, 'cancelled');
  const [toClient] = mailTo('julie@example.com');
  assert.equal(toClient.subject, 'Votre rendez-vous est annulé : Consultation de naturopathie');
  assert.match(toClient.html, /Marine Ambroselli a annulé le rendez-vous/);
  assert.equal(sent.pushes[0].title, '❌ Rdv annulé (par toi)');

  // Une seule fois
  resetSent();
  await slotsOf(day);
  assert.equal(sent.mails.length, 0);
});

test("Marine déplace le rdv dans son agenda (même jour ou bien plus tard) : cliente prévenue", async () => {
  const day = nextWorkday();
  const { body: near } = await book(at(day, '09:00'));
  const { body: far } = await book(at(day, '13:30'), { email: 'loin@example.com', name: 'Loin' });
  const later = day.plus({ days: 28 });
  for (const id of [near.id, far.id]) age(id);
  fakeCal.events.set(getBooking(near.id).calendar_ref, { start: Date.parse(at(day, '15:00')), end: Date.parse(at(day, '16:30')) });
  fakeCal.events.set(getBooking(far.id).calendar_ref, { start: Date.parse(at(later, '10:00')), end: Date.parse(at(later, '11:30')) });
  resetSent();

  const slots = await slotsOf(day);
  assert.equal(getBooking(near.id).start_utc, new Date(at(day, '15:00')).toISOString());
  assert.equal(getBooking(near.id).sequence, 1);
  assert.equal(getBooking(far.id).start_utc, new Date(at(later, '10:00')).toISOString());
  assert.equal(getBooking(far.id).status, 'confirmed');
  assert.ok(slots.includes(at(day, '09:00')) && slots.includes(at(day, '13:30')), 'anciens créneaux libérés');
  assert.ok(!slots.includes(at(day, '15:00')), 'nouvelle heure bloquée');

  const [toNear] = mailTo('julie@example.com');
  assert.equal(toNear.subject, 'Votre rendez-vous a été déplacé : Consultation de naturopathie');
  assert.match(toNear.attachments[0].content, /SEQUENCE:1/);
  assert.equal(mailTo('loin@example.com').length, 1);
  assert.match(mailTo(MARINE)[0].html, /Tu as déplacé le rendez-vous/);
  assert.equal(sent.pushes.length, 2);
});

test("synchro prudente : rien n'est annulé si l'agenda ne répond pas ou vient d'être modifié", async () => {
  const day = nextWorkday();
  const { body: fresh } = await book(at(day, '09:00'));
  const { body: old } = await book(at(day, '12:00'), { email: 'old@example.com' });
  age(old.id);
  fakeCal.events.clear(); // l'agenda semble vide
  resetSent();

  fakeCal.down = true; // iCloud injoignable : on ne touche à rien, et les créneaux restent calculés
  const slots = await slotsOf(day);
  assert.ok(!slots.includes(at(day, '09:00')) && !slots.includes(at(day, '12:00')), 'les rdv du site bloquent toujours');
  assert.equal(getBooking(old.id).status, 'confirmed');

  fakeCal.down = false; // de nouveau joignable : seul le rdv « ancien » est synchronisé
  await slotsOf(day);
  assert.equal(getBooking(fresh.id).status, 'confirmed', 'créé il y a moins de 10 min : on laisse le temps à iCloud');
  assert.equal(getBooking(old.id).status, 'cancelled');
  assert.equal(mailTo('julie@example.com').length, 0);
});

test("si la mise à jour de l'agenda a échoué, le site reste la référence pour ce rdv", async () => {
  const day = nextWorkday();
  const { body: b } = await book(at(day, '10:30'));
  resetSent();
  fakeCal.failWrites = true;
  const r = await api('POST', `/api/bookings/${b.id}/reschedule`, { t: b.token, start: at(day, '13:30') });
  assert.equal(r.status, 200);
  assert.equal(getBooking(b.id).calendar_dirty, 1);
  assert.match(mailTo(MARINE)[0].html, /n'a pas pu être mis à jour automatiquement/);
  fakeCal.failWrites = false;
  age(b.id);
  resetSent();

  // L'agenda a encore l'ancienne heure : ce n'est pas un déplacement fait par Marine.
  await slotsOf(day);
  assert.equal(getBooking(b.id).start_utc, new Date(at(day, '13:30')).toISOString());
  assert.equal(getBooking(b.id).status, 'confirmed');
  assert.equal(sent.mails.length, 0);
});

test('anti-abus : 10 réservations max par heure et par IP', async () => {
  const day = nextWorkday();
  for (let i = 0; i < 10; i++) {
    const r = await book(at(day, '10:30'), { name: '' }, { fromIp: '203.0.113.9' });
    assert.equal(r.status, 400);
  }
  const blocked = await api('POST', '/api/bookings', { eventType: CONSULT }, { fromIp: '203.0.113.9' });
  assert.equal(blocked.status, 429);
});
