FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run lint && npm run build

FROM node:22-bookworm-slim AS backend-build

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig*.json ./
COPY backend/src ./src
COPY backend/public ./public
COPY backend/test ./test
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
RUN npm run typecheck && npm test && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/tournament.db

COPY --from=backend-build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/backend/dist ./dist
COPY --from=backend-build --chown=node:node /app/backend/public ./public
COPY --from=frontend-build --chown=node:node /app/frontend/dist /app/frontend/dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
