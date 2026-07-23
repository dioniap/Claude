FROM node:22-slim

# better-sqlite3 usa binario pre-compilado; ferramentas de build ficam como
# fallback para arquiteturas sem prebuild (ex.: ARM em alguns VPS)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY knowledge ./knowledge
COPY public ./public

ENV NODE_ENV=production
ENV DB_PATH=/app/data/atende-laudos.db
EXPOSE 3000

CMD ["node", "src/server.js"]
