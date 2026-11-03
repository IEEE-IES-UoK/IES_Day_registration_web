# Production-ready Node.js container for Cloud Run
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy application files
COPY package*.json ./
COPY scripts ./scripts
COPY assets ./assets
COPY index.html styles.css form-theme.css site.js ./
COPY netlify ./netlify
COPY server.js ./

# Build fingerprinted production assets (no external dependencies needed)
RUN npm run build

# Secure non-root user
USER node

EXPOSE 8080

CMD ["node", "server.js"]
