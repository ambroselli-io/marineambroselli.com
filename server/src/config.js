import { rdvHome } from './env.js';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3210),
  siteUrl: (env.SITE_URL || 'https://marineambroselli.com').replace(/\/$/, ''),
  dataDir: env.DATA_DIR || path.join(rdvHome, 'data'),

  host: {
    name: env.HOST_NAME || 'Marine Ambroselli',
    email: env.HOST_EMAIL || 'marine@example.com',
    phone: env.HOST_PHONE || 'XX XX XX XX XX',
    // Marine habite en Grèce : ses heures de travail ci-dessous sont en heure d'Athènes.
    // Les clientes, elles, voient les horaires en heure de Paris par défaut.
    timeZone: env.HOST_TIMEZONE || 'Europe/Athens',
  },

  mail: {
    // Tipimail : https://docs.tipimail.com/fr/integrate/api/messages
    apiUser: env.TIPIMAIL_API_USER || '',
    apiKey: env.TIPIMAIL_API_KEY || '',
    from: env.MAIL_FROM || 'rdv@marineambroselli.com',
    fromName: env.MAIL_FROM_NAME || 'Marine Ambroselli',
  },

  // 'google' | 'caldav' | 'none'
  calendarProvider: env.CALENDAR_PROVIDER || 'none',
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
  },
  caldav: {
    url: env.CALDAV_URL || 'https://caldav.icloud.com',
    username: env.CALDAV_USERNAME || '',
    password: env.CALDAV_PASSWORD || '', // iCloud : mot de passe pour app (appleid.apple.com)
    calendarName: env.CALDAV_CALENDAR_NAME || '', // vide = premier calendrier
  },

  // Lien visio. Salle Jitsi fixe de Marine par défaut. Peut contenir {id} (identifiant unique du rdv).
  videoUrlTemplate: env.VIDEO_URL_TEMPLATE || 'https://meet.jit.si/marineambroselli',
  // Avec CALENDAR_PROVIDER=google, GOOGLE_MEET=1 remplace ce lien par un Google Meet par rdv.
  googleMeet: env.GOOGLE_MEET === '1',

  booking: {
    minNoticeMinutes: Number(env.MIN_NOTICE_MINUTES || 120),
    horizonDays: Number(env.HORIZON_DAYS || 60),
    bufferMinutes: Number(env.BUFFER_MINUTES || 0),
    // Heures de travail, dans host.timeZone. 1 = lundi … 7 = dimanche.
    // Surchargeable via WEEKLY_HOURS='{"1":[["09:00","12:00"],["14:00","18:00"]],...}'
    weeklyHours: env.WEEKLY_HOURS
      ? JSON.parse(env.WEEKLY_HOURS)
      : {
          1: [['09:00', '17:00']],
          2: [['09:00', '17:00']],
          3: [['09:00', '17:00']],
          4: [['09:00', '17:00']],
          5: [['09:00', '17:00']],
        },
  },

  eventTypes: [
    {
      slug: 'consultation-de-naturopathie',
      title: 'Consultation de naturopathie',
      subtitle: "Bilan de Vitalité et Programme d'Hygiène Vitale (90 min)",
      duration: 90,
      description: [
        "Ensemble, nous construisons un programme d'hygiène vitale autour de quatre piliers : l'alimentation, la gestion du stress, le mouvement et le sommeil.",
        'Consultation unique : 80 €',
        'Accompagnement sur 5 mois : 3 consultations + suivi WhatsApp, à 65 € la consultation (195 € au total).',
        'Si vous le souhaitez, vous pouvez m\'indiquer en amont le ou les motifs de votre réservation. Pour toute question, je suis joignable au XX XX XX XX XX (appel ou WhatsApp).',
      ],
      options: {
        name: 'formule',
        label: 'Formule',
        choices: [
          'Consultation unique (80 €)',
          'Accompagnement sur 5 mois (3 consultations + suivi WhatsApp, 195 €)',
        ],
      },
    },
    {
      slug: '30min',
      title: 'Rendez-vous de 30 min',
      subtitle: 'Échange en visio (30 min)',
      duration: 30,
      description: ['Un échange de 30 minutes en visio avec Marine Ambroselli.'],
    },
  ],
};

export function getEventType(slug) {
  return config.eventTypes.find((t) => t.slug === slug);
}
