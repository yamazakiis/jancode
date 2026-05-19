require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jan_searches (
      id          SERIAL PRIMARY KEY,
      jan_code    VARCHAR(20)  NOT NULL,
      total_count INTEGER      NOT NULL DEFAULT 0,
      searched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rakuten_items (
      id             SERIAL PRIMARY KEY,
      search_id      INTEGER      REFERENCES jan_searches(id) ON DELETE CASCADE,
      jan_code       VARCHAR(20)  NOT NULL,
      item_code      VARCHAR(100),
      item_name      TEXT,
      shop_name      TEXT,
      shop_code      VARCHAR(100),
      item_price     INTEGER,
      review_average NUMERIC(4,2),
      review_count   INTEGER      NOT NULL DEFAULT 0,
      item_url       TEXT,
      image_url      TEXT,
      raw_data       JSONB        NOT NULL,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_rakuten_items_jan_code ON rakuten_items(jan_code);
  `);
  console.log('DB initialized');
}

module.exports = { pool, initDB };
