// Envoie les notifications vers ton iPhone.
// Les clés viennent des secrets GitHub : PUSH_SUBSCRIPTION, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
const MAX_SEPARATE = 5;

function loadConfig() {
  const { PUSH_SUBSCRIPTION, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!PUSH_SUBSCRIPTION || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  const parsed = JSON.parse(PUSH_SUBSCRIPTION);
  return {
    subscriptions: Array.isArray(parsed) ? parsed : [parsed],
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT || 'https://github.com',
  };
}

export function messagesFor(offers) {
  if (offers.length > MAX_SEPARATE) {
    return [{ title: `${offers.length} nouvelles offres PM`, body: offers.slice(0, 3).map((o) => o.company).join(', ') + '…', url: './' }];
  }
  return offers.map((o) => ({
    title: `${o.company} recrute`,
    body: `${o.title} · ${o.cities.join(', ')}`,
    url: `./#/job/${encodeURIComponent(o.id)}`,
  }));
}

export async function send(messages) {
  const config = loadConfig();
  if (!config) {
    console.log('Notifications non configurées : aucun envoi.');
    return;
  }
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  for (const subscription of config.subscriptions) {
    for (const message of messages) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 86_400, urgency: 'high' });
      } catch (err) {
        console.error(`Notification refusée (${err.statusCode ?? err.message}). Si 404 ou 410, recopie ton code de notification depuis l'app.`);
      }
    }
  }
}

export async function notify(offers) {
  if (offers.length) await send(messagesFor(offers));
}
