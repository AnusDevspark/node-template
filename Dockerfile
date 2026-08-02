# syntax=docker/dockerfile:1

# =============================================================================
# Multi-stage production image.
#
# The stages exist to keep build tooling out of the shipped image: the compiler,
# dev dependencies and source files stay in `build` and never reach `runtime`.
# =============================================================================

# --- Stage 1: dependencies ---------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# Copy manifests only. This layer is cached and rebuilds solely when the
# dependency set changes, so ordinary source edits skip a full npm install.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# `npm ci` installs exactly what the lockfile pins — reproducible, unlike
# `npm install` which may resolve newer versions.
# --ignore-scripts skips the postinstall `prisma generate`; the schema needs the
# src/ path that does not exist yet at this layer. It runs in the build stage.
RUN npm ci --ignore-scripts


# --- Stage 2: build ----------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client (TypeScript source under src/generated), then
# compile everything and rewrite the `@/` path aliases to relative paths.
RUN npx prisma generate && npm run build

# Drop dev dependencies from this node_modules so the runtime stage copies only
# what production needs.
RUN npm prune --omit=dev


# --- Stage 3: runtime --------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Tini reaps zombie processes and, more importantly here, forwards SIGTERM to
# Node. Without an init process, PID 1 semantics mean the signal is ignored and
# the graceful shutdown handler in server.ts never runs — the container is
# SIGKILLed after the grace period instead, dropping in-flight requests.
RUN apk add --no-cache tini

# Run unprivileged. The node image ships a `node` user for exactly this.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
# Needed at runtime only for `prisma migrate deploy` on release.
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]

# Migrations are deliberately NOT run here. Running them on container start
# means every replica races to migrate on deploy. Run `prisma migrate deploy`
# as a separate release step (a Kubernetes Job, an ECS one-off task, a CI stage)
# before rolling the new image out.
CMD ["node", "dist/server.js"]
