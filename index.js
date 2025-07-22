const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Simple test server working!' });
});

app.listen(PORT, () => {
  console.log(`Simple server running on port ${PORT}`);
});