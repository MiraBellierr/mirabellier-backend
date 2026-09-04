const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPlatform,
  canonicalizeYouTubeUrl,
  canonicalizeInstagramUrl,
  extractHashtags,
  stripHashtags,
  mimeTypeForFile,
  mapYtDlpInfo,
} = require("../lib/social");

test("classifyPlatform detects each supported platform", () => {
  assert.equal(
    classifyPlatform("https://www.tiktok.com/@a/video/123"),
    "tiktok",
  );
  assert.equal(classifyPlatform("https://vm.tiktok.com/ZMj1a2b3c/"), "tiktok");
  assert.equal(
    classifyPlatform("https://www.instagram.com/reel/ABC123/"),
    "instagram",
  );
  assert.equal(classifyPlatform("https://instagr.am/p/ABC123/"), "instagram");
  assert.equal(
    classifyPlatform("https://www.youtube.com/shorts/abc123"),
    "youtube",
  );
  assert.equal(classifyPlatform("https://youtu.be/abc123"), "youtube");
  assert.equal(
    classifyPlatform("https://youtube.com/watch?v=abc123"),
    "youtube",
  );
  assert.equal(classifyPlatform("https://example.com/video/123"), null);
  assert.equal(classifyPlatform("not a url"), null);
  assert.equal(classifyPlatform(""), null);
});

test("canonicalizeYouTubeUrl normalizes shorts, youtu.be, and embed links", () => {
  assert.equal(
    canonicalizeYouTubeUrl("https://www.youtube.com/shorts/AbCd1234"),
    "https://www.youtube.com/watch?v=AbCd1234",
  );
  assert.equal(
    canonicalizeYouTubeUrl("https://youtu.be/AbCd1234"),
    "https://www.youtube.com/watch?v=AbCd1234",
  );
  assert.equal(
    canonicalizeYouTubeUrl("https://www.youtube.com/embed/AbCd1234"),
    "https://www.youtube.com/watch?v=AbCd1234",
  );
  assert.equal(
    canonicalizeYouTubeUrl("https://www.youtube.com/watch?v=AbCd1234&t=5"),
    "https://www.youtube.com/watch?v=AbCd1234&t=5",
  );
});

test("canonicalizeInstagramUrl rewrites instagr.am hosts", () => {
  assert.equal(
    canonicalizeInstagramUrl("https://instagr.am/p/AbCd1234/"),
    "https://instagram.com/p/AbCd1234/",
  );
  assert.equal(
    canonicalizeInstagramUrl("https://www.instagram.com/reel/AbCd1234/"),
    "https://www.instagram.com/reel/AbCd1234/",
  );
});

test("extractHashtags pulls unique unicode tags from text", () => {
  assert.deepEqual(extractHashtags("fun #cats #funny #cats"), [
    "cats",
    "funny",
  ]);
  assert.deepEqual(extractHashtags("no tags here"), []);
});

test("stripHashtags removes hashtags and collapses whitespace", () => {
  assert.equal(
    stripHashtags("Now we all know #memes #funny #humor"),
    "Now we all know",
  );
  assert.equal(stripHashtags("#onlyhashtag"), "");
  assert.equal(stripHashtags("mid#word stays #tagged end"), "mid#word stays end");
  assert.equal(stripHashtags("clean caption"), "clean caption");
  assert.equal(stripHashtags("", ), "");
  assert.equal(stripHashtags("héllo #mùndo"), "héllo");
});

test("mimeTypeForFile maps common video extensions", () => {
  assert.equal(mimeTypeForFile("/tmp/video.mp4"), "video/mp4");
  assert.equal(mimeTypeForFile("/tmp/video.webm"), "video/webm");
  assert.equal(mimeTypeForFile("/tmp/video.unknown"), "application/octet-stream");
});

test("mapYtDlpInfo maps youtube info json", () => {
  const mapped = mapYtDlpInfo(
    {
      title: "My short #shorts #cat",
      description: "long description",
      uploader: "Cat Channel",
      duration: 15,
      thumbnail: "https://i.ytimg.com/vi/x/hqdefault.jpg",
      channel_url: "https://www.youtube.com/@catchannel",
      tags: ["cat"],
    },
    "youtube",
  );
  assert.ok(mapped);
  assert.equal(mapped.username, "Cat Channel");
  assert.equal(mapped.caption, "My short #shorts #cat");
  assert.ok(mapped.hashtags.includes("shorts"));
  assert.equal(mapped.durationSeconds, 15);
  assert.equal(mapped.coverUrl, "https://i.ytimg.com/vi/x/hqdefault.jpg");
});

test("mapYtDlpInfo maps instagram info json to the username handle", () => {
  const mapped = mapYtDlpInfo(
    {
      title: "a post",
      description: "caption here #reels #funny",
      uploader_id: "@coolcreator",
      uploader: "Cool Creator",
      duration: 8,
      thumbnail: "https://scontent.cdninstagram.com/x.jpg",
    },
    "instagram",
  );
  assert.ok(mapped);
  assert.equal(mapped.username, "coolcreator");
  assert.equal(mapped.caption, "caption here #reels #funny");
  assert.deepEqual(mapped.hashtags, ["reels", "funny"]);
  assert.equal(mapped.durationSeconds, 8);
});

test("mapYtDlpInfo prefers the channel handle over the numeric uploader_id", () => {
  const mapped = mapYtDlpInfo(
    {
      title: "a post",
      description: "caption",
      channel: "realhandle",
      uploader: "🎀 Display Name 🎀",
      uploader_id: "51542902481",
    },
    "instagram",
  );
  assert.ok(mapped);
  assert.equal(mapped.username, "realhandle");
});

test("mapYtDlpInfo handles null and missing durations", () => {
  assert.equal(mapYtDlpInfo(null, "youtube"), null);
  const mapped = mapYtDlpInfo({ title: "x" }, "youtube");
  assert.equal(mapped.username, "");
  assert.equal(mapped.durationSeconds, null);
});
