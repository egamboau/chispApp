FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY server.js ./
COPY public ./public
COPY test ./test
RUN npm test && npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/tournament.db

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
