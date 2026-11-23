# Edee diamond feed

Pulls the supplier's loose-diamond CSV at **:15 and :45** past every hour, keeps only the stones we sell,
prices them in AUD, and powers the **Loose Diamonds** page on edeeinfinity.com.

## What it shows
IGI or GIA certified, colour D–H, 0.30 ct and up, status *Available* or *In Stock*, with a working photo.

## Price customers see (AUD, incl. GST)
`supplier USD × live USD→AUD rate × MARKUP + EXTRA_AUD`, rounded up to the next $10.
The exchange rate comes from the European Central Bank (via frankfurter.app) at each refresh.
The supplier's price is never sent to the website.

## Changing settings (Render dashboard → edee-diamond-feed → Environment)
| Setting | What it does | Now |
|---|---|---|
| `MARKUP` | Multiplier on supplier cost | 2 |
| `EXTRA_AUD` | Fixed A$ added per stone (insurance/shipping) | 0 |
| `FX_BUFFER` | Safety margin on the exchange rate (0.02 = 2%) | 0 |
| `MIN_CARAT`, `COLOURS`, `LABS`, `REQUIRE_PHOTO` | Which stones are listed | 0.3 · D–H · IGI,GIA · true |
| `REFRESH_MINUTES` | Minutes past the hour to refresh | 15,45 |
| `FEED_URL` | Supplier's private CSV link (secret) | — |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify app credentials (secret) | — |

Saving a change restarts the service (about a minute) and the new prices apply straight away.

## Checking it's working
Open `https://<your-service>.onrender.com/health`: it shows how many stones are listed, when the feed was last
refreshed, the exchange rate used and any error. If a refresh fails, the previous stones stay online.

## Buying
When a customer clicks *Add to cart*, the service checks the stone is still in the latest feed and creates a
hidden one-off Shopify product (SKU = supplier stock ID, title includes the certificate number) at the current
price, then adds it to the cart. These products are hidden from search and collections and are deleted after
7 days; orders keep their own copy. **Order the stone from the supplier using the SKU on the order.**

## Endpoints
`GET /api/facets` · `GET /api/diamonds?shape=&colour=&clarity=&cut=&lab=&growth=&cmin=&cmax=&pmin=&pmax=&sort=price_asc|price_desc|carat_asc|carat_desc&page=&per=` ·
`GET /api/diamonds/:id` · `POST /api/cart-line {id}` · `GET /health`

Local test: `npm test`
