const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkArenaFightRateLimit,
  resetArenaFightRateLimits,
} = require("../lib/arena-fight-guard");

function request(ip) {
  return {
    headers: { "cf-connecting-ip": ip },
    ip,
    socket: { remoteAddress: ip },
  };
}

test("Arena fight guard limits rapid attempts per account", () => {
  resetArenaFightRateLimits();
  const req = request("203.0.113.20");
  const now = Date.now();

  for (let index = 0; index < 8; index += 1) {
    assert.equal(
      checkArenaFightRateLimit(req, "user-1", now + index).allowed,
      true,
    );
  }

  const blocked = checkArenaFightRateLimit(req, "user-1", now + 9);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("Arena fight guard also limits shared source IP abuse", () => {
  resetArenaFightRateLimits();
  const req = request("203.0.113.21");
  const now = Date.now();

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      checkArenaFightRateLimit(req, `user-${index}`, now + index).allowed,
      true,
    );
  }

  assert.equal(
    checkArenaFightRateLimit(req, "user-21", now + 21).allowed,
    false,
  );
});
