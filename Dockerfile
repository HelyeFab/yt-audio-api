FROM node:18-slim

# Install dependencies with timeout
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with timeout
RUN pip3 install --no-cache-dir yt-dlp

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install npm dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

EXPOSE 3000

# Start directly with node
CMD ["node", "server.js"]