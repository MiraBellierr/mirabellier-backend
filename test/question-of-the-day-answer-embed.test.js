const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAnswerImagePath,
  buildAnswerPageUrl,
  buildAnswerPreviewState,
  buildAnswerShareHtml,
  getAnswerPreviewDimensions,
  renderAnswerPreviewBuffer,
} = require("../lib/question-of-the-day-answer-embed");

const SAMPLE_ANSWER = {
  id: "1717171717171-ab12cd",
  answer: "A stranger held the door and wished me a good morning.",
  displayName: "mirabelle",
  avatar: "/images/avatars/mirabelle.webp",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("buildAnswerPreviewState normalizes a populated answer", () => {
  const state = buildAnswerPreviewState({ answer: SAMPLE_ANSWER });

  assert.equal(state.variant, "answer");
  assert.equal(state.id, SAMPLE_ANSWER.id);
  assert.equal(state.displayName, "mirabelle");
  assert.equal(state.answer, SAMPLE_ANSWER.answer);
  assert.equal(state.avatar, SAMPLE_ANSWER.avatar);
  assert.match(state.title, /mirabelle/);
  assert.ok(state.version && state.version.length === 12);
});

test("buildAnswerPreviewState carries no description field", () => {
  const state = buildAnswerPreviewState({ answer: SAMPLE_ANSWER });
  assert.equal(state.description, undefined);
});

test("buildAnswerPreviewState is deterministic for the same input", () => {
  const a = buildAnswerPreviewState({ answer: SAMPLE_ANSWER });
  const b = buildAnswerPreviewState({ answer: { ...SAMPLE_ANSWER } });

  assert.equal(a.version, b.version);
});

test("buildAnswerPreviewState version reacts to answer, name and avatar", () => {
  const base = buildAnswerPreviewState({ answer: SAMPLE_ANSWER });

  assert.notEqual(
    base.version,
    buildAnswerPreviewState({
      answer: { ...SAMPLE_ANSWER, answer: "Something else entirely." },
    }).version,
  );
  assert.notEqual(
    base.version,
    buildAnswerPreviewState({
      answer: { ...SAMPLE_ANSWER, displayName: "someone else" },
    }).version,
  );
  assert.notEqual(
    base.version,
    buildAnswerPreviewState({
      answer: { ...SAMPLE_ANSWER, avatar: "/images/avatars/other.webp" },
    }).version,
  );
});

test("buildAnswerPreviewState falls back to the missing variant", () => {
  assert.equal(buildAnswerPreviewState({ answer: null }).variant, "missing");
  assert.equal(buildAnswerPreviewState({}).variant, "missing");
  assert.equal(
    buildAnswerPreviewState({ answer: { ...SAMPLE_ANSWER, answer: "   " } })
      .variant,
    "missing",
  );
});

test("buildAnswerImagePath and buildAnswerPageUrl encode the id", () => {
  assert.equal(
    buildAnswerImagePath("a b/c", "v1"),
    "/question-of-the-day/answers/a%20b%2Fc/embed-image.png?v=v1",
  );
  assert.equal(
    buildAnswerPageUrl("https", "mirabellier.com", "abc"),
    "https://mirabellier.com/question-of-the-day/answers/abc",
  );
});

test("getAnswerPreviewDimensions is a 1.91:1 card", () => {
  assert.deepEqual(getAnswerPreviewDimensions(), { width: 1200, height: 630 });
});

test("buildAnswerShareHtml embeds the image but no description meta", () => {
  const state = buildAnswerPreviewState({ answer: SAMPLE_ANSWER });
  const html = buildAnswerShareHtml({
    state,
    protocol: "https",
    host: "mirabellier.com",
  });

  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/mirabellier\.com\/question-of-the-day\/answers\/1717171717171-ab12cd"/,
  );
  assert.match(
    html,
    new RegExp(
      `<meta property="og:image" content="https://mirabellier\\.com/question-of-the-day/answers/1717171717171-ab12cd/embed-image\\.png\\?v=${state.version}"`,
    ),
  );
  assert.match(html, /<meta property="og:image:width" content="1200"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(html, /og:description/);
  assert.doesNotMatch(html, /twitter:description/);
  assert.doesNotMatch(html, /<meta name="description"/);
  // The answer text must not appear as rendered body copy (only in JSON-LD).
  const body = html.slice(html.indexOf("<body"));
  assert.doesNotMatch(body, /held the door/);
});

test("renderAnswerPreviewBuffer produces a PNG for both variants", async () => {
  const answerBuffer = await renderAnswerPreviewBuffer(
    buildAnswerPreviewState({ answer: { ...SAMPLE_ANSWER, avatar: "" } }),
  );
  assert.ok(Buffer.isBuffer(answerBuffer));
  assert.ok(answerBuffer.length > 1000);
  assert.ok(answerBuffer.subarray(0, 4).equals(PNG_SIGNATURE));

  const missingBuffer = await renderAnswerPreviewBuffer(
    buildAnswerPreviewState({ answer: null }),
  );
  assert.ok(missingBuffer.subarray(0, 4).equals(PNG_SIGNATURE));
});

test("renderAnswerPreviewBuffer tolerates an unresolvable avatar path", async () => {
  const buffer = await renderAnswerPreviewBuffer(
    buildAnswerPreviewState({
      answer: { ...SAMPLE_ANSWER, avatar: "/images/nope/missing.webp" },
    }),
    { imagesDir: "/tmp/definitely-not-here" },
  );
  assert.ok(buffer.subarray(0, 4).equals(PNG_SIGNATURE));
});

test("renderAnswerPreviewBuffer handles very long answers without throwing", async () => {
  const buffer = await renderAnswerPreviewBuffer(
    buildAnswerPreviewState({
      answer: { ...SAMPLE_ANSWER, answer: "word ".repeat(400).trim() },
    }),
  );
  assert.ok(buffer.subarray(0, 4).equals(PNG_SIGNATURE));
});
