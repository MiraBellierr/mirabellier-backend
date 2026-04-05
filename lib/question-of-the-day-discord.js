const http = require("http");
const https = require("https");

const DEFAULT_WEBSITE_BASE = "https://mirabellier.com";
const DEFAULT_WEBHOOK_USERNAME = "Mirabellier QOTD";
const CHECK_INTERVAL_MS = 60 * 1000;
const DISCORD_EMBED_COLOR = 16738740;

let schedulerStarted = false;
let scheduledCheckTimer = null;
let inFlightNotificationCheck = null;

function getWebsiteBase() {
  return String(process.env.WEBSITE_BASE || DEFAULT_WEBSITE_BASE)
    .trim()
    .replace(/\/+$/, "");
}

function getDiscordWebhookUrl() {
  return String(process.env.QOTD_DISCORD_WEBHOOK_URL || "").trim();
}

function getDiscordWebhookUsername() {
  return String(
    process.env.QOTD_DISCORD_WEBHOOK_USERNAME || DEFAULT_WEBHOOK_USERNAME,
  ).trim();
}

function getDiscordWebhookAvatarUrl() {
  return String(process.env.QOTD_DISCORD_WEBHOOK_AVATAR_URL || "").trim();
}

function isDiscordWebhookEnabled() {
  return Boolean(getDiscordWebhookUrl());
}

function getCurrentRecordedDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function postJson(urlString, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const body = JSON.stringify(payload);
    const transport = target.protocol === "http:" ? http : https;

    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        method: "POST",
        path: `${target.pathname}${target.search}`,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseBody = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ statusCode, body: responseBody });
            return;
          }

          reject(
            new Error(
              `Discord webhook request failed (${statusCode}): ${responseBody.slice(0, 300)}`,
            ),
          );
        });
      },
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error("Discord webhook request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function buildQuestionPageUrl() {
  return `${getWebsiteBase()}/question-of-the-day`;
}

function buildWebhookPayload(question, currentRecordedDate) {
  const questionUrl = buildQuestionPageUrl();
  const footerText =
    question.recordedDate === currentRecordedDate
      ? "Fresh drop"
      : `Carried forward from ${question.recordedDate} and now live`;
  const payload = {
    content: "A new Question of the Day just dropped.",
    allowed_mentions: {
      parse: [],
    },
    embeds: [
      {
        title: "New Question of the Day",
        url: questionUrl,
        description: question.prompt,
        color: DISCORD_EMBED_COLOR,
        fields: [
          {
            name: "Recorded date",
            value: question.recordedDate,
            inline: true,
          },
          {
            name: "Open",
            value: `[Answer on Mirabellier.com](${questionUrl})`,
            inline: true,
          },
        ],
        footer: {
          text: footerText,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const username = getDiscordWebhookUsername();
  if (username) {
    payload.username = username;
  }

  const avatarUrl = getDiscordWebhookAvatarUrl();
  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  return payload;
}

function createNotifier(db) {
  const selectQuestionByRecordedDate = db.prepare(
    `SELECT recordedDate, prompt, archivedAt, createdAt, updatedAt, discordNotifiedAt
     FROM daily_questions
     WHERE recordedDate = ?`,
  );
  const selectEarliestUnansweredQuestionThroughRecordedDate = db.prepare(
    `SELECT
       q.recordedDate,
       q.prompt,
       q.archivedAt,
       q.createdAt,
       q.updatedAt,
       q.discordNotifiedAt
     FROM daily_questions q
     LEFT JOIN daily_question_answers a ON a.recordedDate = q.recordedDate
     WHERE q.recordedDate <= ? AND q.archivedAt IS NULL
     GROUP BY q.recordedDate, q.prompt, q.archivedAt, q.createdAt, q.updatedAt, q.discordNotifiedAt
     HAVING COUNT(a.id) = 0
     ORDER BY q.recordedDate ASC
     LIMIT 1`,
  );
  const markQuestionAsDiscordNotified = db.prepare(
    `UPDATE daily_questions
     SET discordNotifiedAt = COALESCE(discordNotifiedAt, ?)
     WHERE recordedDate = ?`,
  );

  function getActiveQuestionRow(currentRecordedDate) {
    const todaysQuestion = selectQuestionByRecordedDate.get(currentRecordedDate);

    return (
      selectEarliestUnansweredQuestionThroughRecordedDate.get(
        currentRecordedDate,
      ) || (todaysQuestion && !todaysQuestion.archivedAt ? todaysQuestion : null)
    );
  }

  return {
    getActiveQuestionRow,
    markQuestionAsDiscordNotified,
  };
}

function maybeNotifyNewQuestionOfTheDayDrop(db, options = {}) {
  if (inFlightNotificationCheck) {
    return inFlightNotificationCheck;
  }

  inFlightNotificationCheck = Promise.resolve()
    .then(async () => {
      if (!isDiscordWebhookEnabled()) {
        return {
          skipped: true,
          reason: "QOTD_DISCORD_WEBHOOK_URL is not configured",
        };
      }

      const notifier = createNotifier(db);
      const currentRecordedDate = getCurrentRecordedDate(options.now);
      const activeQuestion = notifier.getActiveQuestionRow(currentRecordedDate);

      if (!activeQuestion) {
        return { skipped: true, reason: "no active question" };
      }

      if (activeQuestion.discordNotifiedAt) {
        return {
          skipped: true,
          reason: "already notified",
          recordedDate: activeQuestion.recordedDate,
        };
      }

      await postJson(
        getDiscordWebhookUrl(),
        buildWebhookPayload(activeQuestion, currentRecordedDate),
      );

      const notifiedAt = new Date().toISOString();
      notifier.markQuestionAsDiscordNotified.run(
        notifiedAt,
        activeQuestion.recordedDate,
      );

      console.log(
        `[qotd-discord] Sent Discord notification for ${activeQuestion.recordedDate}`,
      );

      return {
        ok: true,
        recordedDate: activeQuestion.recordedDate,
        notifiedAt,
      };
    })
    .catch((error) => {
      const message =
        error instanceof Error ? error.message : "Unknown Discord webhook error";
      console.warn(`[qotd-discord] ${message}`);
      return { ok: false, error: message };
    })
    .finally(() => {
      inFlightNotificationCheck = null;
    });

  return inFlightNotificationCheck;
}

function scheduleNextCheck(db) {
  if (scheduledCheckTimer) {
    clearTimeout(scheduledCheckTimer);
  }

  scheduledCheckTimer = setTimeout(async () => {
    scheduledCheckTimer = null;
    scheduleNextCheck(db);
    await maybeNotifyNewQuestionOfTheDayDrop(db);
  }, CHECK_INTERVAL_MS);

  if (typeof scheduledCheckTimer.unref === "function") {
    scheduledCheckTimer.unref();
  }
}

function startQuestionOfTheDayDiscordScheduler(db) {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  scheduleNextCheck(db);
  void maybeNotifyNewQuestionOfTheDayDrop(db);
}

module.exports = {
  buildQuestionPageUrl,
  getDiscordWebhookUrl,
  isDiscordWebhookEnabled,
  maybeNotifyNewQuestionOfTheDayDrop,
  startQuestionOfTheDayDiscordScheduler,
};
