# Edee Infinity loose diamonds

Free setup that powers the **Loose Diamonds** page on edeeinfinity.com.

| Part | Where | Cost |
|---|---|---|
| Pull the supplier feed at **:15 and :45**, keep the stones we sell, price them in AUD, publish the list | GitHub Actions + GitHub Pages (this repo) | Free (public repo) |
| "Add to cart": check the stone is still listed, create a hidden one-off Shopify product at that price | Cloudflare Worker `worker/worker.js` | Free plan |
| Search page | Shopify theme section `edee-diamond-search` (copy in `theme-section-edee-diamond-search.liquid`) | — |

## What's listed
IGI or GIA certified, colour D–H, 0.30 ct and up, status *Available* or *In Stock*, with a working photo.

## Price customers see (AUD, incl. GST)
`supplier USD × USD→AUD (European Central Bank rate, via frankfurter.app) × MARKUP + EXTRA_AUD`, rounded up to the next $10.
The supplier's prices and the feed link are never published.

## Changing settings
GitHub → this repo → **Settings → Secrets and variables → Actions**
- Secret `FEED_URL`: the supplier's private CSV link.
- Variables (optional; defaults in brackets): `MARKUP` (2), `EXTRA_AUD` (0), `FX_BUFFER` (0, e.g. 0.02 = +2%), `MIN_CARAT` (0.3), `COLOURS` (D,E,F,G,H), `LABS` (IGI,GIA), `REQUIRE_PHOTO` (true).

A change applies at the next refresh. To refresh now: **Actions → Refresh diamond list → Run workflow**.

## Checking it's working
- `https://<user>.github.io/edee-diamonds/` shows how many stones are listed, when, and the exchange rate used.
- **Actions** tab: every run is listed; a red cross means that refresh failed and the previous list stays online.
- GitHub's timer can start a few minutes late when GitHub is busy.

## Orders
Each diamond order line is a hidden one-off product: **SKU = supplier stock ID**, title includes the certificate number.
Order that stone from the supplier. One-off products are deleted after 7 days (orders keep their own copy).

## Cart worker settings (Cloudflare → Workers → edee-cart → Settings → Variables and Secrets)
`DATA_URL` (this repo's Pages address) · `ALLOWED_ORIGINS` · `SHOPIFY_SHOP` · secrets `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` · optional `PRODUCT_TTL_DAYS`.
Add a daily Cron Trigger (e.g. `0 3 * * *`) so old one-off products are cleaned up.

Local test: `npm test`
