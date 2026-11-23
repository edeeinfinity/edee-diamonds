// Download the supplier feed, keep the stones we sell, price them in AUD and write static files for the website.
//   public/meta.json        last update, exchange rate, filter lists
//   public/stones.json      compact list used by the search page (no supplier prices)
//   public/d/<0-63>.json    full public details per stone (used by the detail view and the cart worker)
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { loadFeed, loadFx, bucketOf } from '../src/feed.js';

const CLARITY = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1'];
const CUT = ['Ideal', 'Excellent', 'Very Good', 'Good', 'Fair'];

async function previousCount(dir) {
  try { return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')).count || 0; } catch { return 0; }
}

async function main() {
  const t0 = Date.now();
  const fx = await loadFx();
  const { stones, rows } = await loadFeed(fx.rate);
  const list = [...stones.values()];
  if (list.length < 100) throw new Error(`Only ${list.length} stones passed the filters out of ${rows} rows; not publishing`);

  const dict = (key) => [...new Set(list.map((s) => s[key]).filter(Boolean))].sort();
  const shapes = dict('shape');
  const colours = config.colours.filter((c) => list.some((s) => s.colour === c));
  const clarities = CLARITY.filter((c) => list.some((s) => s.clarity === c));
  const cuts = ['', ...CUT];
  const labs = config.labs;
  const growths = ['', 'CVD', 'HPHT'];
  // image URLs share long prefixes; store them once
  const prefixes = [];
  const img = (u) => {
    const i = u.lastIndexOf('/', u.lastIndexOf('/') - 1) + 1;
    const p = u.slice(0, i);
    let k = prefixes.indexOf(p);
    if (k < 0) { k = prefixes.length; prefixes.push(p); }
    return [k, u.slice(i)];
  };

  // columns: id, shape, carat, colour, clarity, cut, lab, growth, price, imgPrefix, imgRest
  const compact = list.map((s) => {
    const [ip, ir] = s.image ? img(s.image) : [-1, ''];
    return [s.id, shapes.indexOf(s.shape), s.carat, colours.indexOf(s.colour), clarities.indexOf(s.clarity),
      cuts.indexOf(s.cut || ''), labs.indexOf(s.lab), growths.indexOf(s.growth || ''), s.price, ip, ir];
  });

  const buckets = Array.from({ length: config.buckets }, () => ({}));
  for (const { _usd, ...pub } of list) buckets[bucketOf(pub.id, config.buckets)][pub.id] = pub;

  const out = config.outDir;
  const prev = await previousCount(out);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'd'), { recursive: true });
  const meta = {
    updatedAt: new Date().toISOString(), count: list.length, rows, fx,
    shapes, colours, clarities, cuts, labs, growths, prefixes, buckets: config.buckets,
    cols: ['id', 'shape', 'carat', 'colour', 'clarity', 'cut', 'lab', 'growth', 'price', 'imgPrefix', 'imgRest'],
  };
  await writeFile(join(out, 'meta.json'), JSON.stringify(meta));
  const stonesJson = JSON.stringify({ updatedAt: meta.updatedAt, rows: compact });
  await writeFile(join(out, 'stones.json'), stonesJson);
  await Promise.all(buckets.map((b, i) => writeFile(join(out, 'd', `${i}.json`), JSON.stringify(b))));
  await writeFile(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Edee diamond feed</title>
<p>${list.length} stones · updated ${meta.updatedAt} · USD→AUD ${fx.rate} (${fx.source})</p>`);
  await writeFile(join(out, '.nojekyll'), '');

  console.log(`Published ${list.length} stones of ${rows} rows (previous ${prev}); stones.json ${(stonesJson.length / 1e6).toFixed(2)} MB; FX ${fx.rate} ${fx.source}; ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
