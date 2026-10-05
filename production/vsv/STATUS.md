# VSV — project status (shared memory for every session)

_Updated 2026-10-05. Read this first after any new session, `/clear` or compaction._

## Production server — LIVE
- **Host:** `45.128.234.165` (Germany, Ubuntu 24.04, 1 vCPU / 2 GB RAM / 60 GB).
- **Bootstrapped** by Claude Code on the founder's PC: Docker stack `web` + `api` + `caddy`,
  `ufw` 22/80/443 only, `fail2ban`, unattended upgrades, swap, `vsv-update.timer`.
- **Auto-deploy:** the server pulls branch `claude/exciting-darwin-vvv3fd` every 5 min and rebuilds.
  Push to that branch = deploy. Nobody needs SSH for normal releases.
- **Access:** SSH by key from the founder's PC only (password login disabled). Root password was rotated;
  never put credentials in chat, commits or docs.
- **App URL:** http://45.128.234.165 (no domain yet → no HTTPS → camera recording in the browser is unavailable).

## Who can do what
| Session | Can | Cannot |
|---|---|---|
| Cloud session (claude.ai/code) | write code, run tests, push to the branch (→ auto-deploy) | reach the server (port 22 and the IP are blocked by its network policy) |
| Claude Code on the founder's PC (`C:\Users\Оля\Claude-Code-Game-Studios`) | SSH to the server, diagnose, hotfix, push | — |

Resume on the PC: `cd C:\Users\Оля\Claude-Code-Game-Studios` → `claude --continue` (or `claude --resume`) → «продолжай».
PC checkpoint: `production/session-state/active.md` (local, gitignored).

## What is built
- `packages/core` — battle rules (25 tests). `packages/security` — 23 tests. `apps/server` — API (9 HTTP tests).
- `apps/mobile` — Expo app (single-user trial, local data). `deploy/` — Docker, Caddy, bootstrap, task file.

## In progress / next
1. **Connect the mobile app to the API** (was being done by the `mobile-programmer` agent on the PC; uncommitted
   changes in `apps/mobile` may exist on the PC — review and commit them first).
2. Rebuild `deploy/web` with `deploy/publish-web.sh` after the app talks to the API, then push.
3. Domain + HTTPS (`DOMAIN=<domain>` re-run of bootstrap).
4. Native builds (EAS) for Google Play / App Store — later.
