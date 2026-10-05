# @vsv/core

Pure TypeScript battle rules for VSV — shared by the app (optimistic UI) and the backend (authoritative votes).

- `rules.ts` — tunable values (`DEFAULT_RULES`: 10 qualifying battles, ≥7 losses → out, >70% wins → king).
- `battle.ts` — `statusOf`, `applyVote` (Elo), `newClip`.
- `matchmaking.ts` — `pickPair` with injected RNG; kings/qualifiers weighted up, hidden/blocked/own clips excluded.
- `duplicates.ts` — Instagram shortcode parsing and fingerprint index.
- `topics.ts` — topic ranking from consented captions/hashtags, topic suggestion.

Run tests: `cd packages/core && npm test` (Node ≥ 22.18, no dependencies).
