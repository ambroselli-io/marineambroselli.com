import { config } from './config.js';
import { app } from './app.js';
import { version } from './version.js';

// En prod, HOST=127.0.0.1 (ecosystem.config.cjs) : seul nginx est exposé. En local : 0.0.0.0.
const host = process.env.HOST || '0.0.0.0';
app.listen(config.port, host, () => {
  console.log(`[rdv] API sur http://${host}:${config.port} (agenda : ${config.calendarProvider})`);
  console.log(`[rdv] commit ${version.commit} du ${version.commitDate}, démarrée le ${version.startedAt}`);
});
