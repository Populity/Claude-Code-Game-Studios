# VSV web app — serves the prebuilt bundle in deploy/web (built in CI/dev with
# `cd apps/mobile && npx expo export --platform web --output-dir dist`, then copied).
# Building on the server is avoided on purpose: small VPS (1 vCPU / 2 GB) stays idle.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/web /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://127.0.0.1/healthz || exit 1
