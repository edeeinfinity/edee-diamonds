// Local tests: build from a synthetic feed with the real supplier header, then exercise the cart worker
// against a fake Shopify. Run with `npm test`.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bucketOf } from '../src/feed.js';

const H = 'certificateNumber,certificateComment,certificateImage,city,clarity,color,country,countryOfPolishing,crownAngle,crownHeight,cut,depth,diamondImage,diamondImage2,diamondImage3,diamondImage4,diamondImage5,diamondImage6,diamondVideo,eyeClean,fancyColor,fancyColorIntensity,fancyColorOvertone,fluorescenceIntensity,girdleCondition,girdlePer,girdleThick,girdleThin,growthType,heartAndArrow,lab,laserInscription,location,lwRatio,measurements,measurementsDepth,measurementsLength,measurementsWidth,pavilionAngle,pavilionDepth,polish,pricePerCarat,shape,state,stockId,symmetry,table,treatment,weight,finalPrice,status,pair,imageCheckedAt,imageHttpStatus,isImageBroken,matchingStockId'.split(',');
let seed = 7;
const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(R() * a.length)];
const usd = {};
const rows = [H.join(',')];
for (let i = 0; i < 3000; i++) {
  const o = Object.fromEntries(H.map((h) => [h, '']));
  Object.assign(o, {
    certificateNumber: String(700000000 + i), clarity: pick(['VVS1', 'VS1', 'IF', 'SI1']), color: pick(['D', 'E', 'F', 'G', 'H', 'I', 'Fancy']),
    cut: pick(['ID', 'EX', '', 'VG']), depth: '62.1', diamondImage: i % 9 ? `https://video.S360.services/imaged/S${i}/still.jpg` : '',
    diamondVideo: `https://video.S360.services/video.html?d=S${i}`, fluorescenceIntensity: 'None', growthType: pick(['CVD', 'HPHT', 'cvd']),
    lab: pick(['IGI', 'GIA', 'None', 'igi']), location: 'India', lwRatio: '1.01', measurements: '6.5*6.48*4.0', polish: 'EX',
    shape: pick(['Round', 'Oval', 'Pear', 'ELONGATED CUSHION', 'Emerald']), stockId: 'S' + i, symmetry: 'EX', table: '58',
    weight: (0.2 + R() * 4).toFixed(2), finalPrice: (50 + Math.floor(R() * 1200)).toFixed(2), status: pick(['Available', 'In Stock', 'Hold', 'Memo', '']),
    isImageBroken: i % 13 ? 'False' : 'True',
  });
  usd['S' + i] = +o.finalPrice;
  rows.push(H.map((h) => (/[,"]/.test(o[h]) ? `"${o[h].replace(/"/g, '""')}"` : o[h])).join(','));
}
rows.push('"quoted, comma",x'); // malformed short row

const fail = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };

const feed = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/csv' }); r.end(rows.join('\r\n')); }).listen(18080);
const out = '/tmp/edee-test-public';
await rm(out, { recursive: true, force: true });
const run = promisify(execFile);
const b = await run('node', ['scripts/build.js'], { env: { ...process.env, FEED_URL: 'http://127.0.0.1:18080/f.csv', FX_FALLBACK: '1.5', OUT_DIR: out } });
console.log(b.stdout.trim(), b.stderr.trim());
feed.close();

const meta = JSON.parse(await readFile(`${out}/meta.json`, 'utf8'));
const st = JSON.parse(await readFile(`${out}/stones.json`, 'utf8'));
ok(meta.count === st.rows.length && meta.count > 0, `meta count ${meta.count}, rows ${meta.rows}`);
ok(meta.shapes.includes('Elongated Cushion'), 'shapes ' + meta.shapes.join(','));
const raw = await readFile(`${out}/stones.json`, 'utf8') + (await Promise.all([...Array(64).keys()].map((i) => readFile(`${out}/d/${i}.json`, 'utf8')))).join('');
ok(!/_usd|finalPrice|pricePerCarat/.test(raw), 'no supplier price fields in published files');
const decode = (r) => ({ id: r[0], shape: meta.shapes[r[1]], carat: r[2], colour: meta.colours[r[3]], lab: meta.labs[r[6]], price: r[8], image: r[9] >= 0 ? meta.prefixes[r[9]] + r[10] : '' });
const all = st.rows.map(decode);
ok(all.every((s) => ['IGI', 'GIA'].includes(s.lab) && 'DEFGH'.includes(s.colour) && s.carat >= 0.3 && s.image), 'only IGI/GIA, D–H, ≥0.30 ct, with photo');
ok(all.every((s) => s.price === Math.ceil((usd[s.id] * 1.5 * 2 + 100) / 10) * 10), 'every price = USD × 1.5 × 2 + A$100, rounded up to $10');
ok(all.every((s) => s.image === `https://video.S360.services/imaged/${s.id}/still.jpg`), 'image URLs rebuild correctly');
const one = all[0];
const det = JSON.parse(await readFile(`${out}/d/${bucketOf(one.id)}.json`, 'utf8'))[one.id];
ok(det && det.price === one.price && det.cert && det.certUrl.includes(det.cert), 'detail file has the stone with same price');
console.log('size stones.json', (raw.length / 1e6).toFixed(2), 'MB total for', meta.count, 'stones');

// ---- cart worker against fake Shopify + fake data host
const worker = (await import('../worker/worker.js')).default;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://data.test/')) {
    const p = url.replace('https://data.test/', '');
    return new Response(await readFile(`${out}/${p}`, 'utf8'));
  }
  const body = opts.body ? String(opts.body) : '';
  calls.push({ url, body });
  if (url.endsWith('/admin/oauth/access_token')) return Response.json({ access_token: 'tok', expires_in: 86399 });
  const q = JSON.parse(body).query;
  if (q.includes('productByIdentifier')) return Response.json({ data: { productByIdentifier: null } });
  if (q.includes('productCreate')) return Response.json({ data: { productCreate: { product: { id: 'gid://shopify/Product/1', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/555' }] } }, userErrors: [] } } });
  if (q.includes('productVariantsBulkUpdate')) return Response.json({ data: { productVariantsBulkUpdate: { userErrors: [] } } });
  if (q.includes('publications')) return Response.json({ data: { publications: { nodes: [{ id: 'gid://shopify/Publication/9', name: 'Online Store' }] } } });
  if (q.includes('publishablePublish')) return Response.json({ data: { publishablePublish: { userErrors: [] } } });
  return Response.json({ errors: ['unexpected'] });
};
const env = { DATA_URL: 'https://data.test', SHOPIFY_SHOP: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'sec' };
const post = (id, origin = 'https://edeeinfinity.com') => worker.fetch(new Request('https://w.test/cart-line', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }), env);
let r = await post(one.id); let j = await r.json();
ok(r.status === 200 && j.variantId === 555 && r.headers.get('access-control-allow-origin') === 'https://edeeinfinity.com', 'cart-line creates product → variant ' + JSON.stringify(j));
const varUpd = calls.find((c) => c.body.includes('inventoryItem'));
ok(varUpd && JSON.parse(varUpd.body).variables.v[0].price === one.price.toFixed(2) && JSON.parse(varUpd.body).variables.v[0].inventoryItem.sku === one.id, 'price and SKU (supplier stock id) set from published list');
const create = calls.find((c) => c.body.includes('productCreate'));
ok(/seo/.test(create.body) && /feed-stone/.test(create.body), 'product hidden from search and tagged for cleanup');
r = await post('NOPE'); ok(r.status === 404, 'sold/unknown stone → 404');
r = await post(one.id, 'https://evil.example'); ok(r.status === 403, 'other website → 403');
let n429 = 0; for (let i = 0; i < 12; i++) if ((await post(one.id)).status === 429) n429++;
ok(n429 > 0, 'rate limit kicks in');

console.log(fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASSED');
process.exit(fail.length ? 1 : 0);
