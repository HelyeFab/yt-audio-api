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

// Check available captions for a video
app.get('/check-captions/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const availableLanguages = [];
  
  // Common language codes to check
  const languagesToCheck = [
    'ja', 'ja-JP', 'en', 'en-US', 'en-GB', 
    'es', 'fr', 'de', 'ko', 'zh', 'zh-CN', 'zh-TW'
  ];
  
  console.log(`Checking available captions for video: ${videoId}`);
  
  for (const lang of languagesToCheck) {
    try {
      // Check manual captions
      const url = `https://video.google.com/timedtext?lang=${lang}&v=${videoId}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 5000
      });
      
      if (response.data && response.data.includes('<text')) {
        availableLanguages.push({
          language: lang,
          type: 'manual',
          hasContent: true
        });
      }
      
      // Check auto-generated captions
      const autoUrl = `https://video.google.com/timedtext?lang=${lang}&v=${videoId}&kind=asr`;
      const autoResponse = await axios.get(autoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 5000
      });
      
      if (autoResponse.data && autoResponse.data.includes('<text')) {
        availableLanguages.push({
          language: lang,
          type: 'auto-generated',
          hasContent: true
        });
      }
    } catch (error) {
      // Language not available, continue checking others
    }
  }
  
  res.json({
    videoId,
    availableLanguages,
    hasJapanese: availableLanguages.some(l => l.language.startsWith('ja'))
  });
});

// Unified endpoint that tries all methods
app.post('/extract-youtube-content', async (req, res) => {
  const { url, preferCaptions = true } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Could not extract video ID from URL' });
  }
  
  const response = {
    videoId,
    url,
    methods: {}
  };
  
  // Method 1: Try timedtext endpoint first
  if (preferCaptions) {
    try {
      console.log('Trying timedtext endpoint for captions...');
      const timedTextResult = await tryTimedText(videoId);
      
      if (timedTextResult && timedTextResult.success) {
        const transcript = parseCaptionData(timedTextResult.captions, timedTextResult.format);
        
        if (transcript.length > 0) {
          response.success = true;
          response.transcript = transcript;
          response.language = timedTextResult.language;
          response.isAutoGenerated = timedTextResult.isAutoGenerated;
          response.method = 'timedtext';
          response.methods.timedtext = { success: true, transcriptCount: transcript.length };
          
          return res.json(response);
        }
      }
      
      response.methods.timedtext = { success: false, error: 'No captions found via timedtext' };
    } catch (error) {
      response.methods.timedtext = { success: false, error: error.message };
    }
    
    // Method 2: Try YouTube API as fallback
    try {
      console.log('Trying YouTube API for captions...');
      const apiResult = await tryYouTubeAPI(videoId);
      
      if (apiResult && apiResult.success) {
        const transcript = parseCaptionData(apiResult.captions, apiResult.format);
        
        if (transcript.length > 0) {
          response.success = true;
          response.transcript = transcript;
          response.language = apiResult.language;
          response.isAutoGenerated = apiResult.isAutoGenerated;
          response.method = 'youtube-api';
          response.methods.youtubeApi = { success: true, transcriptCount: transcript.length };
          
          return res.json(response);
        }
      }
      
      response.methods.youtubeApi = { success: false, error: 'No captions found' };
    } catch (error) {
      response.methods.youtubeApi = { success: false, error: error.message };
    }
  }
  
  // Method 2: Try yt-dlp for subtitles
  try {
    console.log('Trying yt-dlp for subtitles...');
    const subtitleResult = await extractSubtitlesWithYtDlp(url);
    
    if (subtitleResult.success && subtitleResult.transcript.length > 0) {
      response.success = true;
      response.transcript = subtitleResult.transcript;
      response.language = subtitleResult.language;
      response.isAutoGenerated = subtitleResult.isAutoGenerated;
      response.method = 'yt-dlp-subtitles';
      response.methods.ytDlpSubtitles = { success: true, transcriptCount: subtitleResult.transcript.length };
      
      return res.json(response);
    }
    
    response.methods.ytDlpSubtitles = { success: false, error: subtitleResult.error || 'No subtitles found' };
  } catch (error) {
    response.methods.ytDlpSubtitles = { success: false, error: error.message };
  }
  
  // Method 3: Provide audio extraction option
  response.success = false;
  response.audioExtractionAvailable = true;
  response.message = 'No Japanese captions found. You can extract audio for AI transcription.';
  response.extractAudioEndpoint = '/extract-audio';
  
  res.json(response);
});

