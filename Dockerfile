############# 1️⃣  Builder ###################################################
FROM node:20-alpine AS builder
WORKDIR /app

# Faster rebuilds: copy package manifests first, install, then the rest
COPY package*.json ./
RUN npm ci --omit=dev        # installs prod deps only
# If you lint/test in CI, add RUN npm run test here

COPY . .
ARG SUPA_URL
ARG SUPA_KEY
RUN VITE_SUPABASE_URL=$SUPA_URL \
    VITE_SUPABASE_ANON_KEY=$SUPA_KEY \
    npm run build