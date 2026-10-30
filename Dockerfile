# Use the official lightweight Node.js active LTS image
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm ci || npm install --omit=dev

# Copy source files
COPY . .

# Build the fingerprinted distribution assets
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Non-root user for security
USER node

# Copy built application and required files
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/netlify ./netlify
COPY --chown=node:node --from=builder /app/server.js ./server.js

EXPOSE 8080

CMD ["node", "server.js"]

