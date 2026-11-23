// All settings come from environment variables so they can be changed in the Render dashboard
// without touching code. Defaults are shown here.
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export const config = {
  port: num(process.env.PORT, 10000),

  // Supplier feed (keep the URL private: set it in Render, never in the theme)
  feedUrl: process.env.FEED_URL || '',
  // Supplier refreshes on the hour and half hour; we pull at these minutes past each hour
  refreshMinutes: list(process.env.REFRESH_MINUTES, ['15', '45']).map(Number),

  // Which stones to show
  minCarat: num(process.env.MIN_CARAT, 0.3),
  colours: list(process.env.COLOURS, ['D', 'E', 'F', 'G', 'H']),
  labs: list(process.env.LABS, ['IGI', 'GIA']),
  statuses: list(process.env.STATUSES, ['Available', 'In Stock']),
  requirePhoto: (process.env.REQUIRE_PHOTO || 'true') === 'true',

  // Pricing: retail AUD (incl. GST) = supplier USD x USD->AUD x MARKUP + EXTRA_AUD, rounded up to ROUND_TO
  markup: num(process.env.MARKUP, 2),
  extraAud: num(process.env.EXTRA_AUD, 0), // insurance + shipping per stone, if not already in the markup
  fxBuffer: num(process.env.FX_BUFFER, 0), // e.g. 0.02 adds 2% to the exchange rate as a safety margin
  fxFallback: num(process.env.FX_FALLBACK, 1.55), // used only if the live rate can't be fetched
  roundTo: num(process.env.ROUND_TO, 10),

  // Who may call the API from a browser
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, ['https://edeeinfinity.com', 'https://www.edeeinfinity.com']),

  // Shopify (Dev Dashboard app installed on the store; client-credentials grant)
  shop: process.env.SHOPIFY_SHOP || 'u1us8c-vw.myshopify.com',
  clientId: process.env.SHOPIFY_CLIENT_ID || '',
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2025-07',
  // One-off diamond products are deleted this many days after creation (orders keep their copy)
  productTtlDays: num(process.env.PRODUCT_TTL_DAYS, 7),
};
