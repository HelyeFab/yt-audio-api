# YouTube Content Extraction Service

Backend service for Doshi Sensei's YouTube shadowing feature. Provides multiple methods to extract captions and audio from YouTube videos.

## Features

- **YouTube API Caption Extraction**: Direct access to YouTube captions without scraping
- **yt-dlp Fallback**: Secondary method for subtitle extraction
- **Audio Extraction**: Download audio for AI transcription (with retry logic)
- **Whisper API Integration**: Transcribe audio files using OpenAI's Whisper
- **Proxy Support**: Optional proxy configuration for bypassing restrictions
- **User Agent Rotation**: Avoid detection with rotating user agents
- **Retry Logic**: Automatic retries with exponential backoff

## Endpoints

### `/extract-youtube-content` (POST) - NEW UNIFIED ENDPOINT
Tries multiple methods to get video content:
1. YouTube API for captions (no blocking!)
2. yt-dlp for subtitles (fallback)
3. Returns audio extraction option if no captions found

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "preferCaptions": true
}
```

### `/extract-youtube-subtitles` (POST)
Extract subtitles/captions from YouTube videos

### `/extract-audio` (POST)
Download audio from YouTube (MP3 format)

### `/transcribe-audio` (POST)
Transcribe audio using OpenAI Whisper API

## Environment Variables

```bash
# Required
OPENAI_API_KEY=your_openai_api_key

# Optional
PORT=3000
PROXY_URL=socks5://127.0.0.1:9050  # Optional proxy
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install yt-dlp:
```bash
# On Ubuntu/Debian
sudo apt update && sudo apt install -y yt-dlp ffmpeg

# Or using pip
pip install yt-dlp
```

3. Create `.env` file with your OpenAI API key

4. Run locally:
```bash
npm start
```

## Deployment on Render

1. Create new Web Service on Render
2. Connect your GitHub repository
3. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Add `OPENAI_API_KEY`

4. Add to `render.yaml` (if using):
```yaml
services:
  - type: web
    name: yt-dl
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: OPENAI_API_KEY
        sync: false
```

## Proxy Configuration

If YouTube blocks your server, you can use a proxy:

1. **SOCKS5 Proxy**:
```bash
PROXY_URL=socks5://username:password@proxy.example.com:1080
```

2. **HTTP Proxy**:
```bash
PROXY_URL=http://username:password@proxy.example.com:8080
```

3. **Residential Proxy** (Recommended):
- Services like MarsProxies, BrightData
- Rotating IPs avoid detection

## Troubleshooting

### "Sign in to confirm" Error
YouTube is blocking your server IP. Solutions:
1. Use a residential proxy
2. Deploy to a different cloud provider
3. Use the YouTube API method (no blocking!)

### Rate Limiting
The service includes automatic retry with exponential backoff. You can also:
1. Increase sleep intervals in the code
2. Use multiple proxy IPs
3. Implement request queuing

### No Captions Found
1. Check if video has Japanese captions on YouTube
2. Try with auto-generated captions enabled
3. Use audio extraction + Whisper transcription as fallback

## API Usage Examples

### Extract Content (Recommended)
```javascript
const response = await fetch('https://your-server.com/extract-youtube-content', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=VIDEO_ID',
    preferCaptions: true
  })
});

const data = await response.json();
if (data.success) {
  console.log('Transcript:', data.transcript);
  console.log('Method used:', data.method);
}
```

### Transcribe Audio
```javascript
const response = await fetch('https://your-server.com/transcribe-audio', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    audioUrl: 'https://example.com/audio.mp3',
    language: 'ja'
  })
});
```

## License

MIT