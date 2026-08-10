# --- Backend ---
FROM node:20-alpine AS backend
WORKDIR /app/backend
COPY cisco-topology-backend/package*.json ./
RUN npm ci --omit=dev
COPY cisco-topology-backend/ ./

# --- Frontend Build ---
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY cisco-topology-frontend/package*.json ./
RUN npm ci
COPY cisco-topology-frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

# --- Production ---
FROM node:20-alpine
WORKDIR /app

# Trace aracı için traceroute (Alpine'da varsayılan gelmez; ping busybox'ta mevcut)
RUN apk add --no-cache traceroute

# Backend
COPY --from=backend /app/backend ./backend

# Frontend static files
COPY --from=frontend-build /app/frontend/dist ./backend/public

# Data directory
RUN mkdir -p /app/backend/data

WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]
