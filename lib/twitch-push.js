const webpush = require("web-push");

const CONFIG_ERROR_CODE = "TWITCH_PUSH_CONFIG_MISSING";

let vapidInitialized = false;

function readConfig() {
  return {
    publicKey: String(process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject:
      String(process.env.VAPID_SUBJECT || "mailto:admin@mirabellier.com").trim(),
  };
}

function hasConfig(config) {
  return Boolean(config.publicKey && config.privateKey);
}

function createConfigError() {
  const error = new Error(
    "Web Push config missing. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in mirabellier-backend/.env.",
  );
  error.code = CONFIG_ERROR_CODE;
  return error;
}

function ensureVapidDetails(config) {
  if (!vapidInitialized) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidInitialized = true;
  }
}

function buildLiveNotificationPayload(input) {
  return JSON.stringify({
    title: `${input.displayName} is live on Twitch`,
    body: input.gameName ? `playing ${input.gameName}` : "streaming right now",
    url: "https://mirabellier.com/twitch",
    login: input.login,
  });
}

async function sendLiveNotification(db, channelLogin, displayName, stream) {
  const config = readConfig();
  if (!hasConfig(config)) {
    return { ok: false, sent: 0, removed: 0, error: "not-configured" };
  }

  ensureVapidDetails(config);

  const subscriptions = db
    .prepare("SELECT * FROM twitch_push_subscriptions WHERE channelLogin = ?")
    .all(channelLogin);

  const payload = buildLiveNotificationPayload({
    login: channelLogin,
    displayName,
    gameName: stream?.gameName || "",
  });

  let sent = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
      );
      sent += 1;
    } catch (error) {
      const statusCode = Number(error?.statusCode);
      if (statusCode === 404 || statusCode === 410) {
        db.prepare("DELETE FROM twitch_push_subscriptions WHERE id = ?").run(
          subscription.id,
        );
        removed += 1;
      }
    }
  }

  return { ok: true, sent, removed };
}

module.exports = {
  CONFIG_ERROR_CODE,
  buildLiveNotificationPayload,
  createConfigError,
  hasConfig,
  readConfig,
  sendLiveNotification,
};