// Helper function to extract subtitles with yt-dlp
async function extractSubtitlesWithYtDlp(url) {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, `subs_${Date.now()}`);
    
    // Get video info
    const infoCmd = `yt-dlp --dump-json --no-warnings "${url}"`;
    const { stdout: infoOutput } = await execAsync(infoCmd);
    const videoInfo = JSON.parse(infoOutput);
    
    // Check for Japanese subtitles
    const subtitles = videoInfo.subtitles || {};
    const automaticCaptions = videoInfo.automatic_captions || {};
    
    let selectedLang = null;
    let isAutoGenerated = false;
    
    if (subtitles.ja || subtitles['ja-JP']) {
      selectedLang = subtitles.ja ? 'ja' : 'ja-JP';
    } else if (automaticCaptions.ja || automaticCaptions['ja-JP']) {
      selectedLang = automaticCaptions.ja ? 'ja' : 'ja-JP';
      isAutoGenerated = true;
    }
    
    if (!selectedLang) {
      return { success: false, error: 'No Japanese subtitles available' };
    }
    
    // Download subtitles
    const subsCmd = `yt-dlp --write-subs --write-auto-subs --sub-lang ${selectedLang} --skip-download --sub-format vtt --no-warnings -o "${outputPath}" "${url}"`;
    await execAsync(subsCmd);
    
    // Find and parse subtitle file
    const vttPath = `${outputPath}.${selectedLang}.vtt`;
    if (fs.existsSync(vttPath)) {
      const vttContent = fs.readFileSync(vttPath, 'utf8');
      const transcript = parseVTTToTranscript(vttContent);
      fs.unlinkSync(vttPath);
      
      return {
        success: true,
        transcript,
        language: selectedLang,
        isAutoGenerated
      };
    }
    
    return { success: false, error: 'Failed to download subtitles' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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
// Extract video ID from URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s]+)/,
    /youtube\.com\/v\/([^&\s]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Try YouTube timedtext endpoint first
async function tryTimedText(videoId) {
  try {
    // Try the timedtext endpoint for Japanese captions
    const timedTextUrl = `https://video.google.com/timedtext?lang=ja&v=${videoId}`;
    console.log('Trying timedtext endpoint:', timedTextUrl);
    
    const response = await axios.get(timedTextUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Language': 'ja,en;q=0.9',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`
      },
      timeout: 10000
    });
    
    if (response.data && response.data.includes('<text')) {
      console.log('Found captions via timedtext endpoint');
      return {
        success: true,
        captions: response.data,
        format: 'timedtext',
        language: 'ja',
        isAutoGenerated: false // We can't determine this from timedtext
      };
    }
    
    // Also try with auto-generated captions
    const autoTimedTextUrl = `https://video.google.com/timedtext?lang=ja&v=${videoId}&kind=asr`;
    const autoResponse = await axios.get(autoTimedTextUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Language': 'ja,en;q=0.9',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`
      },
      timeout: 10000
    });
    
    if (autoResponse.data && autoResponse.data.includes('<text')) {
      console.log('Found auto-generated captions via timedtext endpoint');
      return {
        success: true,
        captions: autoResponse.data,
        format: 'timedtext',
        language: 'ja',
        isAutoGenerated: true
      };
    }
  } catch (error) {
    console.log('Timedtext method failed:', error.message);
  }
  
  return null;
}

