# VSV — deployment and server sizing

## Install on your server (one command)
Buy a VPS with **Ubuntu 24.04** (minimum now: 2 vCPU / 4 GB RAM / 40 GB SSD; for real users: 4 vCPU / 8 GB / 80 GB NVMe).
Open its console (SSH or the provider's web console), become root and run:

```
curl -fsSL https://raw.githubusercontent.com/Populity/Claude-Code-Game-Studios/claude/exciting-darwin-vvv3fd/deploy/bootstrap.sh | bash
```
With a domain pointed at the server IP (A record), add it for automatic HTTPS:
```
curl -fsSL https://raw.githubusercontent.com/Populity/Claude-Code-Game-Studios/claude/exciting-darwin-vvv3fd/deploy/bootstrap.sh | DOMAIN=vsv.example.com bash
```
The script installs Docker, firewall (22/80/443 only), fail2ban, automatic security updates and swap,
starts the app behind Caddy (HTTPS), and installs a 5-minute timer that pulls new commits from the
branch and redeploys. New code pushed to the branch reaches the server automatically — nobody needs SSH.

## GPU is not needed
VSV does no 3D rendering and no on-server AI. Votes, ratings and the database are CPU/RAM work;
video conversion (ffmpeg, H.264) runs fine on CPU. A 2 GB GPU adds nothing — don't pay for it.
(AI moderation later = an external API, or CPU models; 2 GB VRAM is too small for serious models anyway.)

## Stage 1 — trial now (what exists today: the web build, single user, data on device)
| Need | Minimum |
|---|---|
| Server | 1 vCPU, 512 MB–1 GB RAM, 10 GB SSD (any VPS ≈ $4–6/mo) — or free static hosting |
| Files | ~1 MB (index.html + JS bundle) |
| Run | `docker build -f deploy/Dockerfile -t vsv-web . && docker run -d -p 80:80 --restart=always vsv-web` |
| HTTPS | Put Caddy/Cloudflare in front (camera in the browser requires HTTPS) |

## Stage 2 — MVP with real users (needs the backend from ADR-0001, not built yet)
Assumptions: 1,000 daily users, 30 battles each, 300 uploads/day, clips ≤ 60 s → 720p ≈ 15 MB.

| Component | Minimum that works without errors | Why |
|---|---|---|
| App + API + Postgres (Supabase self-hosted) | **4 vCPU, 8 GB RAM, 80 GB NVMe** | Supabase stack ≈ 10 containers; Postgres for ~30k votes/day is light |
| Video transcoding (ffmpeg worker) | same box at first; 1 vCPU ≈ 1 clip of 60 s in ~30 s | 300 uploads/day ≈ 2.5 CPU-hours/day |
| Video storage | object storage (S3 / Cloudflare R2), not the server disk | 300 × 15 MB ≈ 4.5 GB/day ≈ 135 GB/month |
| Video delivery | CDN (R2 has free egress) | 30k battles × 2 clips × ~5 MB watched ≈ 300 GB/day |
| Backups | daily Postgres dump to object storage | |

Cheaper path for Stage 2: managed Supabase Pro (~$25/mo) + Cloudflare R2 (~$2/mo per 135 GB) — no server to administer.

## Stage 3 — growth (~50k daily users)
Separate Postgres (8 vCPU / 32 GB), 2+ API instances behind a load balancer, autoscaled
transcoding workers, CDN. Budget is driven by video traffic, not compute.

## Native app (Google Play / App Store) — later
`npx eas build -p android` / `-p ios` (Expo EAS, needs an Expo account; iOS needs an Apple Developer account $99/yr, Google Play $25 once).
