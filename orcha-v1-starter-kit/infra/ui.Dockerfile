FROM node:22-alpine AS build

WORKDIR /app
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY ui/ ./
RUN pnpm build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/nginx-hosted.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /var/cache/nginx /var/log/nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD wget --quiet --spider http://127.0.0.1:8080/health || exit 1
