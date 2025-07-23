const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

console.log('=== Server startup ===');
console.log('Time:', new Date().toISOString());
console.log('PORT:', PORT);
console.log('Node version:', process.version);
console.log('Current directory:', __dirname);
console.log('Environment:', process.env.NODE_ENV || 'development');

// Check if yt-dlp is available
const { exec } = require('child_process');
exec('which yt-dlp', (error, stdout, stderr) => {
  if (error) {
    console.error('yt-dlp not found in PATH:', error);
  } else {
    console.log('yt-dlp found at:', stdout.trim());
  }
});

// Check if ffmpeg is available
exec('which ffmpeg', (error, stdout, stderr) => {
  if (error) {
    console.error('ffmpeg not found in PATH:', error);
  } else {
    console.log('ffmpeg found at:', stdout.trim());
  }
});

// Enable CORS for all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Health check endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'YouTube audio extraction service is running',
    endpoints: {
      '/': 'GET - Health check',
      '/health': 'GET - Health check',
      '/extract-audio': 'POST - Extract audio from YouTube URL'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'YouTube audio extraction service is running'
  });
});

// Test endpoint to check dependencies
app.get('/test-deps', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const results = {};
  
  try {
    const ytdlp = await execAsync('which yt-dlp');
    results.ytdlp = { found: true, path: ytdlp.stdout.trim() };
  } catch (e) {
    results.ytdlp = { found: false, error: e.message };
  }
  
  try {
    const ffmpeg = await execAsync('which ffmpeg');
    results.ffmpeg = { found: true, path: ffmpeg.stdout.trim() };
  } catch (e) {
    results.ffmpeg = { found: false, error: e.message };
  }
  
  try {
    const ytdlpVersion = await execAsync('yt-dlp --version');
    results.ytdlpVersion = ytdlpVersion.stdout.trim();
  } catch (e) {
    results.ytdlpVersion = 'Unable to get version';
  }
  
  res.json({
    status: 'ok',
    dependencies: results,
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/extract-audio', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  const outputDir = path.join(__dirname, 'downloads');
  const outputPath = path.join(outputDir, `audio_${Date.now()}`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  try {
    await downloadAudio(url, outputPath);
    
    const mp3Path = `${outputPath}.mp3`;
    if (!fs.existsSync(mp3Path)) {
      return res.status(500).json({ error: 'Failed to download audio' });
    }
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
    
    const readStream = fs.createReadStream(mp3Path);
    await streamPipeline(readStream, res);
    
    fs.unlinkSync(mp3Path);
  } catch (error) {
    console.error('Error processing audio:', error);
    // Return more detailed error in development
    if (process.env.NODE_ENV !== 'production') {
      res.status(500).json({ 
        error: 'Failed to process audio',
        details: error.message,
        stack: error.stack
      });
    } else {
      res.status(500).json({ error: 'Failed to process audio' });
    }
  }
});

function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/;
  return youtubeRegex.test(url);
}

function downloadAudio(url, outputPath) {
  return new Promise((resolve, reject) => {
    const ytDlpArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', `${outputPath}.%(ext)s`,
      url
    ];
    
    const ytDlp = spawn('yt-dlp', ytDlpArgs);
    
    ytDlp.stdout.on('data', (data) => {
      console.log(`yt-dlp: ${data}`);
    });
    
    ytDlp.stderr.on('data', (data) => {
      console.error(`yt-dlp error: ${data}`);
    });
    
    ytDlp.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
    
    ytDlp.on('error', (err) => {
      reject(err);
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=== Server started successfully ===`);
  console.log(`Listening on http://0.0.0.0:${PORT}`);
  console.log(`Health check available at: http://0.0.0.0:${PORT}/health`);
  console.log(`Time: ${new Date().toISOString()}`);
});