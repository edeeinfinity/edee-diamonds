// Edee Infinity cart worker (Cloudflare Workers, free plan).
// POST /cart-line {id}  → checks the stone is in the latest published list, creates (or reuses) a hidden one-off
//                        Shopify product at the current price, returns the variant id for /cart/add.js.
// Daily cron            → deletes one-off diamond products older than PRODUCT_TTL_DAYS (orders keep their copy).
//
// Settings (Cloudflare → Workers → edee-cart → Settings → Variables and Secrets):
//   DATA_URL               e.g. https://<github-user>.github.io/edee-diamonds   (plain text)
//   ALLOWED_ORIGINS        https://edeeinfinity.com,https://www.edeeinfinity.com (plain text)
//   SHOPIFY_SHOP           u1us8c-vw.myshopify.com                               (plain text)
//   SHOPIFY_CLIENT_ID      from the Shopify Dev Dashboard app                    (secret)
//   SHOPIFY_CLIENT_SECRET  from the Shopify Dev Dashboard app                    (secret)
//   PRODUCT_TTL_DAYS       7                                                     (plain text, optional)

const API_VERSION = '2025-07';
let token = null, tokenExpires = 0, onlineStoreId = null;
const hits = new Map();

function bucketOf(id, n = 64) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h % n;
}

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || 'https://edeeinfinity.com,https://www.edeeinfinity.com').split(',').map((s) => s.trim());
  return allowed.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' }
    : null;
}

const json = (code, body, extra = {}) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

async function getToken(env) {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const res = await fetch(`https://${env.SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: String(env.SHOPIFY_CLIENT_ID || '').trim(), client_secret: String(env.SHOPIFY_CLIENT_SECRET || '').trim() }),
  });
  const raw = await res.text();
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  if (!res.ok || !j.access_token) {
    const text = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const at = Math.max(0, text.search(/error|invalid|not permitted|oauth/i) - 40);
    throw new Error(`Shopify token error ${res.status}: ${text.slice(at, at + 300)}`);
  }
  token = j.access_token;
  tokenExpires = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

async function gql(env, query, variables = {}) {
  const res = await fetch(`https://${env.SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': await getToken(env) },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

function check(d, key) {
  const e = d?.[key]?.userErrors;
  if (e && e.length) throw new Error(`${key}: ${e.map((x) => x.message).join('; ')}`);
}

async function onlineStore(env) {
  if (onlineStoreId) return onlineStoreId;
  const d = await gql(env, `{ publications(first: 20) { nodes { id name } } }`);
  const p = d.publications.nodes.find((n) => /online store/i.test(n.name));
  if (!p) throw new Error('Online Store publication not found');
  return (onlineStoreId = p.id);
}

const titleOf = (s) => `Lab-Grown Diamond ${s.carat.toFixed(2)} ct ${s.shape}, ${s.colour} ${s.clarity}, ${s.lab} ${s.cert}`;
const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function describe(s) {
  const rows = [
    ['Shape', s.shape], ['Carat', s.carat.toFixed(2)], ['Colour', s.colour], ['Clarity', s.clarity], ['Cut', s.cut],
    ['Polish', s.polish], ['Symmetry', s.symmetry], ['Fluorescence', s.fluorescence], ['Measurements (mm)', s.measurements],
    ['Growth', s.growth], ['Certificate', `${s.lab} ${s.cert}`],
  ].filter((r) => r[1]);
  return `<p>Certified lab-grown diamond, delivered fully insured in about 2–3 weeks (each stone is shipped to us from our cutting partner in India). We confirm this stone within 24 hours of your order; if it has sold, we will offer a matching alternative or a full refund.</p>
<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${escHtml(v)}</td></tr>`).join('')}</table>`;
}

async function ensureProduct(env, s) {
  const handle = `lab-diamond-${s.id}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const price = Number(s.price).toFixed(2);
  const found = await gql(env, `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id status variants(first: 1) { nodes { id price } } } }`, { h: handle });
  const ex = found.productByIdentifier;
  if (ex && ex.status === 'ACTIVE') {
    const v = ex.variants.nodes[0];
    if (Number(v.price).toFixed(2) !== price) {
      const d = await gql(env, `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`, { p: ex.id, v: [{ id: v.id, price }] });
      check(d, 'productVariantsBulkUpdate');
    }
    return v.id;
  }
  const c = await gql(env, `mutation($p: ProductCreateInput!, $m: [CreateMediaInput!]) {
      productCreate(product: $p, media: $m) { product { id variants(first: 1) { nodes { id } } } userErrors { message } } }`, {
    p: {
      title: titleOf(s), handle, status: 'ACTIVE', vendor: 'Edee Infinity', productType: 'Loose Diamond',
      tags: ['loose-diamond', 'feed-stone'], descriptionHtml: describe(s),
      metafields: [{ namespace: 'seo', key: 'hidden', type: 'number_integer', value: '1' }],
    },
    m: s.image ? [{ originalSource: s.image, mediaContentType: 'IMAGE', alt: titleOf(s) }] : [],
  });
  check(c, 'productCreate');
  const pid = c.productCreate.product.id, vid = c.productCreate.product.variants.nodes[0].id;
  const u = await gql(env, `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`, {
    p: pid, v: [{ id: vid, price, taxable: true, inventoryPolicy: 'CONTINUE', inventoryItem: { sku: s.id, tracked: false, requiresShipping: true } }],
  });
  check(u, 'productVariantsBulkUpdate');
  const pub = await gql(env, `mutation($id: ID!, $p: [PublicationInput!]!) { publishablePublish(id: $id, input: $p) { userErrors { message } } }`, { id: pid, p: [{ publicationId: await onlineStore(env) }] });
  check(pub, 'publishablePublish');
  return vid;
}

