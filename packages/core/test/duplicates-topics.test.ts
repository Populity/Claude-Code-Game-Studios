import { test } from "node:test";
import assert from "node:assert/strict";
import { instagramShortcode, findDuplicate, fingerprintKey, rankTopics, suggestTopic } from "../src/index.ts";

test("shortcode is extracted from all common Instagram video URL forms", () => {
  for (const u of [
    "https://www.instagram.com/reel/ABC123xyz/",
    "https://instagram.com/reels/ABC123xyz?igsh=1",
    "instagram.com/p/ABC123xyz",
    "https://www.instagram.com/some.user/reel/ABC123xyz/",
    "  https://m.instagram.com/tv/ABC123xyz  ",
  ]) assert.equal(instagramShortcode(u), "ABC123xyz", u);
});

test("non-Instagram or profile links are rejected", () => {
  for (const u of ["https://tiktok.com/@a/video/1", "https://www.instagram.com/someone/", "not a url", "https://evil.com/instagram.com/reel/ABC123xyz"])
    assert.equal(instagramShortcode(u), null, u);
});

test("same link in a different form is a duplicate", () => {
  const index = new Map([[fingerprintKey({ kind: "instagram", code: "ABC123xyz" }), "clip-1"]]);
  const code = instagramShortcode("https://instagram.com/reels/ABC123xyz/?utm=x")!;
  assert.equal(findDuplicate({ kind: "instagram", code }, index), "clip-1");
});

test("file hashes compare case-insensitively", () => {
  const index = new Map([[fingerprintKey({ kind: "file", sha256: "abcdef" }), "clip-2"]]);
  assert.equal(findDuplicate({ kind: "file", sha256: "ABCDEF" }, index), "clip-2");
  assert.equal(findDuplicate({ kind: "file", sha256: "000000" }, index), null);
});

const CATALOGUE = [
  { id: "humor", keywords: ["смешн", "funny", "meme"] },
  { id: "pets", keywords: ["кот", "dog", "cat"] },
  { id: "food", keywords: ["рецепт", "food"] },
];

test("topics are ranked by keyword hits across captions and hashtags", () => {
  assert.deepEqual(rankTopics(["Мой кот и рецепт пиццы", "#cat #catlife", "#food"], CATALOGUE), ["pets", "food"]);
});

test("suggested topic falls back to the user's topics, then the default", () => {
  assert.equal(suggestTopic("Очень смешной кот", ["food"], CATALOGUE, "humor"), "humor"); // tie → catalogue order
  assert.equal(suggestTopic("без ключевых слов", ["food"], CATALOGUE, "humor"), "food");
  assert.equal(suggestTopic("", [], CATALOGUE, "humor"), "humor");
});
