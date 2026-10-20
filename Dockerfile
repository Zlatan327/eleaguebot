FROM node:20-bookworm-slim

# Install Chromium and fonts using Debian Bookworm (active repos, no 404s)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Skip downloading Chrome during npm install; use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=160"

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install npm dependencies cleanly and quickly
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose port (Render sets $PORT dynamically)
ENV PORT=3000
EXPOSE 3000

# Start application
CMD ["npm", "start"]
