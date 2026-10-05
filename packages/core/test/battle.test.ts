import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVote, statusOf, DEFAULT_RULES } from "../src/index.ts";
import { clip, withRecord } from "./fixtures.ts";

test("new clip with no battles is qualifying", () => {
  assert.equal(statusOf(withRecord("a", 0, 0)), "qual");
});

test("7 losses inside the first 10 battles eliminates the clip", () => {
  assert.equal(statusOf(withRecord("a", 0, 7)), "out");          // early: after 7 battles
  assert.equal(statusOf(withRecord("a", 3, 7)), "out");          // exactly at 10
});

test("6 losses in 10 battles survives qualification as active", () => {
  assert.equal(statusOf(withRecord("a", 4, 6)), "active");
});

test("king needs strictly more than 70% wins after qualification", () => {
  assert.equal(statusOf(withRecord("a", 7, 3)), "active");       // exactly 70% is not enough
  assert.equal(statusOf(withRecord("a", 8, 2)), "king");
});

test("8 wins in the first 9 battles is still qualifying", () => {
  assert.equal(statusOf(withRecord("a", 8, 1)), "qual");
});

test("losses after qualification never eliminate, kings can fall to active", () => {
  assert.equal(statusOf(withRecord("a", 8, 7, "king")), "active");
  assert.equal(statusOf(withRecord("a", 3, 12, "active")), "active");
});

test("out is permanent", () => {
  assert.equal(statusOf(withRecord("a", 50, 7, "out")), "out");
});

test("vote moves equal rating, updates records and does not mutate inputs", () => {
  const a = clip("a"), b = clip("b");
  const r = applyVote(a, b);
  assert.equal(r.delta, DEFAULT_RULES.eloK / 2);                  // equal ratings → half of K
  assert.equal(r.winner.rating, DEFAULT_RULES.startRating + r.delta);
  assert.equal(r.loser.rating, DEFAULT_RULES.startRating - r.delta);
  assert.equal(r.winner.wins, 1); assert.equal(r.loser.losses, 1);
  assert.equal(a.wins, 0); assert.equal(b.losses, 0);
});

test("upset win against a stronger clip moves more rating", () => {
  const weak = clip("w", { rating: 1400 }), strong = clip("s", { rating: 1600 });
  assert.ok(applyVote(weak, strong).delta > applyVote(strong, weak).delta);
});

test("seventh qualification loss is reported as a milestone", () => {
  const r = applyVote(clip("a"), withRecord("b", 2, 6));
  assert.equal(r.loser.status, "out");
  assert.deepEqual(r.milestones.map(c => c.id), ["b"]);
});

test("crossing into king is reported as a milestone", () => {
  const r = applyVote(withRecord("a", 8, 1), clip("b"));
  assert.equal(r.winner.status, "king");
  assert.deepEqual(r.milestones.map(c => c.id), ["a"]);
});

test("eliminated or identical clips cannot battle", () => {
  assert.throws(() => applyVote(clip("a"), withRecord("b", 0, 7, "out")));
  const a = clip("a"); assert.throws(() => applyVote(a, a));
});
