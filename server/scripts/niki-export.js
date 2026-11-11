// Affiche la liste d'attente Niki Coach en CSV : `npm run niki-export > inscrites.csv` (sur le serveur).
import '../src/env.js';
import { db } from '../src/db.js';
import '../src/niki.js';

console.log('email,inscrite_le');
for (const r of db.prepare('SELECT email, created_at FROM niki_waitlist ORDER BY created_at').all()) {
  console.log(`${r.email},${r.created_at}`);
}
