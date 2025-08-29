# Multi-stage Docker build for DiagnoChain
FROM node:18-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    curl \
    postgresql-client \
    && rm -rf /var/cache/apk/*

# Create app user for security
RUN addgroup -g 1001 -S nodejs && adduser -S diagnochain -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY tsconfig*.json ./

# ================================
# Dependencies stage
# ================================
FROM base AS deps

# Install dependencies
RUN npm ci --only=production --silent
RUN cd frontend && npm ci --only=production --silent

# ================================
# Development stage
# ================================
FROM base AS dev

# Install all dependencies including dev
RUN npm ci --silent
RUN cd frontend && npm ci --silent

# Copy source code
COPY . .

# Set proper permissions
RUN chown -R diagnochain:nodejs /app
USER diagnochain

# Development command
CMD ["npm", "run", "dev"]

# ================================
# Build stage
# ================================
FROM base AS builder

# Install all dependencies
RUN npm ci --silent
RUN cd frontend && npm ci --silent

# Copy source code
COPY . .

# Build frontend
RUN cd frontend && npm run build

# Build backend (if TypeScript compilation needed)
RUN npm run build 2>/dev/null || echo "No build script found, skipping"

# Compile smart contracts
RUN npm run contracts:compile

# Clean up dev dependencies
RUN npm ci --only=production --silent && npm cache clean --force
RUN cd frontend && npm ci --only=production --silent && npm cache clean --force

# ================================
# Production stage
# ================================
FROM node:18-alpine AS production

# Security updates
RUN apk upgrade --no-cache && \
    apk add --no-cache \
    dumb-init \
    postgresql-client \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S diagnochain -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy production dependencies
COPY --from=builder --chown=diagnochain:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=diagnochain:nodejs /app/package*.json ./

# Copy built application
COPY --from=builder --chown=diagnochain:nodejs /app/backend ./backend
COPY --from=builder --chown=diagnochain:nodejs /app/bitcoin ./bitcoin
COPY --from=builder --chown=diagnochain:nodejs /app/config ./config
COPY --from=builder --chown=diagnochain:nodejs /app/database ./database
COPY --from=builder --chown=diagnochain:nodejs /app/contracts ./contracts

# Copy built frontend
COPY --from=builder --chown=diagnochain:nodejs /app/frontend/build ./frontend/build

# Copy scripts and configuration
COPY --from=builder --chown=diagnochain:nodejs /app/scripts ./scripts
COPY --from=builder --chown=diagnochain:nodejs /app/*.json ./
COPY --from=builder --chown=diagnochain:nodejs /app/*.js ./

# Create necessary directories
RUN mkdir -p logs backups temp && \
    chown -R diagnochain:nodejs /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

# Security: Run as non-root user
USER diagnochain

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3001

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["npm", "start"]

# ================================
# nginx-frontend stage (for frontend-only container)
# ================================
FROM nginx:alpine AS nginx-frontend

# Install security updates
RUN apk upgrade --no-cache

# Copy built frontend
COPY --from=builder /app/frontend/build /usr/share/nginx/html

# Copy nginx configuration
COPY infrastructure/docker/nginx.conf /etc/nginx/nginx.conf
COPY infrastructure/docker/frontend.conf /etc/nginx/conf.d/default.conf

# Create nginx user and set permissions
RUN adduser -D -S -s /sbin/nologin nginx-user && \
    chown -R nginx-user:nginx /usr/share/nginx/html && \
    chown -R nginx-user:nginx /var/cache/nginx && \
    chown -R nginx-user:nginx /etc/nginx

# Health check for nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

# Security headers and configuration
RUN echo 'server_tokens off;' >> /etc/nginx/nginx.conf

EXPOSE 80

# Run as non-root
USER nginx-user

CMD ["nginx", "-g", "daemon off;"]

# ================================
# bitcoin-services stage (for Bitcoin microservice)
# ================================
FROM base AS bitcoin-services

# Install Bitcoin and Lightning dependencies
RUN apk add --no-cache \
    bitcoin \
    && rm -rf /var/cache/apk/*

# Copy only Bitcoin-related code
COPY --from=builder --chown=diagnochain:nodejs /app/bitcoin ./bitcoin
COPY --from=builder --chown=diagnochain:nodejs /app/config ./config
COPY --from=builder --chown=diagnochain:nodejs /app/backend/src/utils ./backend/src/utils
COPY --from=builder --chown=diagnochain:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=diagnochain:nodejs /app/package*.json ./

# Health check for Bitcoin services
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('./bitcoin/bitcoinAPI').getStatus().initialized" || exit 1

USER diagnochain

ENV NODE_ENV=production
ENV SERVICE_TYPE=bitcoin

EXPOSE 3002

CMD ["node", "bitcoin/bitcoinAPI.js"]

# ================================
# database-migrations stage (for init containers)
# ================================
FROM base AS migrations

# Copy migration scripts
COPY --chown=diagnochain:nodejs database ./database
COPY --chown=diagnochain:nodejs config ./config
COPY --chown=diagnochain:nodejs package*.json ./

# Install only necessary deps
RUN npm ci --only=production --silent

USER diagnochain

# Migration command
CMD ["node", "database/migrations/migrations.js"]

# ================================
# Labels and metadata
# ================================
LABEL org.opencontainers.image.title="DiagnoChain"
LABEL org.opencontainers.image.description="Decentralized healthcare consultation platform"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="DiagnoChain Team"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/diagnochain/mvp"

# Build arguments for CI/CD
ARG BUILD_DATE
ARG GIT_COMMIT
ARG VERSION=1.0.0

LABEL org.opencontainers.image.created=$BUILD_DATE
LABEL org.opencontainers.image.revision=$GIT_COMMIT
LABEL org.opencontainers.image.version=$VERSION

# Environment-specific configurations
ENV TZ=UTC
ENV DEBIAN_FRONTEND=noninteractive

# Security: Remove package managers in production
RUN npm cache clean --force && \
    rm -rf /tmp/* /var/tmp/* /usr/share/doc/* /usr/share/man/*