// Try YouTube Data API for captions (as fallback)
async function tryYouTubeAPI(videoId) {
  try {
    // Try multiple methods to get video info
    const methods = [
      {
        name: 'get_video_info',
        url: `https://www.youtube.com/get_video_info?video_id=${videoId}&hl=ja&el=detailpage&ps=default&gl=JP`
      },
      {
        name: 'get_video_info_embedded',
        url: `https://www.youtube.com/get_video_info?video_id=${videoId}&eurl=https://youtube.googleapis.com/v/${videoId}&hl=ja`
      }
    ];
    
    for (const method of methods) {
      try {
        console.log(`Trying ${method.name} for video info...`);
        const response = await axios.get(method.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'ja,en;q=0.9',
          }
        });
        
        const params = new URLSearchParams(response.data);
        const playerResponseStr = params.get('player_response');
        
        if (!playerResponseStr) {
          console.log(`No player_response in ${method.name}`);
          continue;
        }
        
        const playerResponse = JSON.parse(playerResponseStr);
        console.log('Player response status:', playerResponse.playabilityStatus?.status);
        
        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (captionTracks && captionTracks.length > 0) {
          console.log(`Found ${captionTracks.length} caption tracks via ${method.name}`);
          console.log('Available languages:', captionTracks.map(t => t.languageCode));
          
          // Look for Japanese captions
          const jaTrack = captionTracks.find(track => 
            track.languageCode === 'ja' || 
            track.languageCode === 'ja-JP' ||
            track.vssId?.includes('.ja')
          );
          
          if (jaTrack) {
            console.log('Found Japanese track:', jaTrack.languageCode, jaTrack.name?.simpleText);
            
            // Try to fetch the actual caption content
            try {
              const captionUrl = jaTrack.baseUrl;
              console.log('Fetching captions from:', captionUrl);
              
              const captionResponse = await axios.get(captionUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Referer': 'https://www.youtube.com/'
                }
              });
              
              return {
                success: true,
                captions: captionResponse.data,
                format: 'srv3',
                language: jaTrack.languageCode,
                isAutoGenerated: jaTrack.kind === 'asr' || jaTrack.vssId?.includes('.a.') || false
              };
            } catch (captionError) {
              console.error('Error fetching caption content:', captionError.message);
            }
          }
        }
      } catch (methodError) {
        console.error(`${method.name} failed:`, methodError.message);
      }
    }
  } catch (error) {
    console.log('YouTube API method failed:', error.message);
  }
  
  return null;
}

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
    
    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Could not extract video ID from URL' });
    }
    
    // Try YouTube API method first
    const apiResult = await tryYouTubeAPI(videoId);
    if (apiResult && apiResult.success) {
      console.log('Successfully got captions via YouTube API');
      
      // Parse the caption data
      const transcript = parseCaptionData(apiResult.captions, apiResult.format);
      
      return res.json({
        transcript,
        language: apiResult.language,
        isAutoGenerated: apiResult.isAutoGenerated,
        method: 'youtube-api'
      });
    }
    
    console.log('YouTube API method failed, falling back to yt-dlp...');
    
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
    
    // For Japanese shadowing, we only want Japanese subtitles
    
    if (!selectedLang) {
      return res.status(404).json({ 
        error: 'No Japanese subtitles found',
        message: 'This video does not have Japanese subtitles. You can upload the audio separately for AI transcription.',
        availableLanguages: Object.keys({...subtitles, ...automaticCaptions}),
        hasJapaneseAudio: videoInfo.language === 'ja' || (videoInfo.tags && videoInfo.tags.includes('japanese'))
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
      await downloadAudioWithRetry(url, outputPath);
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

// Parse caption data from YouTube API response
function parseCaptionData(captionData, format) {
  const transcript = [];
  
  try {
    if (typeof captionData === 'string') {
      if (format === 'timedtext') {
        // Parse timedtext XML format directly
        // Example: <text start="0" dur="5">Hello world</text>
        const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([^<]+)<\/text>/g;
        let match;
        let index = 1;
        
        while ((match = textRegex.exec(captionData)) !== null) {
          const start = parseFloat(match[1]);
          const duration = parseFloat(match[2]);
          const text = match[3]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
          
          if (text) {
            transcript.push({
              id: String(index++),
              text: text,
              startTime: start,
              endTime: start + duration,
              words: text.split(/[\s、。！？]/g).filter(w => w.length > 0)
            });
          }
        }
      } else {
        // Parse srv3/XML format using xml2js
        const parser = require('xml2js').parseString;
        
        parser(captionData, { explicitArray: false }, (err, result) => {
          if (!err && result && result.transcript && result.transcript.text) {
            const texts = Array.isArray(result.transcript.text) ? result.transcript.text : [result.transcript.text];
            
            texts.forEach((item, index) => {
              const start = parseFloat(item.$.start || 0);
              const duration = parseFloat(item.$.dur || 5);
              
              transcript.push({
                id: String(index + 1),
                text: item._ || item,
                startTime: start,
                endTime: start + duration,
                words: (item._ || item).split(/[\s、。！？]/g).filter(w => w.length > 0)
              });
            });
          }
        });
      }
    }
  } catch (error) {
    console.error('Error parsing caption data:', error);
  }
  
  return transcript;
}

// Parse VTT format to transcript
function parseVTTToTranscript(vttContent) {
  const transcript = [];
  const lines = vttContent.split('\n');
  let currentEntry = {};
  let id = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.includes('-->')) {
      const [start, end] = line.split('-->').map(t => t.trim());
      currentEntry.startTime = parseVTTTimestamp(start);
      currentEntry.endTime = parseVTTTimestamp(end);
    } else if (line && !line.startsWith('WEBVTT') && !line.includes('-->') && currentEntry.startTime !== undefined) {
      currentEntry.text = line;
      currentEntry.id = String(id++);
      currentEntry.words = line.split(/[\s、。！？]/g).filter(w => w.length > 0);
      transcript.push({ ...currentEntry });
      currentEntry = {};
    }
  }
  
  return transcript;
}

function parseVTTTimestamp(timestamp) {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
  } else if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return parseInt(minutes) * 60 + parseFloat(seconds);
  }
  return 0;
}

// Enhanced download with proxy and retry logic
async function downloadAudioWithRetry(url, outputPath, maxRetries = 3) {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Download attempt ${attempt}/${maxRetries}`);
      
      // Rotate user agent
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      // Add sleep between attempts
      if (attempt > 1) {
        const sleepTime = Math.min(5000 * (attempt - 1), 15000);
        console.log(`Sleeping for ${sleepTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
      
      await downloadAudio(url, outputPath, userAgent);
      return; // Success
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
}

function downloadAudio(url, outputPath, userAgent) {
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
      '--sleep-interval', '3',
      '--max-sleep-interval', '5',
      '--user-agent', userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      '-o', `${outputPath}.%(ext)s`,
      url
    ];
    
    // Add proxy if available
    const proxy = process.env.PROXY_URL;
    if (proxy) {
      ytDlpArgs.unshift('--proxy', proxy);
      console.log('Using proxy:', proxy);
    }
    
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