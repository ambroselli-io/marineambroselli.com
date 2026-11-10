import { config } from './config.js';
import { app } from './app.js';

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[rdv] API sur http://127.0.0.1:${config.port} (agenda : ${config.calendarProvider})`);
});
