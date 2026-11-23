import http from 'node:http';
import { config } from './config.js';
import { loadFeed, loadFx } from './feed.js';
import { ensureProduct, cleanupOldProducts, stoneTitle } from './shopify.js';

const state = {
  stones: new Map(), // id -> stone
  list: [], // array for searching
  updatedAt: null,
  lastAttempt: null,
  lastError: null,
  rows: 0,
  fx: null,
  running: false,
};

const CLARITY = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1'];
const COLOUR = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];
const CUT = ['Ideal', 'Excellent', 'Very Good', 'Good', 'Fair'];

async function refresh() {
  if (state.running) return;
  state.running = true;
  state.lastAttempt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const fx = await loadFx();
    const { stones, rows } = await loadFeed(fx.rate);
    if (stones.size < 100) throw new Error(`Only ${stones.size} stones passed the filters out of ${rows} rows; keeping previous data`);
    state.stones = stones;
    state.list = [...stones.values()];
    state.rows = rows;
    state.fx = fx;
    state.updatedAt = new Date().toISOString();
    state.lastError = null;
    console.log(`Feed refreshed: ${stones.size} stones shown of ${rows} rows, FX ${fx.rate} (${fx.source}), ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    state.lastError = e.message;
    console.error('Feed refresh failed:', e.message);
  } finally {
    state.running = false;
  }
  cleanupOldProducts().then((n) => n && console.log(`Removed ${n} old diamond products`)).catch((e) => console.warn('Cleanup:', e.message));
}

// Run at the configured minutes past each hour (default :15 and :45).
function scheduleNext() {
  const now = new Date();
  const mins = [...config.refreshMinutes].sort((a, b) => a - b);
  let next = null;
  for (const m of mins) {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(m);
    if (d > now) { next = d; break; }
  }
  if (!next) {
    next = new Date(now);
    next.setHours(now.getHours() + 1, mins[0], 0, 0);
  }
  setTimeout(async () => { await refresh(); scheduleNext(); }, next - now);
  console.log('Next refresh at', next.toISOString());
}

const pub = ({ _usd, ...s }) => s; // never send the supplier price to browsers
const csv = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);
const n = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

function search(q) {
  const shapes = csv(q.get('shape')).map((s) => s.toLowerCase());
  const colours = csv(q.get('colour') || q.get('color')).map((s) => s.toUpperCase());
  const clarities = csv(q.get('clarity')).map((s) => s.toUpperCase());
  const cuts = csv(q.get('cut')).map((s) => s.toLowerCase());
  const labs = csv(q.get('lab')).map((s) => s.toUpperCase());
  const growths = csv(q.get('growth')).map((s) => s.toUpperCase());
  const cmin = n(q.get('cmin')), cmax = n(q.get('cmax')), pmin = n(q.get('pmin')), pmax = n(q.get('pmax'));
  const per = Math.min(Math.max(n(q.get('per')) || 24, 1), 60);
  const page = Math.max(n(q.get('page')) || 1, 1);
  const sort = q.get('sort') || 'price_asc';

  let r = state.list.filter((s) =>
    (!shapes.length || shapes.includes(s.shape.toLowerCase())) &&
    (!colours.length || colours.includes(s.colour)) &&
    (!clarities.length || clarities.includes(s.clarity)) &&
    (!cuts.length || cuts.includes((s.cut || '').toLowerCase())) &&
    (!labs.length || labs.includes(s.lab)) &&
    (!growths.length || growths.includes(s.growth)) &&
    (cmin === null || s.carat >= cmin) && (cmax === null || s.carat <= cmax) &&
    (pmin === null || s.price >= pmin) && (pmax === null || s.price <= pmax)
  );
  const [key, dir] = sort.split('_');
  const k = { price: 'price', carat: 'carat' }[key] || 'price';
  const sign = dir === 'desc' ? -1 : 1;
  r.sort((a, b) => sign * (a[k] - b[k]) || a.price - b.price);
  const total = r.length;
  return { total, page, per, pages: Math.ceil(total / per), updatedAt: state.updatedAt, items: r.slice((page - 1) * per, page * per).map(pub) };
}

function facets() {
  const shapes = {};
  let pmin = Infinity, pmax = 0, cmin = Infinity, cmax = 0;
  for (const s of state.list) {
    shapes[s.shape] = (shapes[s.shape] || 0) + 1;
    pmin = Math.min(pmin, s.price); pmax = Math.max(pmax, s.price);
    cmin = Math.min(cmin, s.carat); cmax = Math.max(cmax, s.carat);
  }
  return {
    total: state.list.length,
    updatedAt: state.updatedAt,
    shapes: Object.entries(shapes).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    colours: COLOUR.filter((c) => config.colours.includes(c)),
    clarities: CLARITY,
    cuts: CUT,
    price: { min: pmin === Infinity ? 0 : pmin, max: pmax },
    carat: { min: cmin === Infinity ? 0 : cmin, max: cmax },
  };
}

function send(res, code, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
  }
  res.writeHead(code, headers);
  res.end(code === 204 ? '' : JSON.stringify(body));
}

// Simple per-IP limit on cart requests (each one may create a Shopify product)
const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 10;
};

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') return send(res, 204, null, origin);
    if (p === '/' || p === '/health') {
      return send(res, 200, {
        ok: !!state.updatedAt, stones: state.list.length, rows: state.rows, updatedAt: state.updatedAt,
        lastAttempt: state.lastAttempt, lastError: state.lastError, fx: state.fx, refreshing: state.running,
        pricing: { markup: config.markup, extraAud: config.extraAud, fxBuffer: config.fxBuffer, roundTo: config.roundTo },
      }, origin);
    }
    if (p === '/api/facets' && req.method === 'GET') return send(res, 200, facets(), origin);
    if (p === '/api/diamonds' && req.method === 'GET') return send(res, 200, search(url.searchParams), origin);
    const m = p.match(/^\/api\/diamonds\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const s = state.stones.get(decodeURIComponent(m[1]));
      return s ? send(res, 200, pub(s), origin) : send(res, 404, { error: 'This diamond is no longer available.' }, origin);
    }
    if (p === '/api/cart-line' && req.method === 'POST') {
      if (!origin || !config.allowedOrigins.includes(origin)) return send(res, 403, { error: 'Not allowed' }, origin);
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'Too many requests, please try again in a minute.' }, origin);
      let body = '';
      for await (const c of req) { body += c; if (body.length > 2000) break; }
      const { id } = JSON.parse(body || '{}');
      const s = state.stones.get(String(id || ''));
      if (!s) return send(res, 404, { error: 'Sorry, this diamond has just sold. Please choose another.' }, origin);
      const gid = await ensureProduct(s);
      return send(res, 200, { variantId: Number(gid.split('/').pop()), price: s.price, title: stoneTitle(s) }, origin);
    }
    send(res, 404, { error: 'Not found' }, origin);
  } catch (e) {
    console.error(req.method, p, e.message);
    send(res, 500, { error: 'Something went wrong. Please try again or contact us.' }, origin);
  }
});

server.listen(config.port, () => {
  console.log(`Edee diamond feed listening on ${config.port}`);
  refresh().then(scheduleNext);
});

export { state, search, facets, refresh };
