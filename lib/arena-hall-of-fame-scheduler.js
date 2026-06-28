const { snapshotAndResetElo } = require("./arena/hall-of-fame");

let schedulerStarted = false;
let scheduledTimer = null;

function msUntilNextFirstOfMonth() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return next.getTime() - now.getTime();
}

function scheduleNextCheck(db) {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
  }

  const delay = msUntilNextFirstOfMonth();

  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    snapshotAndResetElo(db);
    scheduleNextCheck(db);
  }, delay);

  if (typeof scheduledTimer.unref === "function") {
    scheduledTimer.unref();
  }
}

function startHallOfFameScheduler(db) {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  scheduleNextCheck(db);
}

module.exports = { startHallOfFameScheduler };
