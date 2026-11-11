// Liste d'attente Niki Coach : enregistrement, mail à la personne, mail et notif à Marine.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sent, resetSent, mailTo, startServer } from './helpers.js';

const MARINE = 'marine@example.com';
let srv;
let api;
before(async () => {
  srv = await startServer();
  api = srv.api;
});
after(() => srv.close());
beforeEach(resetSent);

test('inscription : mail de confirmation, mail à Marine (répondre = la personne) et notif', async () => {
  const r = await api('POST', '/api/niki/inscription', { email: ' Lea@Example.com ' });
  assert.equal(r.status, 201);
  assert.equal(r.body.already, false);

  const [conf] = mailTo('lea@example.com');
  assert.ok(conf, 'mail de confirmation');
  assert.equal(conf.replyTo, MARINE);
  assert.ok(conf.text.includes('Niki Coach'));

  const [host] = mailTo(MARINE);
  assert.ok(host, 'mail à Marine');
  assert.equal(host.replyTo, 'lea@example.com');
  assert.match(host.subject, /lea@example\.com/);
  assert.ok(host.text.includes('lea@example.com'));
  assert.deepEqual(host.headers['X-TM-TAGS'], ['niki-waitlist']);

  assert.equal(sent.pushes.length, 1);
});

test('inscription en double : rien de renvoyé', async () => {
  await api('POST', '/api/niki/inscription', { email: 'double@example.com' });
  resetSent();
  const r = await api('POST', '/api/niki/inscription', { email: 'DOUBLE@example.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, true);
  assert.equal(sent.mails.length, 0);
  assert.equal(sent.pushes.length, 0);
});

test('email invalide ou robot : refusé', async () => {
  assert.equal((await api('POST', '/api/niki/inscription', { email: 'pasbon' })).status, 400);
  assert.equal((await api('POST', '/api/niki/inscription', { email: 'a@b.fr', website: 'x' })).status, 400);
  assert.equal(sent.mails.length, 0);
});
