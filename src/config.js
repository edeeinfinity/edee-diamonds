// Settings for the feed build. Change them in GitHub: Settings → Secrets and variables → Actions → Variables.
const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export const config = {
  // Supplier feed (secret: GitHub → Settings → Secrets → Actions → FEED_URL)
  feedUrl: process.env.FEED_URL || '',

  // Which stones to show
  minCarat: num(process.env.MIN_CARAT, 0.3),
  colours: list(process.env.COLOURS, ['D', 'E', 'F', 'G', 'H']),
  labs: list(process.env.LABS, ['IGI', 'GIA']),
  statuses: list(process.env.STATUSES, ['Available', 'In Stock']),
  requirePhoto: (process.env.REQUIRE_PHOTO || 'true') === 'true',

  // Pricing: retail AUD (incl. GST) = supplier USD x USD->AUD x MARKUP + EXTRA_AUD, rounded up to ROUND_TO,
  // and never below MIN_PRICE
  markup: num(process.env.MARKUP, 2),
  extraAud: num(process.env.EXTRA_AUD, 100), // insured shipping India -> Australia, per stone
  minPrice: num(process.env.MIN_PRICE, 0),
  fxBuffer: num(process.env.FX_BUFFER, 0), // 0.02 = add 2% to the exchange rate as a safety margin
  fxFallback: num(process.env.FX_FALLBACK, 1.55), // used only if the live rate can't be fetched
  roundTo: num(process.env.ROUND_TO, 10),

  // Output
  outDir: process.env.OUT_DIR || 'public',
  buckets: 64,
};
