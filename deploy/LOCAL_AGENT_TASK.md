# Task for Claude Code running on the founder's PC: deploy VSV to the server

You run on the founder's Windows PC (PowerShell; Git for Windows provides `ssh`). The cloud
session that writes the code cannot reach the server; you can. Do every step yourself, ask the
founder only where marked **ASK**. Report progress in Russian, briefly.

Server: `root@45.128.234.165` (Ubuntu 24.04, 1 vCPU / 2 GB RAM / 60 GB, Germany).

## 1. Update the repo
`git pull` on branch `claude/exciting-darwin-vvv3fd`.

## 2. SSH key access
- If `$HOME\.ssh\id_ed25519` does not exist: `ssh-keygen -t ed25519 -N '""' -f $HOME\.ssh\id_ed25519`.
- Test: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@45.128.234.165 hostname`.
- If it fails, **ASK** the founder to run this once in a separate PowerShell window and type the server password:
  `type $HOME\.ssh\id_ed25519.pub | ssh root@45.128.234.165 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`
  Then re-test. Never ask for or store the password yourself.

## 3. Install (idempotent)
`ssh root@45.128.234.165 "curl -fsSL https://raw.githubusercontent.com/Populity/Claude-Code-Game-Studios/claude/exciting-darwin-vvv3fd/deploy/bootstrap.sh | bash"`
If it fails, read the error, fix the cause (on the server, or in `deploy/` — then commit and push to the
same branch with a `fix:` message), and re-run. Typical: low memory during image builds → the script adds swap.

## 4. Verify (spawn in parallel)
- **devops-engineer**: `docker compose --project-directory /opt/vsv/deploy ps` — web, api, caddy healthy;
  `systemctl status vsv-update.timer` active; `ufw status` only 22/80/443.
- **qa-tester**: from the PC — `curl http://45.128.234.165/` returns the app HTML, `curl http://45.128.234.165/api/healthz` returns `{"ok":true}`,
  register a test account via `POST /api/auth/register`, fetch `GET /api/battle`, confirm a vote is rejected
  before 3 s (HTTP 425) and accepted after (HTTP 200).
- **security-engineer**: on the server set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`
  in `/etc/ssh/sshd_config.d/99-vsv.conf`, `systemctl reload ssh`, then confirm key login still works from the PC
  **before** closing the session. Generate a new random root password (`openssl rand -base64 18`), set it with
  `chpasswd`, and show it to the founder once (the old one was shared in a chat).

## 5. Report to the founder (Russian)
The URL to open on the phone, what was verified, anything that failed and how it was fixed.
Suggest a domain for HTTPS (camera recording in the browser needs it): point an A record to the IP and re-run step 3
with `DOMAIN=<domain>` before `bash`.
