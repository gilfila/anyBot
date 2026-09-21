# anyBot headless server
FROM node:24-bookworm-slim
RUN useradd --system --uid 10001 --home-dir /var/lib/anybot --create-home anybot \
    && mkdir -p /data /etc/anybot \
    && chown -R anybot:anybot /data /etc/anybot /var/lib/anybot
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=anybot:anybot runtime ./runtime
COPY --chown=anybot:anybot server ./server
VOLUME ["/data"]
ENV ANYBOT_SERVER_CONFIG=/etc/anybot/server.json
USER anybot
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4319/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--config", "/etc/anybot/server.json"]
