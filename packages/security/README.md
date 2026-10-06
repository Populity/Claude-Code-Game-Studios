# @vsv/security

WebCrypto-only (Node, Deno, React Native). `npm test` — 23 tests including attack cases.

| Module | Protects against |
|---|---|
| `token` | Forged/tampered tokens; cross-purpose replay (purpose bound into MAC); key rotation |
| `ticket` | Votes on battles never served, choices outside the pair, stolen tickets (viewer+device binding), instant bot votes (min watch time), replay (single-use nonce), stale tickets |
| `rateLimit` | Floods — layered sliding windows per account/device/IP/subnet; rejected hits don't extend lockout |
| `fraud` | Bot farms, fresh accounts, datacenter IPs, position bias, owner fixation, friend boosting → allow / shadow / deny |
| `collusion` | Reciprocal voting rings, owners boosted by a few voters |
| `upload` | Disguised files — magic-byte container sniffing, size limits, format allowlist |
| `sanitize` | Bidi/zero-width spoofing, control chars, oversize text, reserved/invalid handles, path-like ids |
| `audit` | Silent tampering — SHA-256 hash-chained audit log |
| `meta` | Forged Meta data-deletion / deauthorize callbacks (`signed_request`) |
| `oauth` | Login CSRF/fixation — PKCE S256, device-bound expiring `state`, redirect allowlist |
| `session` | DB leaks — opaque 256-bit tokens, only SHA-256 stored |
