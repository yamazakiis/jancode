require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB } = require('./db');
const { searchByJan, getItems, getItemsByJan, getSearchHistory, debugRakuten } = require('./routes/items');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/search', searchByJan);
app.get('/api/items', getItems);
app.get('/api/items/:jan', getItemsByJan);
app.get('/api/history', getSearchHistory);
app.get('/api/debug', debugRakuten);

// DB を一度だけ初期化（サーバーレス環境でのウォームキープ対応）
let _dbInit;
const ensureDB = () => (_dbInit ??= initDB());

app.use((req, res, next) => {
  ensureDB().then(() => next()).catch(() => res.status(500).json({ error: 'DB接続エラー' }));
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  ensureDB()
    .then(() => app.listen(PORT, () => console.log(`http://localhost:${PORT}`)))
    .catch((err) => { console.error('DB初期化失敗:', err.message); process.exit(1); });
}

module.exports = app;
