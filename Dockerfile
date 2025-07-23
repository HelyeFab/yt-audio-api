FROM node:18-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp || pip3 install --no-cache-dir yt-dlp

# Create app directory with proper permissions
RUN mkdir -p /app && chown -R node:node /app

WORKDIR /app

# Switch to node user for security
USER node

# Copy package files with correct ownership
COPY --chown=node:node package*.json ./

# Install npm dependencies with clean cache
RUN npm ci --only=production || npm install --production

# Copy the rest of the application
COPY --chown=node:node . .

# Create downloads directory
RUN mkdir -p downloads

EXPOSE 3000

# Add healthcheck to help with debugging
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start directly with node
CMD ["node", "server.js"]