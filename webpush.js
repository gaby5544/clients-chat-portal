// Web Push notifications (VAPID-based — no third-party push service, no
// per-message cost). Works for desktop Chrome/Firefox/Edge and Android
// Chrome even when the browser is fully closed. iOS Safari only supports
// web push for sites added to the Home Screen (iOS 16.4+) — that's an
// Apple platform restriction, not something any web app can bypass.

const webpush = require('web-push');
const { store } = require('./db');

let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  console.warn(
    '[push] No VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set — generated temporary keys for this boot only.\n' +
    '[push] Every restart will invalidate existing push subscriptions until you set these permanently:\n' +
    `[push]   VAPID_PUBLIC_KEY=${vapidKeys.publicKey}\n` +
    `[push]   VAPID_PRIVATE_KEY=${vapidKeys.privateKey}\n` +
    '[push] Copy both into your Render environment variables.'
  );
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function getPublicKey() {
  return vapidKeys.publicKey;
}

async function sendPushToUser(sessionToken, { title, body, url }) {
  const subs = await store.getPushSubscriptionsForUser(sessionToken);
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, url: url || '/' });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      // 404/410 means the subscription is gone (user revoked permission,
      // uninstalled, etc.) — clean it up rather than retry forever.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await store.removePushSubscription(sub.endpoint);
      } else {
        console.error('[push] send failed:', err.message);
      }
    }
  }));
}

module.exports = { getPublicKey, sendPushToUser };
