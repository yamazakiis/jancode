const { pool } = require('../db');

const RAKUTEN_API = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401';

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

    const apiRes = await fetch(url.toString(), {
      headers: {
        Referer: process.env.APP_URL || 'https://jancode-theta.vercel.app/',
        Origin: process.env.APP_URL || 'https://jancode-theta.vercel.app/',
      },
    });
    const data = await apiRes.json();

    if (!apiRes.ok || data.errors) {
      return res.status(400).json({ error: data.errors?.errorMessage || 'Rakuten API error', _raw: data });
    }

    // formatVersion=2 ではフラット構造: data.items[i].itemName
    const rawItems = data.items || [];
    if (rawItems.length === 0) {
      return res.json({ searchId: null, count: 0, items: [], _debug: data });
    }

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

async function debugRakuten(req, res) {
  const jan = req.query.jan || '4904530125775';
  const url = new URL(RAKUTEN_API);
  url.searchParams.set('keyword', jan);
  url.searchParams.set('applicationId', process.env.RAKUTEN_APP_ID);
  url.searchParams.set('accessKey', process.env.RAKUTEN_ACCESS_KEY);
  url.searchParams.set('hits', '5');
  url.searchParams.set('formatVersion', '2');
  const apiRes = await fetch(url.toString(), {
    headers: { Referer: process.env.APP_URL || 'https://jancode-theta.vercel.app/' },
  });
  const data = await apiRes.json();
  res.json({ requestUrl: url.toString().replace(process.env.RAKUTEN_ACCESS_KEY, '***'), status: apiRes.status, data });
}

module.exports = { searchByJan, getItems, getItemsByJan, getSearchHistory, debugRakuten };
