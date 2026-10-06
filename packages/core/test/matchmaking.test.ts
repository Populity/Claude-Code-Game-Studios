import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPair, eligible, weightOf, DEFAULT_RULES } from "../src/index.ts";
import { clip, seq } from "./fixtures.ts";

const pool = [
  clip("q1", { topic: "humor" }),
  clip("k1", { topic: "humor", status: "king" }),
  clip("a1", { topic: "humor", status: "active" }),
  clip("o1", { topic: "humor", status: "out" }),
  clip("s1", { topic: "sport" }),
];

test("only same-topic, non-eliminated clips are eligible", () => {
  assert.deepEqual(eligible(pool, "humor").map(c => c.id), ["q1", "k1", "a1"]);
});

test("hidden clips, blocked owners and the viewer's own clips are excluded", () => {
  const ids = eligible(pool, "humor", { hidden: new Set(["q1"]), blockedOwners: new Set(["owner-k1"]), viewer: "owner-a1" }).map(c => c.id);
  assert.deepEqual(ids, []);
});

test("kings weigh more than qualifiers, qualifiers more than active, recent less", () => {
  const [q, k, a] = eligible(pool, "humor");
  assert.equal(weightOf(k), DEFAULT_RULES.kingWeight);
  assert.equal(weightOf(q), DEFAULT_RULES.qualWeight);
  assert.equal(weightOf(a), 1);
  assert.equal(weightOf(k, { recent: new Set(["k1"]) }), DEFAULT_RULES.kingWeight * DEFAULT_RULES.recentPenalty);
});

test("pair has two different clips of the requested topic", () => {
  const p = pickPair(pool, "humor", seq(0.1, 0.9, 0.2));
  assert.ok(p);
  assert.notEqual(p[0].id, p[1].id);
  assert.ok(p.every(c => c.topic === "humor" && c.status !== "out"));
});

test("weighted pick is deterministic for a given rng", () => {
  // weights q1=2, k1=3, a1=1 → total 6; 0.4*6=2.4 lands in k1
  const p = pickPair(pool, "humor", seq(0.4, 0.0, 0.1)); // third value < 0.5 keeps pick order
  assert.deepEqual(p?.map(c => c.id), ["k1", "q1"]);
});

test("returns null when fewer than two clips are eligible", () => {
  assert.equal(pickPair(pool, "sport", seq(0.5)), null);
});

test("avoids pairing two clips of the same owner when possible", () => {
  const same = [clip("x", { owner: "u" }), clip("y", { owner: "u" }), clip("z", { owner: "v" })];
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const p = pickPair(same, "humor", seq(r, r, r));
    assert.ok(p && p[0].owner !== p[1].owner);
  }
});
