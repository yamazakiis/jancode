const { pool } = require('../db');

const RAKUTEN_API = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706';

async function searchByJan(req, res) {
  const { janCode } = req.body;
  if (!janCode || !/^\d{8,13}$/.test(janCode.trim())) {
    return res.status(400).json({ error: 'JANコードは8〜13桁の数字で入力してください' });
  }
  const jan = janCode.trim();

  try {
    const url = new URL(RAKUTEN_API);
    url.searchParams.set('format', 'json');
    url.searchParams.set('keyword', jan);
    url.searchParams.set('applicationId', process.env.RAKUTEN_APP_ID);
    url.searchParams.set('hits', '30');

    const apiRes = await fetch(url.toString());
    const data = await apiRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }

    const rawItems = data.Items || [];

    // 検索履歴を記録
    const { rows } = await pool.query(
      'INSERT INTO jan_searches (jan_code, total_count) VALUES ($1, $2) RETURNING id',
      [jan, data.count || 0]
    );
    const searchId = rows[0].id;

    // 取得した全商品を保存
    for (const { Item } of rawItems) {
      const imageUrl =
        Item.mediumImageUrls?.[0]?.imageUrl ||
        Item.smallImageUrls?.[0]?.imageUrl ||
        null;

      await pool.query(
        `INSERT INTO rakuten_items
           (search_id, jan_code, item_code, item_name, shop_name, shop_code,
            item_price, review_average, review_count, item_url, image_url, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          searchId,
          jan,
          Item.itemCode,
          Item.itemName,
          Item.shopName,
          Item.shopCode,
          Item.itemPrice,
          Item.reviewAverage || null,
          Item.reviewCount || 0,
          Item.itemUrl,
          imageUrl,
          Item,
        ]
      );
    }

    res.json({ searchId, count: rawItems.length, items: rawItems.map((i) => i.Item) });
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

module.exports = { searchByJan, getItems, getItemsByJan, getSearchHistory };
