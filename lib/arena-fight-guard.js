const WINDOWS = [
  { scope: "account", durationMs: 60_000, limit: 20 },
  { scope: "ip", durationMs: 60_000, limit: 20 },
];

const attemptsByKey = new Map();

function normalizeIp(req) {
  const cloudflareIp = String(req.headers?.["cf-connecting-ip"] || "").trim();
  return cloudflareIp || req.ip || req.socket?.remoteAddress || "unknown";
}

function pruneAttempts(now) {
  const longestWindow = Math.max(...WINDOWS.map((window) => window.durationMs));
  attemptsByKey.forEach((timestamps, key) => {
    const active = timestamps.filter((timestamp) => now - timestamp < longestWindow);
    if (active.length > 0) attemptsByKey.set(key, active);
    else attemptsByKey.delete(key);
  });
}

function checkWindow(key, durationMs, limit, now) {
  const timestamps = attemptsByKey.get(key) || [];
  const active = timestamps.filter((timestamp) => now - timestamp < durationMs);
  if (active.length < limit) return null;

  return Math.max(durationMs - (now - active[0]), 1000);
}

function checkArenaFightRateLimit(req, userId, now = Date.now()) {
  pruneAttempts(now);
  const identities = {
    account: String(userId || "unknown"),
    ip: normalizeIp(req),
  };

  for (const window of WINDOWS) {
    const identity = identities[window.scope];
    const key = `${window.scope}:${identity}`;
    const retryAfterMs = checkWindow(
      key,
      window.durationMs,
      window.limit,
      now,
    );
    if (retryAfterMs !== null) {
      return { allowed: false, retryAfterMs };
    }
  }

  for (const scope of ["account", "ip"]) {
    const key = `${scope}:${identities[scope]}`;
    const timestamps = attemptsByKey.get(key) || [];
    timestamps.push(now);
    attemptsByKey.set(key, timestamps);
  }

  return { allowed: true, retryAfterMs: 0 };
}

function resetArenaFightRateLimits() {
  attemptsByKey.clear();
}

module.exports = {
  checkArenaFightRateLimit,
  resetArenaFightRateLimits,
};
