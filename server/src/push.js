// Notifications push à Marine via l'API Expo (même mécanisme que l'appli Niki).
// EXPO_PUSH_TOKENS = un ou plusieurs ExponentPushToken[...] séparés par des virgules.
const tokens = () =>
  (process.env.EXPO_PUSH_TOKENS ?? 'ExponentPushToken[REMOVED]') // téléphone de Marine (appli Niki)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

export async function pushToHost({ title, body, url }) {
  const to = tokens();
  if (!to.length) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(to.map((t) => ({ to: t, title, body, sound: 'default', data: { url } }))),
    });
    const json = await res.json().catch(() => null);
    const errors = (json?.data || []).filter((d) => d.status === 'error');
    if (!res.ok || errors.length) console.error('[push]', res.status, JSON.stringify(errors.length ? errors : json));
  } catch (e) {
    console.error('[push]', e.message);
  }
}
