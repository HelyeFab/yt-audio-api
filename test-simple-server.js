const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Simple health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Simple test server is running',
    port: PORT,
    time: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server started on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});