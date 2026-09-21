FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/tournament.db

COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