async function findStone(env, id) {
  const meta = await (await fetch(`${env.DATA_URL}/meta.json`, { cf: { cacheTtl: 60 } })).json();
  const b = await (await fetch(`${env.DATA_URL}/d/${bucketOf(id, meta.buckets || 64)}.json`, { cf: { cacheTtl: 60 } })).json();
  return b[id] || null;
}

async function cleanup(env) {
  const days = Number(env.PRODUCT_TTL_DAYS || 7);
  const before = new Date(Date.now() - days * 86400_000).toISOString();
  const d = await gql(env, `query($q: String!) { products(first: 100, query: $q) { nodes { id } } }`, { q: `tag:feed-stone AND created_at:<'${before}'` });
  for (const p of d.products.nodes) await gql(env, `mutation($i: ProductDeleteInput!) { productDelete(input: $i) { userErrors { message } } }`, { i: { id: p.id } });
  return d.products.nodes.length;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    const h = cors(env, origin) || {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (url.pathname === '/' || url.pathname === '/health') {
      return json(200, { ok: true, shopifyConfigured: !!(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET), dataUrl: env.DATA_URL || null });
    }
    if (url.pathname === '/cart-line' && req.method === 'POST') {
      if (!cors(env, origin)) return json(403, { error: 'Not allowed' });
      const ip = req.headers.get('cf-connecting-ip') || '';
      const now = Date.now();
      const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      list.push(now); hits.set(ip, list);
      if (list.length > 10) return json(429, { error: 'Too many requests, please try again in a minute.' }, h);
      try {
        const { id } = await req.json();
        const s = id ? await findStone(env, String(id)) : null;
        if (!s) return json(404, { error: 'Sorry, this diamond has just sold. Please choose another.' }, h);
        const gid = await ensureProduct(env, s);
        return json(200, { variantId: Number(gid.split('/').pop()), price: s.price, title: titleOf(s) }, h);
      } catch (e) {
        console.error('cart-line', e.message);
        return json(500, { error: 'Something went wrong. Please try again or contact us.' }, h);
      }
    }
    return json(404, { error: 'Not found' }, h);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env).then((n) => console.log(`Removed ${n} old diamond products`)).catch((e) => console.error('cleanup', e.message)));
  },
};
