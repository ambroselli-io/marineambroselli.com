// Test de bout en bout dans un vrai navigateur (Chromium via Playwright) : le site statique et l'API tournent
// ensemble comme en prod, avec mails, notifs et agenda simulés. Parcours d'une cliente : réserver, puis
// depuis le lien du mail, déplacer, puis annuler. Et la vue de Marine depuis son propre lien.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sent, resetSent, mailTo, fakeCal, installFakeCalendar, startServer } from '../helpers.js';

process.env.SERVE_STATIC = '1';
const { getBooking } = await import('../../src/db.js');
await installFakeCalendar();

let srv;
let browser;
let page;
const pageErrors = [];

before(async () => {
  srv = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage({ locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.setDefaultTimeout(10000);
});
after(async () => {
  await browser?.close();
  await srv?.close();
});

// Choisit le premier jour ouvert du calendrier (mois suivant si le mois en cours est complet), puis un créneau.
async function pickSlot(index = 0) {
  await page.locator('.loading').waitFor({ state: 'detached' });
  if ((await page.locator('.cal__day--open').count()) === 0) {
    await page.getByRole('button', { name: 'Mois suivant' }).click();
    await page.locator('.loading').waitFor({ state: 'detached' });
  }
  const slots = page.locator('.slot');
  await slots.first().waitFor();
  const label = await slots.nth(index).textContent();
  await slots.nth(index).click();
  return label;
}

test("page d'accueil : le bouton de réservation mène à /rdv/", async () => {
  await page.goto(srv.base + '/');
  assert.ok((await page.locator('a[href="/rdv/"]').count()) > 0);
  assert.deepEqual(pageErrors, []);
});

test('une cliente réserve, déplace puis annule son rdv depuis le site', async () => {
  resetSent();
  // 1. Réservation
  await page.goto(srv.base + '/rdv/');
  await page.getByRole('button', { name: /Consultation de naturopathie/ }).click();
  await page.getByText('Choisissez un créneau').waitFor();
  assert.equal(await page.locator('.tz select').inputValue(), 'Europe/Paris', 'heures affichées en heure de Paris');
  const first = await pickSlot(0);

  await page.getByText(new RegExp(`${first.replace(':', '\\:')} –`)).waitFor();
  await page.getByLabel('Votre nom *').fill('Camille E2E');
  await page.getByLabel('Votre adresse email *').fill('camille@example.com');
  await page.getByLabel('Téléphone (facultatif)').fill('06 11 22 33 44');
  await page.getByLabel(/Accompagnement sur 5 mois/).check();
  await page.getByLabel(/Motif du rendez-vous/).fill('Digestion');
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
  await page.getByText('Rendez-vous confirmé').waitFor();
  assert.ok(await page.getByText('camille@example.com').isVisible());

  assert.equal(mailTo('camille@example.com').length, 1, 'mail de confirmation à la cliente');
  assert.equal(mailTo('marine@example.com').length, 1, 'mail à Marine');
  assert.equal(sent.pushes.length, 1, 'notif à Marine');
  const id = new URL(await page.getByRole('link', { name: 'Modifier ou annuler' }).getAttribute('href'), srv.base).searchParams.get('id');
  const b = getBooking(id);
  assert.equal(b.name, 'Camille E2E');
  assert.equal(b.option, 'Accompagnement sur 5 mois (3 consultations + suivi WhatsApp, 195 €)');
  assert.equal(b.notes, 'Digestion');
  assert.equal(b.time_zone, 'Europe/Paris');
  assert.ok(fakeCal.events.has(b.calendar_ref), "ajouté à l'agenda de Marine");

  // Le fichier .ics se télécharge
  const ics = await page.request.get(srv.base + (await page.getByRole('link', { name: 'Ajouter à mon agenda' }).getAttribute('href')));
  assert.match(await ics.text(), /BEGIN:VCALENDAR/);

  // 2. Déplacement depuis le lien « Modifier ou annuler »
  resetSent();
  await page.getByRole('link', { name: 'Modifier ou annuler' }).click();
  await page.getByRole('button', { name: 'Déplacer' }).click();
  await page.getByText('Choisissez un nouveau créneau').waitFor();
  await pickSlot(1);
  await page.getByRole('button', { name: 'Confirmer le nouveau créneau' }).click();
  await page.getByText('Le rendez-vous a bien été déplacé').waitFor();
  const moved = getBooking(id);
  assert.notEqual(moved.start_utc, b.start_utc);
  assert.equal(moved.sequence, 1);
  assert.equal(mailTo('camille@example.com')[0].subject, 'Votre rendez-vous a été déplacé : Consultation de naturopathie');
  assert.equal(fakeCal.events.get(b.calendar_ref).start, Date.parse(moved.start_utc), 'agenda de Marine mis à jour');

  // 3. Annulation
  resetSent();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.getByLabel('Motif de l’annulation (facultatif)').fill('Imprévu');
  await page.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await page.getByText('Ce rendez-vous a été annulé. Motif : Imprévu').waitFor();
  assert.equal(getBooking(id).status, 'cancelled');
  assert.match(mailTo('camille@example.com')[0].html, /Motif : Imprévu/);
  assert.ok(!fakeCal.events.has(b.calendar_ref), "retiré de l'agenda de Marine");
  assert.ok(await page.getByRole('link', { name: 'Reprendre un rendez-vous' }).isVisible());

  assert.deepEqual(pageErrors, []);
});

test('Marine ouvre son lien : elle voit le téléphone et l’heure de Grèce, et peut annuler', async () => {
  resetSent();
  await page.goto(srv.base + '/rdv/?type=30min');
  await pickSlot(0);
  await page.getByLabel('Votre nom *').fill('Léa E2E');
  await page.getByLabel('Votre adresse email *').fill('lea@example.com');
  await page.getByLabel('Téléphone (facultatif)').fill('06 55 44 33 22');
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
  await page.getByText('Rendez-vous confirmé').waitFor();
  const id = new URL(await page.getByRole('link', { name: 'Modifier ou annuler' }).getAttribute('href'), srv.base).searchParams.get('id');

  await page.goto(`${srv.base}/rdv/gerer.html?id=${id}&t=${getBooking(id).host_token}`);
  await page.getByText('Heure de Grèce').waitFor();
  assert.ok(await page.getByText(/06 55 44 33 22/).isVisible());
  resetSent();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.getByLabel(/Motif \(sera envoyé à Léa E2E/).fill('Indisponible');
  await page.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await page.getByText('Ce rendez-vous a été annulé. Motif : Indisponible').waitFor();
  assert.match(mailTo('lea@example.com')[0].html, /Marine Ambroselli a annulé le rendez-vous/);

  // Un lien invalide n'affiche rien
  await page.goto(`${srv.base}/rdv/gerer.html?id=${id}&t=faux`);
  await page.getByText('Rendez-vous introuvable').waitFor();
  assert.deepEqual(pageErrors, []);
});
