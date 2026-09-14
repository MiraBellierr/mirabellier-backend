const test = require("node:test");
const assert = require("node:assert/strict");

const { collectSitemapEntries } = require("../lib/sitemap");

// The archive block in `collectSitemapEntries` must use the same cutoff as the
// public archive route (`getArchiveCutoffRecordedDate`): the active carried
// question, not today. Using today published URLs whose route 404s and leaked
// queued prompts (the live sitemap carried 94 such soft-404s).
function fakeDb({ activeRecordedDate = "2026-06-12", archiveRows = [] } = {}) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      return {
        all(...args) {
          calls.push({ sql, args });
          if (/FROM daily_questions/.test(sql)) return archiveRows;
          if (/FROM posts/.test(sql)) return [];
          return [];
        },
        get(...args) {
          calls.push({ sql, args });
          if (/FROM daily_questions/.test(sql)) {
            return activeRecordedDate === null
              ? undefined
              : { recordedDate: activeRecordedDate };
          }
          return undefined;
        },
      };
    },
  };
}

test("archive URLs use the active question as the cutoff", () => {
  const db = fakeDb({
    activeRecordedDate: "2026-06-12",
    archiveRows: [
      { recordedDate: "2026-06-11", createdAt: "2026-06-11T00:00:00.000Z" },
      { recordedDate: "2026-06-10", createdAt: "2026-06-10T00:00:00.000Z" },
    ],
  });

  collectSitemapEntries(db);

  const archiveCall = db.calls.find((call) =>
    /FROM daily_questions[\s\S]*recordedDate < \?/.test(call.sql),
  );
  assert.ok(archiveCall, "expected an archive query with a cutoff");
  assert.equal(archiveCall.args[0], "2026-06-12");
});

test("archive URLs fall back to today when no question is active", () => {
  const db = fakeDb({ activeRecordedDate: null, archiveRows: [] });

  collectSitemapEntries(db);

  const archiveCall = db.calls.find((call) =>
    /FROM daily_questions[\s\S]*recordedDate < \?/.test(call.sql),
  );
  assert.ok(archiveCall, "expected an archive query with a cutoff");
  assert.equal(archiveCall.args[0], new Date().toISOString().slice(0, 10));
});

test("archive URLs are emitted with the question priority and changefreq", () => {
  const db = fakeDb({
    activeRecordedDate: "2026-06-12",
    archiveRows: [
      { recordedDate: "2026-06-11", createdAt: "2026-06-11T00:00:00.000Z" },
    ],
  });

  const entries = collectSitemapEntries(db);
  const archiveEntry = entries.find((entry) =>
    entry.url.endsWith("/question-of-the-day/archive/2026-06-11"),
  );

  assert.ok(archiveEntry, "expected the archived day to be listed");
  assert.equal(archiveEntry.priority, "0.6");
  assert.equal(archiveEntry.changefreq, "monthly");
  assert.equal(archiveEntry.lastmod, "2026-06-11");
});

test("no archive entries are listed when the archive is empty", () => {
  const db = fakeDb({ activeRecordedDate: "2026-06-12", archiveRows: [] });

  const entries = collectSitemapEntries(db);
  assert.equal(
    entries.filter((entry) => entry.url.includes("/question-of-the-day/archive/"))
      .length,
    0,
  );
});
