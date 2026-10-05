# VSV trial — static web build served by nginx. Build from the repo root:
#   docker build -f deploy/Dockerfile -t vsv-web . && docker run -d -p 80:80 --restart=always vsv-web
FROM node:22-alpine AS build
WORKDIR /repo
COPY packages/core packages/core
COPY apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/
RUN cd apps/mobile && npm ci --no-audit --no-fund
COPY apps/mobile apps/mobile
RUN cd apps/mobile && CI=1 npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/mobile/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://127.0.0.1/healthz || exit 1
