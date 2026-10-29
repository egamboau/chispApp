FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm ci

COPY shared/ ./shared/
COPY frontend/ ./frontend/
COPY backend/ ./backend/

RUN npm run lint
RUN npm run typecheck
RUN npm test
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/tournament.db

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/shared/package.json ./shared/package.json
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist

RUN mkdir -p /data && chown -R node:node /app /data

USER node
WORKDIR /app/backend

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
