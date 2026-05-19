require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB } = require('./db');
const { searchByJan, getItems, getItemsByJan, getSearchHistory } = require('./routes/items');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/search', searchByJan);
app.get('/api/items', getItems);
app.get('/api/items/:jan', getItemsByJan);
app.get('/api/history', getSearchHistory);

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => app.listen(PORT, () => console.log(`http://localhost:${PORT}`)))
  .catch((err) => {
    console.error('DB初期化失敗:', err.message);
    process.exit(1);
  });
