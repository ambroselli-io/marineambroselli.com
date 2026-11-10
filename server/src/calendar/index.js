import { config } from '../config.js';
import * as google from './google.js';
import * as caldav from './caldav.js';

/**
 * Interface commune :
 *   busy(start: Date, end: Date) -> [{ start: ms, end: ms, ref?: string }]
 *   create(booking, details) -> { ref, videoUrl? }
 *   update(booking, details) -> void
 *   remove(booking) -> void
 * details = { title, description, start: Date, end: Date, attendee: {name,email}, videoUrl }
 */
const none = {
  name: 'none',
  busy: async () => [],
  create: async () => ({ ref: null }),
  update: async () => {},
  remove: async () => {},
};

const providers = { google, caldav, none };
export const calendar = providers[config.calendarProvider] || none;
if (!providers[config.calendarProvider]) console.warn(`[calendar] provider inconnu "${config.calendarProvider}", agenda désactivé`);
