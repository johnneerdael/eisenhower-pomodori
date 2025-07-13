############# 1️⃣  Builder ###################################################
FROM node:20-alpine AS builder
WORKDIR /app

# Faster rebuilds: copy package manifests first, install, then the rest
COPY package*.json ./
RUN npm ci 
# installs prod deps only
# If you lint/test in CI, add RUN npm run test here

COPY . .
COPY .env ./
RUN npm run build 

######################## 2️⃣  Runtime (static) ###############
FROM nginx:1.27-alpine
# Replace default config with SPA-friendly one
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Drop compiled site in place
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK CMD wget --no-verbose --spider http://localhost/ || exit 1