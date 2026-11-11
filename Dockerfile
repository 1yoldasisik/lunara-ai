
FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data \
    && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=8080

VOLUME ["/app/data"]

EXPOSE 8080

USER node

CMD ["node", "server.js"]
