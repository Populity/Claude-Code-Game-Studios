# VSV web app — serves the prebuilt bundle in deploy/web (built in CI/dev with
# `cd apps/mobile && npx expo export --platform web --output-dir dist`, then copied).
# Building on the server is avoided on purpose: small VPS (1 vCPU / 2 GB) stays idle.
# nginx-unprivileged: runs as uid 101 on :8080, pid and temp files in /tmp — no root, no capabilities.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/web /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
