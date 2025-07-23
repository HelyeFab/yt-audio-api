const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);
const axios = require('axios');
const FormData = require('form-data');

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
      '/extract-audio': 'POST - Extract audio from YouTube URL',
      '/transcribe-audio': 'POST - Transcribe audio using Whisper API',
      '/extract-youtube-subtitles': 'POST - Extract subtitles from YouTube videos'
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

// Transcribe audio using OpenAI Whisper API
// Extract YouTube subtitles/captions
app.post('/extract-youtube-subtitles', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  try {
    console.log('Extracting subtitles for:', url);
    
    // Use yt-dlp to extract subtitles
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, `subs_${Date.now()}`);
    
    // First, get video info and available subtitles
    const infoCmd = `yt-dlp --dump-json --no-warnings "${url}"`;
    let videoInfo;
    
    try {
      const { stdout: infoOutput } = await execAsync(infoCmd);
      videoInfo = JSON.parse(infoOutput);
    } catch (error) {
      console.error('Failed to get video info:', error);
      throw new Error('Could not fetch video information');
    }
    
    // Check for available subtitles (manual or auto-generated)
    const subtitles = videoInfo.subtitles || {};
    const automaticCaptions = videoInfo.automatic_captions || {};
    
    // Prefer Japanese subtitles
    let selectedLang = null;
    let isAutoGenerated = false;
    
    // Check manual subtitles first
    if (subtitles.ja || subtitles['ja-JP']) {
      selectedLang = subtitles.ja ? 'ja' : 'ja-JP';
    } else if (automaticCaptions.ja || automaticCaptions['ja-JP']) {
      selectedLang = automaticCaptions.ja ? 'ja' : 'ja-JP';
      isAutoGenerated = true;
    }
    
    if (!selectedLang) {
      // No Japanese subtitles, try English as fallback
      if (subtitles.en || subtitles['en-US']) {
        selectedLang = subtitles.en ? 'en' : 'en-US';
      } else if (automaticCaptions.en || automaticCaptions['en-US']) {
        selectedLang = automaticCaptions.en ? 'en' : 'en-US';
        isAutoGenerated = true;
      }
    }
    
    if (!selectedLang) {
      return res.status(404).json({ 
        error: 'No subtitles found',
        message: 'This video does not have subtitles available. Try using audio transcription instead.',
        availableLanguages: Object.keys({...subtitles, ...automaticCaptions})
      });
    }
    
    // Download subtitles in JSON format for better parsing
    const subsCmd = `yt-dlp --write-subs --write-auto-subs --sub-lang ${selectedLang} --skip-download --sub-format json3 --no-warnings -o "${outputPath}" "${url}"`;
    
    await execAsync(subsCmd);
    
    // Find the downloaded subtitle file
    let subsPath = null;
    const possiblePaths = [
      `${outputPath}.${selectedLang}.json3`,
      `${outputPath}.json3`
    ];
    
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        subsPath = path;
        break;
      }
    }
    
    // If JSON3 failed, try VTT format
    if (!subsPath) {
      const vttCmd = `yt-dlp --write-subs --write-auto-subs --sub-lang ${selectedLang} --skip-download --sub-format vtt --no-warnings -o "${outputPath}" "${url}"`;
      await execAsync(vttCmd);
      
      const vttPaths = [
        `${outputPath}.${selectedLang}.vtt`,
        `${outputPath}.vtt`
      ];
      
      for (const path of vttPaths) {
        if (fs.existsSync(path)) {
          subsPath = path;
          break;
        }
      }
    }
    
    if (!subsPath || !fs.existsSync(subsPath)) {
      throw new Error('Failed to download subtitles');
    }
    
    // Parse subtitles
    let transcript = [];
    const fileContent = fs.readFileSync(subsPath, 'utf8');
    
    if (subsPath.endsWith('.json3')) {
      // Parse JSON3 format
      const jsonData = JSON.parse(fileContent);
      if (jsonData.events) {
        let currentText = '';
        let startTime = 0;
        let id = 1;
        
        jsonData.events.forEach((event, index) => {
          if (event.segs) {
            const text = event.segs.map(seg => seg.utf8 || '').join('').trim();
            if (text && text !== '\n') {
              const start = (event.tStartMs || 0) / 1000;
              const duration = (event.dDurationMs || 5000) / 1000;
              
              transcript.push({
                id: String(id++),
                text: text,
                startTime: start,
                endTime: start + duration,
                words: text.split(/[\s、。！？]/g).filter(w => w.length > 0)
              });
            }
          }
        });
      }
    } else if (subsPath.endsWith('.vtt')) {
      // Parse VTT format (reuse existing parser)
      transcript = parseVTTToTranscript(fileContent);
    }
    
    // Clean up
    fs.unlinkSync(subsPath);
    
    res.json({
      transcript,
      language: selectedLang,
      isAutoGenerated,
      videoTitle: videoInfo.title || 'Unknown',
      videoDuration: videoInfo.duration || 0
    });
    
  } catch (error) {
    console.error('Subtitle extraction error:', error);
    res.status(500).json({ 
      error: 'Failed to extract subtitles',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

app.post('/transcribe-audio', async (req, res) => {
  const { audioUrl, language = 'ja' } = req.body;
  
  if (!audioUrl) {
    return res.status(400).json({ error: 'Audio URL is required' });
  }
  
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }
  
  try {
    console.log('Starting transcription for audio:', audioUrl);
    
    // Download the audio file temporarily
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `audio_${Date.now()}.mp3`);
    
    // Download audio file
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log('Audio downloaded, starting Whisper transcription...');
    
    // Create form data for Whisper API
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath));
    form.append('model', 'whisper-1');
    form.append('language', language);
    form.append('response_format', 'verbose_json'); // Get timestamps
    
    // Call Whisper API
    const whisperResponse = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          ...form.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    
    // Parse Whisper response to our transcript format
    const whisperData = whisperResponse.data;
    const transcript = [];
    
    if (whisperData.segments) {
      whisperData.segments.forEach((segment, index) => {
        transcript.push({
          id: String(index + 1),
          text: segment.text.trim(),
          startTime: segment.start,
          endTime: segment.end,
          words: segment.text.trim().split(/[\s、。！？]/g).filter(w => w.length > 0)
        });
      });
    } else {
      // Fallback if no segments provided
      transcript.push({
        id: '1',
        text: whisperData.text,
        startTime: 0,
        endTime: 0,
        words: whisperData.text.split(/[\s、。！？]/g).filter(w => w.length > 0)
      });
    }
    
    console.log(`Transcription complete. ${transcript.length} segments found.`);
    
    res.json({ 
      transcript,
      language: whisperData.language,
      duration: whisperData.duration
    });
    
  } catch (error) {
    console.error('Transcription error:', error);
    
    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Invalid OpenAI API key' });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'OpenAI API rate limit exceeded. Please try again later.' });
    } else if (error.response?.data?.error) {
      res.status(500).json({ error: error.response.data.error.message });
    } else {
      res.status(500).json({ 
        error: 'Failed to transcribe audio',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined
      });
    }
  }
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
      '--no-cache-dir',
      '--rm-cache-dir',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
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
        if (stderrData.includes('Sign in to confirm') || stderrData.includes('bot')) {
          errorMsg = 'YouTube is blocking the server. This is a known issue with cloud hosting providers.';
        } else if (stderrData.includes('Video unavailable')) {
          errorMsg = 'Video is unavailable. It might be private, deleted, or region-locked.';
        } else if (stderrData.includes('ERROR:')) {
          // Extract the actual error message from yt-dlp
          const errorMatch = stderrData.match(/ERROR:\s*(.+)/);
          if (errorMatch) {
            errorMsg = errorMatch[1];
          }
        } else if (stderrData.includes('429') || stderrData.includes('Too Many Requests')) {
          errorMsg = 'YouTube is rate limiting the server. Please try again later.';
        }
        
        console.error(`Full error - Stderr: ${stderrData}`);
        console.error(`Stdout: ${stdoutData}`);
        console.error(`Exit code: ${code}`);
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