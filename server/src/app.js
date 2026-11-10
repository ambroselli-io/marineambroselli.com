import express from 'express';
import { config, getEventType } from './config.js';
import { getSlots } from './slots.js';
import { createBooking, authorize, publicView, cancelBooking, rescheduleBooking } from './bookings.js';
import { buildIcs } from './ics.js';
import { manageUrl } from './emails.js';

export const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Limite simple anti-abus : N requêtes d'écriture par IP et par heure.
const hits = new Map();
function rateLimit(max) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < 3600000);
    if (list.length >= max) return res.status(429).json({ error: 'Trop de tentatives, merci de réessayer plus tard.' });
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 6 * 3600000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true, calendar: config.calendarProvider }));

app.get('/api/event-types', (req, res) => {
  res.json({
    hostName: config.host.name,
    hostTimeZone: config.host.timeZone,
    eventTypes: config.eventTypes,
  });
});

app.get(
  '/api/slots',
  wrap(async (req, res) => {
    const type = getEventType(req.query.type);
    if (!type) return res.status(400).json({ error: 'Type de rendez-vous inconnu' });
    let excludeId = null;
    if (req.query.id) excludeId = authorize(req.query.id, req.query.t).b.id;
    const slots = await getSlots(type, String(req.query.from), String(req.query.to), { excludeId });
    res.json({ slots });
  })
);

app.post(
  '/api/bookings',
  rateLimit(10),
  wrap(async (req, res) => {
    if (req.body.website) return res.status(400).json({ error: 'Requête invalide' }); // pot de miel anti-robots
    res.status(201).json(await createBooking(req.body));
  })
);

app.get(
  '/api/bookings/:id',
  wrap(async (req, res) => {
    const { b, role } = authorize(req.params.id, req.query.t);
    res.json(publicView(b, role));
  })
);

app.post(
  '/api/bookings/:id/cancel',
  rateLimit(20),
  wrap(async (req, res) => res.json(await cancelBooking(req.params.id, req.body.t, req.body.reason)))
);

app.post(
  '/api/bookings/:id/reschedule',
  rateLimit(20),
  wrap(async (req, res) => res.json(await rescheduleBooking(req.params.id, req.body.t, req.body.start)))
);

app.get(
  '/api/bookings/:id/ics',
  wrap(async (req, res) => {
    const { b } = authorize(req.params.id, req.query.t);
    const type = getEventType(b.event_type);
    const ics = buildIcs({
      uid: `${b.id}@marineambroselli.com`,
      sequence: b.sequence,
      start: b.start_utc,
      end: b.end_utc,
      title: `${type.title} avec ${config.host.name}`,
      description: `Visio : ${b.video_url}\nModifier ou annuler : ${manageUrl(b, 'attendee')}`,
      location: b.video_url,
      url: b.video_url,
      method: 'PUBLISH',
      cancelled: b.status === 'cancelled',
    });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="rendez-vous.ics"');
    res.send(ics);
  })
);

// En local uniquement (SERVE_STATIC=1) : sert aussi le site statique. En prod, c'est nginx.
if (process.env.SERVE_STATIC) {
  const root = new URL('../../site/', import.meta.url).pathname;
  app.use(express.static(root, { extensions: ['html'], dotfiles: 'ignore' }));
}

app.use((req, res) => res.status(404).json({ error: 'Introuvable' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur serveur, merci de réessayer.' : err.message });
});
