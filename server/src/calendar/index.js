import { config } from '../config.js';
import * as google from './google.js';
import * as caldav from './caldav.js';

/**
 * Interface commune :
 *   busy(start: Date, end: Date) -> [{ start: ms, end: ms, ref?: string, free?: boolean }]
 *     (tous les événements de la plage, y compris ceux marqués « disponible » avec free: true)
 *   create(booking, details) -> { ref, videoUrl? }
 *   update(booking, details) -> void
 *   remove(booking) -> void
 *   get(booking) -> { start: ms, end: ms } | null (supprimé) | undefined (inconnu) ; lève une erreur si l'agenda ne répond pas
 * details = { title, description, start: Date, end: Date, attendee: {name,email}, videoUrl }
 */
const none = {
  name: 'none',
  busy: async () => [],
  create: async () => ({ ref: null }),
  update: async () => {},
  remove: async () => {},
  get: async () => undefined,
};

const providers = { google, caldav, none };
export const calendar = providers[config.calendarProvider] || none;
if (!providers[config.calendarProvider]) console.warn(`[calendar] provider inconnu "${config.calendarProvider}", agenda désactivé`);
