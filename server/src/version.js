// Commit déployé (lu une fois au démarrage) : affiché dans les logs pm2, /api/health et la console du site.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'inconnu';
  }
};
const fmt = (d) =>
  new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Athens', dateStyle: 'short', timeStyle: 'medium' }) + ' (heure de Grèce)';

export const version = {
  commit: git('rev-parse --short HEAD'),
  commitDate: (() => {
    const iso = git('log -1 --format=%cI');
    return iso === 'inconnu' ? iso : fmt(iso);
  })(),
  startedAt: fmt(Date.now()),
};
