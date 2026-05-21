const { pool } = require('../db');
const axios = require('axios');

const RAKUTEN_API = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401';

const APP_URL = process.env.APP_URL || 'https://jancode-theta.vercel.app/';
const RAKUTEN_HEADERS = { Referer: APP_URL, Origin: APP_URL };

async function searchByJan(req, res) {
  const { janCode } = req.body;
  if (!janCode || !/^\d{8,13}$/.test(janCode.trim())) {
    return res.status(400).json({ error: 'JANコードは8〜13桁の数字で入力してください' });
  }
  const jan = janCode.trim();

  try {
    const url = new URL(RAKUTEN_API);
    url.searchParams.set('keyword', jan);
    url.searchParams.set('applicationId', process.env.RAKUTEN_APP_ID);
    url.searchParams.set('accessKey', process.env.RAKUTEN_ACCESS_KEY);
    url.searchParams.set('hits', '30');
    url.searchParams.set('formatVersion', '2');
    const affiliateId = process.env.RAKUTEN_AFFILIATE_ID || process.env.RAKUTEN_affiliate_id;
    if (affiliateId) {
      url.searchParams.set('affiliateId', affiliateId);
    }

    let data;
    try {
      ({ data } = await axios.get(url.toString(), { headers: RAKUTEN_HEADERS }));
    } catch (axiosErr) {
      const errData = axiosErr.response?.data;
      return res.status(400).json({ error: errData?.errors?.errorMessage || 'Rakuten API error', _raw: errData });
    }

    if (data.errors) {
      return res.status(400).json({ error: data.errors?.errorMessage || 'Rakuten API error', _raw: data });
    }

    // 新APIは formatVersion=2 でもキーは Items（大文字）
    const rawItems = data.Items || [];

    // 検索履歴を記録
    const { rows } = await pool.query(
      'INSERT INTO jan_searches (jan_code, total_count) VALUES ($1, $2) RETURNING id',
      [jan, data.count || 0]
    );
    const searchId = rows[0].id;

    // 取得した全商品を保存
    for (const item of rawItems) {
      const imageUrl =
        item.mediumImageUrls?.[0]?.imageUrl ||
        item.smallImageUrls?.[0]?.imageUrl ||
        null;

      await pool.query(
        `INSERT INTO rakuten_items
           (search_id, jan_code, item_code, item_name, shop_name, shop_code,
            item_price, review_average, review_count, item_url, image_url, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          searchId,
          jan,
          item.itemCode,
          item.itemName,
          item.shopName,
          item.shopCode,
          item.itemPrice,
          item.reviewAverage || null,
          item.reviewCount || 0,
          item.itemUrl,
          imageUrl,
          item,
        ]
      );
    }

    res.json({ searchId, count: rawItems.length, items: rawItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '検索中にエラーが発生しました' });
  }
}

async function getItems(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, s.searched_at AS search_date
      FROM rakuten_items r
      JOIN jan_searches s ON s.id = r.search_id
      ORDER BY r.created_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
}

async function getItemsByJan(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, s.searched_at AS search_date
       FROM rakuten_items r
       JOIN jan_searches s ON s.id = r.search_id
       WHERE r.jan_code = $1
       ORDER BY r.created_at DESC`,
      [req.params.jan]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
}

async function getSearchHistory(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, COUNT(r.id)::int AS item_count
      FROM jan_searches s
      LEFT JOIN rakuten_items r ON r.search_id = s.id
      GROUP BY s.id
      ORDER BY s.searched_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
}

async function fetchAndSave(jan) {
  const url = new URL(RAKUTEN_API);
  url.searchParams.set('keyword', jan);
  url.searchParams.set('applicationId', process.env.RAKUTEN_APP_ID);
  url.searchParams.set('accessKey', process.env.RAKUTEN_ACCESS_KEY);
  url.searchParams.set('hits', '30');
  url.searchParams.set('formatVersion', '2');
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID || process.env.RAKUTEN_affiliate_id;
  if (affiliateId) url.searchParams.set('affiliateId', affiliateId);

  const { data } = await axios.get(url.toString(), { headers: RAKUTEN_HEADERS });
  if (data.errors) throw new Error(data.errors?.errorMessage || 'Rakuten API error');

  const rawItems = data.Items || [];

  const { rows } = await pool.query(
    'INSERT INTO jan_searches (jan_code, total_count) VALUES ($1, $2) RETURNING id',
    [jan, data.count || 0]
  );
  const searchId = rows[0].id;

  for (const item of rawItems) {
    const imageUrl =
      item.mediumImageUrls?.[0]?.imageUrl ||
      item.smallImageUrls?.[0]?.imageUrl ||
      null;
    await pool.query(
      `INSERT INTO rakuten_items
         (search_id, jan_code, item_code, item_name, shop_name, shop_code,
          item_price, review_average, review_count, item_url, image_url, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        searchId, jan, item.itemCode, item.itemName, item.shopName, item.shopCode,
        item.itemPrice, item.reviewAverage || null, item.reviewCount || 0,
        item.itemUrl, imageUrl, item,
      ]
    );
  }
  return { searchId, count: rawItems.length, items: rawItems };
}

async function ensureDbData(jan) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM rakuten_items WHERE jan_code = $1 LIMIT 1',
    [jan]
  );
  if (rowCount === 0) await fetchAndSave(jan);
}

async function getDbData(req, res) {
  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: 'janパラメータが必要です' });
  try {
    await ensureDbData(jan);
    const { rows } = await pool.query(
      `SELECT r.*, s.searched_at AS search_date
       FROM rakuten_items r
       JOIN jan_searches s ON s.id = r.search_id
       WHERE r.jan_code = $1
       ORDER BY r.created_at DESC`,
      [jan]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
}

async function getItemName(req, res) {
  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: 'janパラメータが必要です' });
  try {
    await ensureDbData(jan);
    const { rows } = await pool.query(
      `SELECT DISTINCT item_name
       FROM rakuten_items
       WHERE jan_code = $1
       ORDER BY item_name`,
      [jan]
    );
    res.json(rows.map(r => r.item_name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得中にエラーが発生しました' });
  }
}

async function debugRakuten(req, res) {
  const jan = req.query.jan || '4904530125775';
  try {
    await ensureDbData(jan);
    const { rows } = await pool.query(
      `SELECT r.*, s.searched_at AS search_date
       FROM rakuten_items r
       JOIN jan_searches s ON s.id = r.search_id
       WHERE r.jan_code = $1
       ORDER BY r.created_at DESC`,
      [jan]
    );
    res.json({ jan, count: rows.length, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'デバッグ中にエラーが発生しました', detail: err.message });
  }
}

module.exports = { searchByJan, getItems, getItemsByJan, getSearchHistory, getDbData, getItemName, debugRakuten };
