# JARVIS server + web command center
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
COPY sdk ./sdk
ENV JARVIS_HOST=0.0.0.0 PORT=7777 JARVIS_DATA=/data/jarvis.json JARVIS_DB=/data/jarvis.db NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:7777/api/health || exit 1
USER node
CMD ["node", "server/index.js"]
