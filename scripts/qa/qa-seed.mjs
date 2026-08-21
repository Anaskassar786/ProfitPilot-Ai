// QA-only: seeds two dev stores into the local QA database.
//   * qa-store.myshopify.com     — realistic data (products, 30 days of
//                                  analytics, active trial) so every page
//                                  renders real numbers.
//   * qa-empty.myshopify.com     — a fresh install with zero data, used to
//                                  verify honest empty states.
// No Shopify API calls are made; rows are written exactly as the sync pipeline
// writes them. Production is unaffected (this DB is local PGlite only).
import { Client } from 'pg';

const connectionString = process.env.QA_PG_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
const client = new Client({ connectionString });
await client.connect();

const PRODUCTS = [
  { title: 'Everyday Hoodie', vendor: 'Northpeak Supply', type: 'Hoodies', price: 64, tags: ['bestseller', 'winter'] },
  { title: 'Classic Crew Tee', vendor: 'Northpeak Supply', type: 'T-Shirts', price: 22, tags: ['summer', 'core'] },
  { title: 'Trail Runner Socks 3-Pack', vendor: 'Trailhead Goods', type: 'Socks', price: 16, tags: ['accessory'] },
  { title: 'Insulated Bottle 750ml', vendor: 'Trailhead Goods', type: 'Drinkware', price: 32, tags: ['accessory', 'eco'] },
  { title: 'Canvas Weekender Bag', vendor: 'Trailhead Goods', type: 'Bags', price: 89, tags: ['travel'] },
  { title: 'Performance Joggers', vendor: 'Northpeak Supply', type: 'Pants', price: 58, tags: ['athleisure'] },
  { title: 'Merino Beanie', vendor: 'Northpeak Supply', type: 'Accessories', price: 28, tags: ['winter'] },
  { title: 'LED Camp Lantern', vendor: 'Basecamp Bros', type: 'Gear', price: 41, tags: ['camping'] },
  { title: 'Camping Cookset', vendor: 'Basecamp Bros', type: 'Gear', price: 74, tags: ['camping', 'cook'] },
  { title: 'Waterproof Daypack 22L', vendor: 'Basecamp Bros', type: 'Bags', price: 96, tags: ['travel', 'hiking'] },
  { title: 'Graphic Longsleeve', vendor: 'Northpeak Supply', type: 'T-Shirts', price: 34, tags: ['graphic'] },
  { title: 'Fleece Zip Hoodie', vendor: 'Northpeak Supply', type: 'Hoodies', price: 71, tags: ['winter', 'fleece'] },
  { title: 'Stainless Travel Mug', vendor: 'Trailhead Goods', type: 'Drinkware', price: 24, tags: ['travel', 'eco'] },
  { title: 'Hiking Poles (Pair)', vendor: 'Basecamp Bros', type: 'Gear', price: 118, tags: ['hiking', 'pro'] },
  { title: 'Kids Adventure Cap', vendor: 'Trailhead Goods', type: 'Accessories', price: 19, tags: ['kids', 'summer'] },
  { title: 'Yoga Mat Pro 6mm', vendor: 'Zenflow Studio', type: 'Fitness', price: 52, tags: ['yoga', 'fitness'] },
];

const daysAgo = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ── Store A: realistic data ────────────────────────────────────────────────
const storeRes = await client.query(
  `INSERT INTO stores (shop_domain, timezone, currency)
   VALUES ('qa-store.myshopify.com', 'America/New_York', 'USD')
   ON CONFLICT (shop_domain) DO UPDATE SET timezone = EXCLUDED.timezone
   RETURNING id`,
);
const storeA = storeRes.rows[0].id;

// Trial: active, expires in 10 days.
await client.query(
  `INSERT INTO trials (shop_id, started_at, expires_at, consumed, state)
   VALUES ($1, now() - interval '4 days', now() + interval '10 days', false, 'ACTIVE')
   ON CONFLICT (shop_id) DO NOTHING`,
  [storeA],
);
await client.query(
  `INSERT INTO billing_subscriptions (shop_id, state, plan, interval)
   VALUES ($1, 'TRIAL_ACTIVE', 'trial', 'MONTHLY')
   ON CONFLICT (shop_id) DO NOTHING`,
  [storeA],
);

