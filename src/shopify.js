import { config } from './config.js';

let token = null;
let tokenExpires = 0;
let onlineStoreId = null;

async function getToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  if (!config.clientId || !config.clientSecret) throw new Error('Shopify app credentials are not set');
  const res = await fetch(`https://${config.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Shopify token error ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  token = j.access_token;
  tokenExpires = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

export async function gql(query, variables = {}) {
  const res = await fetch(`https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': await getToken() },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const userErr = (d, key) => {
  const e = d?.[key]?.userErrors;
  if (e && e.length) throw new Error(`${key}: ${e.map((x) => x.message).join('; ')}`);
};

async function onlineStore() {
  if (onlineStoreId) return onlineStoreId;
  const d = await gql(`{ publications(first: 20) { nodes { id name } } }`);
  const p = d.publications.nodes.find((n) => /online store/i.test(n.name));
  if (!p) throw new Error('Online Store publication not found');
  onlineStoreId = p.id;
  return onlineStoreId;
}

export const stoneTitle = (s) => `Lab-Grown Diamond ${s.carat.toFixed(2)} ct ${s.shape}, ${s.colour} ${s.clarity}`;

function describe(s) {
  const rows = [
    ['Shape', s.shape], ['Carat', s.carat.toFixed(2)], ['Colour', s.colour], ['Clarity', s.clarity],
    ['Cut', s.cut], ['Polish', s.polish], ['Symmetry', s.symmetry], ['Fluorescence', s.fluorescence],
    ['Measurements (mm)', s.measurements], ['Growth', s.growth], ['Certificate', `${s.lab} ${s.cert}`],
  ].filter((r) => r[1]);
  return `<p>Certified lab-grown diamond. Availability is confirmed with our cutting partner within 24 hours of your order; if this stone has sold, we'll offer a matching alternative or a full refund.</p>
<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('')}</table>`;
}

// Get (or create) a one-off hidden product for this stone at its current price. Returns the variant GID.
export async function ensureProduct(s) {
  const handle = `lab-diamond-${s.id}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const price = s.price.toFixed(2);

  const found = await gql(
    `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id status variants(first: 1) { nodes { id price } } } }`,
    { h: handle }
  );
  const existing = found.productByIdentifier;
  if (existing && existing.status === 'ACTIVE') {
    const v = existing.variants.nodes[0];
    if (v.price !== price) {
      const d = await gql(
        `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
        { p: existing.id, v: [{ id: v.id, price }] }
      );
      userErr(d, 'productVariantsBulkUpdate');
    }
    return v.id;
  }

  const created = await gql(
    `mutation($p: ProductCreateInput!, $m: [CreateMediaInput!]) {
      productCreate(product: $p, media: $m) { product { id variants(first: 1) { nodes { id } } } userErrors { message } }
    }`,
    {
      p: {
        title: stoneTitle(s),
        handle,
        status: 'ACTIVE',
        vendor: 'Edee Infinity',
        productType: 'Loose Diamond',
        tags: ['loose-diamond', 'feed-stone'],
        descriptionHtml: describe(s),
        metafields: [{ namespace: 'seo', key: 'hidden', type: 'number_integer', value: '1' }],
      },
      m: s.image ? [{ originalSource: s.image, mediaContentType: 'IMAGE', alt: stoneTitle(s) }] : [],
    }
  );
  userErr(created, 'productCreate');
  const pid = created.productCreate.product.id;
  const vid = created.productCreate.product.variants.nodes[0].id;

  const upd = await gql(
    `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
    { p: pid, v: [{ id: vid, price, taxable: true, inventoryPolicy: 'CONTINUE', inventoryItem: { sku: s.id, tracked: false, requiresShipping: true } }] }
  );
  userErr(upd, 'productVariantsBulkUpdate');

  const pub = await gql(
    `mutation($id: ID!, $p: [PublicationInput!]!) { publishablePublish(id: $id, input: $p) { userErrors { message } } }`,
    { id: pid, p: [{ publicationId: await onlineStore() }] }
  );
  userErr(pub, 'publishablePublish');
  return vid;
}

// Delete one-off diamond products older than the TTL (placed orders keep their own copy of the line).
export async function cleanupOldProducts() {
  if (!config.clientId) return 0;
  const before = new Date(Date.now() - config.productTtlDays * 86400_000).toISOString();
  const d = await gql(
    `query($q: String!) { products(first: 100, query: $q) { nodes { id } } }`,
    { q: `tag:feed-stone AND created_at:<'${before}'` }
  );
  let n = 0;
  for (const p of d.products.nodes) {
    const r = await gql(`mutation($i: ProductDeleteInput!) { productDelete(input: $i) { userErrors { message } } }`, { i: { id: p.id } });
    if (!r.productDelete.userErrors.length) n++;
  }
  return n;
}
