# CapitalForge V2 frontend — Vite/React SPA served by nginx. nginx also
# reverse-proxies /api (and /docs) to the backend container, so the browser
# only ever talks to one origin and CORS never enters the picture.
#
# Build context is V2/ (see docker-compose.prod.yml).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY frontend ./frontend
# Empty API base => calls are same-origin ("/api/..."), which nginx proxies to
# the backend. Avoids baking a host/IP into the bundle (so the same image works
# on the dev box and the Pi).
RUN VITE_API_BASE_URL="" npm run build -w @cf2/frontend

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
