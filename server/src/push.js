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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Requis si « Enhanced security for push notifications » est activé sur le projet Expo
        ...(process.env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }),
      },
      body: JSON.stringify(to.map((t) => ({ to: t, title, body, sound: 'default', data: { url } }))),
    });
    const json = await res.json().catch(() => null);
    const errors = (json?.data || []).filter((d) => d.status === 'error');
    if (!res.ok || errors.length) console.error('[push] échec', res.status, JSON.stringify(errors.length ? errors : json));
    else console.log('[push] envoyé', JSON.stringify(json?.data));
  } catch (e) {
    console.error('[push]', e.message);
  }
}
