FROM node:18-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with proper Python setup
RUN python3 -m pip install --upgrade pip --break-system-packages && \
    python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app files
COPY . .

# Create downloads directory
RUN mkdir -p downloads

EXPOSE 3000

# Start the server
CMD ["node", "server.js"]