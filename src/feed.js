import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { config } from './config.js';

const SHAPES = {
  'ELONGATED CUSHION': 'Elongated Cushion',
  'CUSHION MODIFIED': 'Cushion',
  'CUSHION BRILLIANT': 'Cushion',
  'SQ EMERALD': 'Asscher',
  'SQUARE EMERALD': 'Asscher',
};
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const normShape = (s) => {
  const u = (s || '').trim().toUpperCase();
  return SHAPES[u] || title(u);
};
const grade = (s) => {
  const u = (s || '').trim().toUpperCase();
  return { ID: 'Ideal', EX: 'Excellent', '8X': 'Excellent', VG: 'Very Good', GD: 'Good', G: 'Good', FR: 'Fair', F: 'Fair' }[u] || '';
};
const growth = (s) => (/cvd/i.test(s || '') ? 'CVD' : /hpht/i.test(s || '') ? 'HPHT' : '');
const truthy = (s) => /^(true|1|yes)$/i.test((s || '').trim());

// Which detail file a stone lives in. The same function is used by the website and the cart worker.
export function bucketOf(id, n = 64) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h % n;
}

export function certUrl(lab, cert) {
  if (!cert) return '';
  if (lab === 'GIA') return `https://www.gia.edu/report-check?reportno=${encodeURIComponent(cert)}`;
  return `https://www.igi.org/verify-your-report/?r=${encodeURIComponent(cert)}`;
}

export function retailAud(usd, fx) {
  const raw = usd * fx * (1 + config.fxBuffer) * config.markup + config.extraAud;
  return Math.ceil(raw / config.roundTo) * config.roundTo;
}

// Turn one supplier row into a public stone (no supplier price) or null if it shouldn't be shown.
export function toStone(r, fx) {
  const status = (r.status || '').trim();
  const lab = (r.lab || '').trim().toUpperCase();
  const colour = (r.color || '').trim().toUpperCase();
  const carat = Number(r.weight);
  const usd = Number(r.finalPrice);
  const cert = (r.certificateNumber || '').trim();
  const image = (r.diamondImage || '').trim();
  if (!config.statuses.includes(status)) return null;
  if (!config.labs.includes(lab)) return null;
  if (!config.colours.includes(colour)) return null;
  if ((r.fancyColor || '').trim()) return null;
  if (!(carat >= config.minCarat) || !(usd > 0) || !cert || !r.stockId) return null;
  if (config.requirePhoto && (!image || truthy(r.isImageBroken))) return null;
  const shape = normShape(r.shape);
  const g = growth(r.growthType);
  return {
    id: String(r.stockId).trim(),
    shape,
    carat: Math.round(carat * 100) / 100,
    colour,
    clarity: (r.clarity || '').trim().toUpperCase(),
    cut: grade(r.cut),
    polish: grade(r.polish),
    symmetry: grade(r.symmetry),
    fluorescence: (r.fluorescenceIntensity || '').replace(/^none$/i, 'None').trim(),
    lab,
    cert,
    certUrl: certUrl(lab, cert),
    growth: g,
    measurements: (r.measurements || '').replace(/\*/g, ' × ').trim(),
    lw: Number(r.lwRatio) || null,
    depth: Number(r.depth) || null,
    table: Number(r.table) || null,
    image,
    video: (r.diamondVideo || '').trim(),
    price: retailAud(usd, fx),
    // kept server-side only (stripped before sending to browsers)
    _usd: usd,
  };
}

// Download and parse the whole feed. Returns { stones, rows, kept }.
export async function loadFeed(fx, url = config.feedUrl) {
  if (!url) throw new Error('FEED_URL is not set');
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  const parser = Readable.fromWeb(res.body).pipe(
    parse({ columns: true, relax_column_count: true, skip_empty_lines: true, trim: false, bom: true })
  );
  const stones = new Map();
  let rows = 0;
  for await (const r of parser) {
    rows++;
    const s = toStone(r, fx);
    if (s && !stones.has(s.id)) stones.set(s.id, s);
  }
  return { stones, rows };
}

export async function loadFx() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD', { signal: AbortSignal.timeout(15_000) });
    const j = await r.json();
    const v = Number(j?.rates?.AUD);
    if (v > 0.5 && v < 5) return { rate: v, source: 'frankfurter (ECB)', date: j.date };
  } catch (e) {
    console.warn('FX fetch failed:', e.message);
  }
  return { rate: config.fxFallback, source: 'fallback', date: null };
}
