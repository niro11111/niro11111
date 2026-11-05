// Mobile push through Expo's push service (works for iOS APNs and Android FCM once the app
// is built with EAS and the user grants notification permission).
export function expoPushSender(store, fetchImpl = globalThis.fetch) {
  return async ({ title, body, priority }) => {
    const tokens = store.all('devices', (d) => !d.revoked && d.pushToken && ['ios', 'android', 'watchos', 'wearos'].includes(d.kind)).map((d) => d.pushToken);
    if (!tokens.length) throw new Error('no registered push tokens');
    const r = await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, priority: priority === 'high' || priority === 'critical' ? 'high' : 'default', sound: priority === 'critical' ? 'default' : undefined }))),
    });
    if (!r.ok) throw new Error(`expo push ${r.status}`);
    return r.json();
  };
}
