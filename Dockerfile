# Start with Node.js image
FROM node:18

# Install ffmpeg and yt-dlp
RUN apt-get update && apt-get install -y ffmpeg wget && \
    wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Create app directory
WORKDIR /app

# Copy files and install dependencies
COPY . .
RUN npm install

# Expose the port your app runs on
EXPOSE 3000

# Command to start your app
CMD ["npm", "start"]
