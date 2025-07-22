# YouTube Audio Downloader API

A simple Express.js API that extracts audio from YouTube videos and returns it as MP3 files. Built for deployment on Render with Docker support.

## Features

- Single REST endpoint for audio extraction
- YouTube URL validation
- Automatic conversion to MP3 format
- Stream-based file delivery
- Automatic cleanup of temporary files
- Docker containerization for easy deployment

## Technology Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **yt-dlp** - YouTube content downloader
- **ffmpeg** - Audio processing and conversion
- **Docker** - Containerization for deployment

## Prerequisites

### Local Development
- Node.js 18+ installed
- Python 3.x installed
- yt-dlp installed (`pip install yt-dlp`)
- ffmpeg installed

### Docker Deployment
- Docker installed (all dependencies are handled in the container)

## Installation

### Local Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd yt-dl
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Install system dependencies:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3 python3-pip ffmpeg

# macOS (with Homebrew)
brew install python3 ffmpeg

# Install yt-dlp
pip3 install yt-dlp
```

4. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000`

### Docker Setup

1. Build the Docker image:
```bash
docker build -t yt-dl-api .
```

2. Run the container:
```bash
docker run -p 3000:3000 yt-dl-api
```

## API Usage

### Extract Audio Endpoint

**Endpoint:** `POST /extract-audio`

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
- Success: MP3 audio file stream
- Error: JSON error message

**Example using cURL:**
```bash
curl -X POST http://localhost:3000/extract-audio \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  --output audio.mp3
```

**Example using JavaScript (fetch):**
```javascript
const response = await fetch('http://localhost:3000/extract-audio', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=VIDEO_ID'
  })
});

if (response.ok) {
  const blob = await response.blob();
  // Handle the audio blob (save, play, etc.)
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

## Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Configure the following:
   - **Environment**: Docker
   - **Docker Command**: (leave empty, uses CMD from Dockerfile)
   - **Port**: 3000

4. Deploy the service

### Environment Variables

You can configure the following environment variables:

- `PORT` - Server port (default: 3000)

## Project Structure

```
yt-dl/
├── server.js          # Main Express server
├── package.json       # Node.js dependencies
├── package-lock.json  # Locked dependencies
├── Dockerfile         # Docker configuration
├── .dockerignore      # Docker ignore patterns
├── CLAUDE.md          # Project documentation
└── README.md          # This file
```

## Error Handling

The API includes error handling for:
- Missing URL in request body
- Invalid YouTube URL format
- yt-dlp download failures
- File system errors
- Stream processing errors

Common error responses:
- `400 Bad Request` - Missing or invalid URL
- `500 Internal Server Error` - Processing or download failure

## Security Considerations

- URL validation to prevent arbitrary command injection
- Temporary files are cleaned up after each request
- No persistent storage of downloaded content
- Rate limiting should be implemented for production use

## Limitations

- Only supports YouTube URLs
- Downloads are processed synchronously (one at a time)
- No caching mechanism
- Maximum video length depends on server timeout settings

## Development

### Running Tests
```bash
npm test
```

### Adding Features

To extend the API:
1. Modify `server.js` to add new endpoints or functionality
2. Update the Dockerfile if new system dependencies are needed
3. Test locally before deploying

## Troubleshooting

### Common Issues

1. **yt-dlp not found**
   - Ensure yt-dlp is installed: `pip3 install yt-dlp`
   - Check PATH includes pip installation directory

2. **ffmpeg not found**
   - Install ffmpeg for your system
   - Verify installation: `ffmpeg -version`

3. **Permission errors**
   - Ensure the process has write permissions for the downloads directory
   - Check Docker volume permissions if using Docker

4. **Download failures**
   - Verify the YouTube URL is valid and publicly accessible
   - Check if yt-dlp needs updating: `pip3 install --upgrade yt-dlp`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the ISC License.

## Disclaimer

This tool is for educational purposes only. Ensure you have the right to download and use content from YouTube according to their Terms of Service and applicable copyright laws.