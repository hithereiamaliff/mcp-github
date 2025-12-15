# GitHub MCP Server - Streamable HTTP
# For self-hosting on VPS with nginx reverse proxy

FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build:tsc

# Remove devDependencies after build
RUN npm prune --production

# Expose port for HTTP server
EXPOSE 8080

# Environment variables (can be overridden at runtime)
ENV PORT=8080
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the HTTP server
CMD ["node", "dist/http-server.js"]
