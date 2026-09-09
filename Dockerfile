# Dockerfile — ai-model-radar production image (Cloud Run / any OCI runtime)
#
# Zero-cost notes:
#   - No secrets are baked in: all credentials arrive as runtime env vars
#     (Cloud Run --set-secrets) or a mounted .env file. Never COPY .env*.
#   - Runs as non-root `nextjs` user; listens on $PORT (Cloud Run injects it,
#     defaults to 3000 for local `docker run`).
#   - Local JSON storage fallback works out of the box; mount a volume at
#     /app/data or set DATABASE_URL for Postgres.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
RUN addgroup --system --gid 1001 nextjs \
 && adduser --system --uid 1001 --gid 1001 nextjs \
 && mkdir -p /app/.next /app/data && chown -R nextjs:nextjs /app
COPY --from=builder --chown=nextjs:nextjs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=nextjs:nextjs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nextjs /app/.next ./.next
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/next.config.mjs ./next.config.mjs
USER nextjs
EXPOSE 3000
# Cloud Run sets $PORT; `npm start` (next start) honors -p, so wrap it.
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
