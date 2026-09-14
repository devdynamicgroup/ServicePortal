FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Cloud Run injects PORT; server.js already reads process.env.PORT and binds
# process.env.BIND_HOST || '0.0.0.0', so no code change is needed here.
CMD ["node", "server.js"]
