# YouTube Audio Downloader API

## Project Goal
This project provides a web API for extracting audio from YouTube videos. It runs on Render as a server and exposes a single endpoint that allows users to download audio content from YouTube URLs.

## Technology Stack

| Tech | Description |
|------|-------------|
| Render | Server to run yt-dlp & ffmpeg |
| Express.js | API with one endpoint: /extract-audio |
| yt-dlp | Downloads audio from YouTube |
| ffmpeg | Converts audio to mp3 if needed |

## Architecture Overview
- **Render**: Cloud platform hosting the application
- **Express.js**: Lightweight web framework handling HTTP requests
- **yt-dlp**: Core tool for downloading YouTube content
- **ffmpeg**: Audio processing and conversion to MP3 format

## API Endpoint
- `POST /extract-audio`: Accepts a YouTube URL and returns the extracted audio file in MP3 format