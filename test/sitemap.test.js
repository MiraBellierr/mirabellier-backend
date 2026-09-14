const test = require("node:test");
const assert = require("node:assert/strict");

const { collectSitemapEntries } = require("../lib/sitemap");

// The archive block in `collectSitemapEntries` must use the same cutoff as the
// public archive route (`getArchiveCutoffRecordedDate`): the active carried
// question, not today. Using today published URLs whose route 404s and leaked
// queued prompts (the live sitemap carried 94 such soft-404s).
function fakeDb({
  activeRecordedDate = "2026-06-12",
  archiveRows = [],
  postRows = [],
  shrineRows = [],
} = {}) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      return {
        all(...args) {
          calls.push({ sql, args });
          if (/FROM daily_questions/.test(sql)) return archiveRows;
          if (/FROM posts/.test(sql)) return postRows;
          if (/FROM shrine_pages/.test(sql)) return shrineRows;
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

test("/home is not listed (it is a client-side alias of /)", () => {
  const entries = collectSitemapEntries(fakeDb());
  assert.equal(
    entries.some((entry) => entry.url === "https://mirabellier.com/home"),
    false,
  );
  assert.equal(
    entries.some((entry) => entry.url === "https://mirabellier.com/"),
    true,
  );
});

test("posts carry an image entry when they have a thumbnail", () => {
  const db = fakeDb({
    postRows: [
      {
        id: "1",
        title: "With thumbnail",
        thumbnail: "/images/hero.png",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        title: "Without thumbnail",
        thumbnail: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  });

  const entries = collectSitemapEntries(db);
  const withImage = entries.find((entry) => entry.url.endsWith("/blog/with-thumbnail-1"));
  const withoutImage = entries.find((entry) =>
    entry.url.endsWith("/blog/without-thumbnail-2"),
  );

  assert.ok(withImage, "expected the post URL to use the canonical slug shape");
  assert.deepEqual(withImage.images, [
    { url: "https://mirabellier.com/images/hero.png", title: "With thumbnail" },
  ]);
  assert.equal(withoutImage.images, undefined);
});

test("blog slugs match the canonical NFKD + 80-char shape", () => {
  // 100+ characters, accented — the naive slugifier used here previously kept
  // the accents and an unbounded length, so the sitemap URL disagreed with the
  // page's own canonical.
  const longTitle =
    "Café Naïve — Ünicode Résumé " + "a".repeat(100);
  const db = fakeDb({
    postRows: [
      { id: "9", title: longTitle, thumbnail: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  });

  const entries = collectSitemapEntries(db);
  const post = entries.find((entry) => entry.url.includes("-9"));

  assert.ok(post, "expected a post entry");
  assert.match(post.url, /^https:\/\/mirabellier\.com\/blog\/[a-z0-9-]+-9$/);
  const slug = post.url.replace("https://mirabellier.com/blog/", "").replace(/-9$/, "");
  assert.ok(slug.length <= 80, `slug should be capped at 80 chars, got ${slug.length}`);
  assert.ok(!/[^\x00-\x7F]/.test(slug), "slug should be ASCII");
});

test("built-in and database shrines are merged, database winning on a path", () => {
  const db = fakeDb({
    shrineRows: [
      {
        path: "/shrine/kanna",
        title: "Kanna (owner edit)",
        image: "https://cdn.example/edited.jpg",
        priority: "0.9",
        changefreq: "weekly",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        path: "/shrine/kana",
        title: "Arima Kana",
        image: null,
        priority: "0.7",
        changefreq: "monthly",
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    ],
  });

  const entries = collectSitemapEntries(db);
  const shrines = entries.filter((entry) => entry.url.includes("/shrine/"));
  const urls = shrines.map((entry) => entry.url);

  // Built-in rossina survives alongside the two database rooms...
  assert.ok(urls.includes("https://mirabellier.com/shrine/rossina"));
  assert.ok(urls.includes("https://mirabellier.com/shrine/kana"));
  // ...and the duplicate kanna path is deduped, with the DB row's values.
  assert.equal(urls.filter((url) => url.endsWith("/shrine/kanna")).length, 1);
  const kanna = shrines.find((entry) => entry.url.endsWith("/shrine/kanna"));
  assert.equal(kanna.priority, "0.9");
  assert.equal(kanna.changefreq, "weekly");
  assert.equal(kanna.lastmod, "2026-05-01");
  assert.deepEqual(kanna.images, [
    { url: "https://cdn.example/edited.jpg", title: "Kanna (owner edit)" },
  ]);
});

test("shrine art is added as a sitemap image when present", () => {
  const db = fakeDb({
    shrineRows: [
      {
        path: "/shrine/kana",
        title: "Arima Kana",
        image: "https://i.pinimg.com/kana.jpg",
        priority: "0.7",
        changefreq: "monthly",
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    ],
  });

  const entries = collectSitemapEntries(db);
  const kana = entries.find((entry) => entry.url.endsWith("/shrine/kana"));

  assert.deepEqual(kana.images, [
    { url: "https://i.pinimg.com/kana.jpg", title: "Arima Kana" },
  ]);
});
