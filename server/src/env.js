// Charge ~/marineambroselli-rdv/.env s'il existe (sans dépendance). Les variables déjà définies gagnent.
// Volontairement HORS du dossier du site : nginx sert /var/www/marineambroselli.com tel quel.
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const rdvHome = process.env.RDV_HOME || path.join(os.homedir(), 'marineambroselli-rdv');
const envPath = path.join(rdvHome, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
