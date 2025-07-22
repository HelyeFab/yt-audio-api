const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
    res.status(500).json({ error: 'Failed to process audio' });
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});