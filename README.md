# YouTube Audio Extraction & Transcription API

This service provides audio extraction from YouTube videos and AI-powered transcription using OpenAI's Whisper API.

## Endpoints

- `GET /` - Health check and API documentation
- `GET /health` - Simple health check
- `POST /extract-audio` - Extract audio from YouTube URL (currently blocked by YouTube)
- `POST /transcribe-audio` - Transcribe audio using OpenAI Whisper

## Environment Variables

### Required for Transcription
- `OPENAI_API_KEY` - Your OpenAI API key for Whisper transcription

### Optional
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## Deployment on Render

1. Fork this repository
2. Connect to Render
3. Add environment variable: `OPENAI_API_KEY`
4. Deploy

## Known Issues

- YouTube blocks most cloud hosting providers from downloading videos
- The `/extract-audio` endpoint may not work on cloud platforms
- Consider using client-side solutions or self-hosting for audio extraction

## Transcription API

### Request
```json
POST /transcribe-audio
{
  "audioUrl": "https://example.com/audio.mp3",
  "language": "ja"  // Optional, defaults to "ja" for Japanese
}
```

### Response
```json
{
  "transcript": [
    {
      "id": "1",
      "text": "こんにちは",
      "startTime": 0.0,
      "endTime": 1.5,
      "words": ["こんにちは"]
    }
  ],
  "language": "japanese",
  "duration": 120.5
}
```

## Costs

- Whisper API: ~$0.006 per minute of audio
- Calculate your expected costs based on usage

## Development

```bash
npm install
npm start
```

## License

MIT