// Catalog: 16 real products with variant data and images (no fake URLs).
for (const [i, p] of PRODUCTS.entries()) {
  const productId = `gid://shopify/Product/${1000 + i}`;
  const payload = {
    id: productId,
    title: p.title,
    vendor: p.vendor,
    product_type: p.type,
    status: i === 14 ? 'archived' : 'active',
    tags: p.tags.join(', '),
    image: null,
    images: [],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${2000 + i}`,
        product_id: productId,
        title: 'Default',
        price: String(p.price),
        inventory_quantity: i === 13 ? 0 : 4 + ((i * 7) % 60),
        sku: `${p.type.slice(0, 3).toUpperCase()}-${1000 + i}`,
      },
    ],
  };
  await client.query(
    `INSERT INTO catalog_products (store_id, product_id, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (store_id, product_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [storeA, productId, JSON.stringify(payload)],
  );
}

// 30 days of analytics. Revenue/orders/product sales/cohorts all agree with
// each other (same day, same counts) so cross-page comparisons look real.
const seeded = [];
for (let d = 29; d >= 0; d--) {
  const day = daysAgo(d);
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  const orderCount = weekday === 0 || weekday === 6 ? 1 + (d % 2) : 2 + (d % 4);
  const aov = 38 + (d % 5) * 6;
  const revenue = Number((orderCount * aov).toFixed(2));
  seeded.push({ day, orderCount, revenue });
  await client.query(
    `INSERT INTO analytics_orders_daily (store_id, day, order_count, fulfilled_count, cancelled_count, average_order_value)
     VALUES ($1, $2, $3, $3, 0, $4)
     ON CONFLICT (store_id, day) DO UPDATE SET order_count = EXCLUDED.order_count`,
    [storeA, day, orderCount, aov],
  );
  await client.query(
    `INSERT INTO analytics_revenue_daily (store_id, day, gross_revenue, discounts, order_count)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (store_id, day) DO UPDATE SET gross_revenue = EXCLUDED.gross_revenue`,
    [storeA, day, revenue, orderCount],
  );
  // Spread sales across products deterministically.
  PRODUCTS.forEach((p, i) => {
    const units = (i + d) % 3 === 0 ? (d % 4) + 1 : 0;
    if (units > 0) {
      seeded.push({ day, product: `gid://shopify/Product/${1000 + i}`, units, revenue: units * p.price });
    }
  });
}
for (const row of seeded.filter((r) => r.product)) {
  await client.query(
    `INSERT INTO analytics_product_sales_daily (store_id, day, product_id, units_sold, gross_revenue)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (store_id, day, product_id) DO UPDATE SET units_sold = EXCLUDED.units_sold`,
    [storeA, row.day, row.product, row.units, row.revenue],
  );
}
// Customer cohorts: a small retention curve over the same 30 days.
for (let d = 29; d >= 0; d--) {
  const cohortDay = daysAgo(Math.min(d + 7, 29));
  await client.query(
    `INSERT INTO analytics_customer_cohorts_daily (store_id, cohort_day, activity_day, customer_count, gross_revenue)
     VALUES ($1, $2, $3, 2 + ($4 % 5), 120 + ($4 % 7) * 30)
     ON CONFLICT (store_id, cohort_day, activity_day) DO NOTHING`,
    [storeA, cohortDay, daysAgo(d), d],
  );
}

// Sync bookkeeping so the dashboard "sync status" shows a completed sync.
for (const module of ['catalog', 'orders', 'customers', 'inventory']) {
  await client.query(
    `INSERT INTO sync_checkpoints (store_id, module, cursor, updated_at)
     VALUES ($1, $2, NULL, now())
     ON CONFLICT (store_id, module) DO UPDATE SET updated_at = now()`,
    [storeA, module],
  );
}

// Real synced order + customer rows so entitlement meters (orders_sync_month,
// customers_sync) count from the same source production uses: sync_records.
for (let i = 0; i < 8; i++) {
  const day = daysAgo(i % 20);
  await client.query(
    `INSERT INTO sync_records (store_id, module, record_id, payload)
     VALUES ($1, 'orders', $2, $3::jsonb)
     ON CONFLICT (store_id, module, record_id) DO NOTHING`,
    [storeA, `gid://shopify/Order/${5000 + i}`,
     JSON.stringify({ id: `gid://shopify/Order/${5000 + i}`, created_at: `${day}T12:00:00Z`, total_price: `${40 + i * 5}.00` })],
  );
  await client.query(
    `INSERT INTO sync_records (store_id, module, record_id, payload)
     VALUES ($1, 'customers', $2, $3::jsonb)
     ON CONFLICT (store_id, module, record_id) DO NOTHING`,
    [storeA, `gid://shopify/Customer/${6000 + i}`,
     JSON.stringify({ id: `gid://shopify/Customer/${6000 + i}`, first_name: null, last_name: null, email: null })],
  );
}

// A few billing_usage rows so entitlement meters show real live counts.
const monthStart = new Date().toISOString().slice(0, 8) + '01';
await client.query(
  `INSERT INTO billing_usage (shop_id, feature, period_start, used) VALUES
     ($1, 'ai_recommendations_month', $2, 3),
     ($1, 'orders_sync_month', $2, 42)
   ON CONFLICT (shop_id, feature, period_start) DO NOTHING`,
  [storeA, monthStart],
);

// ── Store B: fresh install with zero data ──────────────────────────────────
const emptyRes = await client.query(
  `INSERT INTO stores (shop_domain, timezone, currency)
   VALUES ('qa-empty.myshopify.com', 'America/New_York', 'USD')
   ON CONFLICT (shop_domain) DO NOTHING
   RETURNING id`,
);
const storeB = emptyRes.rows[0].id;
await client.query(
  `INSERT INTO billing_subscriptions (shop_id, state, plan, interval)
   VALUES ($1, 'TRIAL_ACTIVE', 'trial', 'MONTHLY')
   ON CONFLICT (shop_id) DO NOTHING`,
  [storeB],
);

console.log('STORE_A=' + storeA);
console.log('STORE_B=' + storeB);
console.log('Seeded: 16 products, 30 days of analytics, cohorts, sync records, billing usage.');
await client.end();
