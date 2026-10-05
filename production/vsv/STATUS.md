# VSV — project status (shared memory for every session)

_Updated 2026-10-05. Read this first after any new session, `/clear` or compaction._

## Production server — LIVE
- **Host:** `45.128.234.165` (Germany, Ubuntu 24.04, 1 vCPU / 2 GB RAM / 60 GB).
- **Bootstrapped** by Claude Code on the founder's PC: Docker stack `web` + `api` + `caddy`,
  `ufw` 22/80/443 only, `fail2ban`, unattended upgrades, swap, `vsv-update.timer`.
- **Auto-deploy:** the server pulls branch `claude/exciting-darwin-vvv3fd` every 5 min and rebuilds.
  Push to that branch = deploy. Nobody needs SSH for normal releases.
- **Access:** SSH by key from the founder's PC only. Operational security state (SSH config, passwords,
  open findings) is kept OFF this public repo — see the local checkpoint `production/session-state/active.md`.
  Never put credentials or security status in chat, commits or docs.
- **App URL:** https://45-128-234-165.sslip.io (free sslip.io name → Let's Encrypt HTTPS; http redirects).
  Set in `/opt/vsv/deploy/.env` (`SITE_ADDRESS`, `PUBLIC_URL`; gitignored, survives auto-updates).
  Own domain later: replace both values and `docker compose up -d`.

## Who can do what
| Session | Can | Cannot |
|---|---|---|
| Cloud session (claude.ai/code) | write code, run tests, push to the branch (→ auto-deploy) | reach the server (port 22 and the IP are blocked by its network policy) |
| Claude Code on the founder's PC (`C:\Users\Оля\Claude-Code-Game-Studios`) | SSH to the server, diagnose, hotfix, push | — |

Resume on the PC: `cd C:\Users\Оля\Claude-Code-Game-Studios` → `claude --continue` (or `claude --resume`) → «продолжай».
PC checkpoint: `production/session-state/active.md` (local, gitignored).

## What is built
- `packages/core` — battle rules (25 tests). `packages/security` — 23 tests. `apps/server` — API (9 HTTP tests).
- `apps/mobile` — Expo app, **talks to the API** (`src/api.ts`): register, battles with signed tickets and
  min-watch countdown, votes, video upload with progress, Instagram links, ranking, explore, profile,
  report/block, account deletion. `deploy/` — Docker, Caddy, bootstrap, task file.
- Live E2E (headless Chrome, `tools/e2e/`) PASS on 2026-10-05: onboarding → battle → vote; upload a real
  video → another user sees it in a battle and it plays. Evidence: `production/qa/evidence/2026-10-05-api-wiring/`.

## In progress / next
1. Native device check (camera/gallery, expo-video) — needs a phone with Expo Go / dev build.
2. Server gaps from the mobile agent: logout/session revoke, streak/stats on /api/me, delete own clip,
   video poster/thumbnail, explicit `ticket_expired` code for stale prefetched battles (>15 min).
3. Before real users: `DEMO_SEED=0`, SSH hardening, backups of the `vsv_data` volume.
4. Own domain + native builds (EAS) for Google Play / App Store.
