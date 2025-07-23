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
// Test extraction with a direct MP3 URL
app.get('/test-extraction', async (req, res) => {
  try {
    const testUrl = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
    const outputPath = path.join(__dirname, 'downloads', `test_${Date.now()}`);
    
    if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
      fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
    }
    
    // Download with curl instead of yt-dlp for testing
    const { exec } = require('child_process');
    exec(`curl -L "${testUrl}" -o "${outputPath}.mp3"`, (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ error: 'Failed to download test file', details: error.message });
        return;
      }
      
      if (fs.existsSync(`${outputPath}.mp3`)) {
        const stats = fs.statSync(`${outputPath}.mp3`);
        fs.unlinkSync(`${outputPath}.mp3`);
        res.json({ 
          success: true, 
          message: 'Test download successful',
          fileSize: stats.size,
          downloadsDir: path.join(__dirname, 'downloads')
        });
      } else {
        res.status(500).json({ error: 'Downloaded file not found' });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Test failed', details: error.message });
  }
});

// Test yt-dlp with verbose output
app.get('/test-youtube', async (req, res) => {
  const { exec } = require('child_process');
  const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  
  // Run yt-dlp with verbose output
  exec(`yt-dlp -v --simulate --no-warnings "${testUrl}"`, (error, stdout, stderr) => {
    res.json({
      success: !error,
      exitCode: error ? error.code : 0,
      stdout: stdout.substring(0, 5000), // Limit output size
      stderr: stderr.substring(0, 5000),
      error: error ? error.message : null
    });
  });
});

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
    console.log('Starting download for URL:', url);
    console.log('Downloads directory exists:', fs.existsSync(outputDir));
    
    try {
      await downloadAudio(url, outputPath);
    } catch (downloadError) {
      console.error('Download error details:', downloadError);
      // Try to get more info about what's happening
      const { exec } = require('child_process');
      exec('ls -la /app', (err, stdout) => {
        console.log('App directory contents:', stdout);
      });
      exec('which yt-dlp', (err, stdout) => {
        console.log('yt-dlp location:', stdout || 'not found');
      });
      throw downloadError;
    }
    
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
    // Create cookies file path
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    
    const ytDlpArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-check-certificate',
      '--no-warnings',
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '-o', `${outputPath}.%(ext)s`,
      url
    ];
    
    console.log('Running yt-dlp with args:', ytDlpArgs);
    console.log('Output path:', outputPath);
    
    // Use yt-dlp from PATH
    const ytDlp = spawn('yt-dlp', ytDlpArgs);
    
    let stdoutData = '';
    let stderrData = '';
    
    ytDlp.stdout.on('data', (data) => {
      stdoutData += data.toString();
      console.log(`yt-dlp stdout: ${data}`);
    });
    
    ytDlp.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`yt-dlp stderr: ${data}`);
    });
    
    ytDlp.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        let errorMsg = `yt-dlp exited with code ${code}`;
        
        // Parse common YouTube errors
        if (stderrData.includes('Sign in to confirm')) {
          errorMsg = 'YouTube requires sign-in. The video might be age-restricted or YouTube is blocking automated requests.';
        } else if (stderrData.includes('Video unavailable')) {
          errorMsg = 'Video is unavailable. It might be private, deleted, or region-locked.';
        } else if (stderrData.includes('ERROR:')) {
          // Extract the actual error message from yt-dlp
          const errorMatch = stderrData.match(/ERROR:\s*(.+)/);
          if (errorMatch) {
            errorMsg = errorMatch[1];
          }
        }
        
        console.error(`Full error - Stderr: ${stderrData}`);
        console.error(`Stdout: ${stdoutData}`);
        reject(new Error(errorMsg));
      }
    });
    
    ytDlp.on('error', (err) => {
      console.error('Failed to spawn yt-dlp:', err);
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