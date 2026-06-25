/**
 * Sleep Number Quote Studio — Catalog Updater
 *
 * Runs as a GitHub Action daily at 5 AM Central.
 * Fetches public Sleep Number product/promo pages, extracts structured data,
 * and merges new findings into catalog.json.
 *
 * Data source priority:
 *  1. JSON-LD embedded structured data
 *  2. product JSON from page meta / window vars
 *  3. HTML product card parsing
 *  4. Promo / legal page text patterns
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const root        = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');

const BRAND  = 'Sleep Number';
const UA     = 'SleepNumberQuoteStudio/2.0 (+https://github.com/sleep-quote-studio; catalog-updater-bot)';
const TIMEOUT_MS = 20_000;

/* ── Utility: parse money strings → integer cents/whole dollars ── */
const parseMoney = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/* ── Utility: generate a URL-safe slug ── */
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);

/* ── Utility: deduplicate by id, primary wins ── */
const dedupeById = (items) => [...new Map(items.map(i => [i.id, i])).values()];

/* ── Utility: merge primary over fallback ── */
const mergeById = (primary, fallback) => [
  ...dedupeById(primary),
  ...fallback.filter(x => !primary.some(p => p.id === x.id)),
];

/* ── Utility: clean JSON-LD text ── */
const cleanJsonLd = (v) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

/* ── Utility: flatten @graph ── */
function flattenJsonLd(value) {
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(item => (item['@graph'] ? flattenJsonLd(item['@graph']) : [item]));
}

/* ── Guess series id from product name ── */
function guessSeriesId(name = '') {
  const n = name.toLowerCase();
  if (n.includes('climate360') || n.includes('climate 360')) return 'climate360';
  if (n.includes(' i10') || n.startsWith('i10')) return 'i-series';
  if (n.includes(' i8')  || n.startsWith('i8'))  return 'i-series';
  if (n.includes(' p6')  || n.startsWith('p6'))  return 'p-series';
  if (n.includes(' p5')  || n.startsWith('p5'))  return 'p-series';
  if (n.includes(' c6')  || n.startsWith('c6'))  return 'c-series';
  if (n.includes(' c4')  || n.startsWith('c4'))  return 'c-series';
  if (n.includes(' c2')  || n.startsWith('c2'))  return 'c-series';
  return null;
}

/* ── Guess product model from name ── */
function guessModel(name = '') {
  const patterns = ['Climate360', 'i10', 'i8', 'p6', 'p5', 'c6', 'c4', 'c2'];
  for (const p of patterns) {
    if (name.toLowerCase().includes(p.toLowerCase())) return p;
  }
  return name.split(/[-–|]/)[0].trim();
}

/* ── Guess size from name/description ── */
function guessSize(text = '') {
  const t = text.toLowerCase();
  const sizes = [
    'Split Cal King', 'California King', 'Split King', 'King', 'Queen', 'Full', 'Twin XL', 'Twin',
  ];
  for (const s of sizes) {
    if (t.includes(s.toLowerCase())) return s;
  }
  return 'Queen'; // default to most common
}

/* ── Fetch a URL with timeout ── */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, headers: { 'user-agent': UA, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

/* ── Extract products from JSON-LD on a page ── */
function extractProductsFromJsonLd(html, source) {
  const products = [];
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(cleanJsonLd(match[1]));
      const nodes = flattenJsonLd(parsed);
      for (const node of nodes) {
        const typeStr = String(node['@type'] || '').toLowerCase();
        if (!typeStr.includes('product')) continue;
        const offer = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
        const price = parseMoney(offer.price ?? offer.lowPrice ?? node.price);
        if (!node.name || !price) continue;
        const seriesId = guessSeriesId(node.name);
        products.push({
          id: slug(`${BRAND}-${node.name}`),
          seriesId,
          model: guessModel(node.name),
          size: guessSize(node.name + ' ' + (node.description || '')),
          retailPrice: parseMoney(offer.highPrice ?? offer.price) ?? price,
          salePrice: price,
          description: node.description?.slice(0, 200) || '',
          productUrl: source.url,
          verificationRequired: true,
          confidenceScore: 0.75,
          sourceUrl: source.url,
          lastVerified: new Date().toISOString(),
        });
      }
    } catch {
      /* malformed JSON-LD, skip */
    }
  }
  return dedupeById(products);
}

/* ── Extract products from HTML product cards ── */
function extractProductsFromHtml(html, source) {
  const products = [];
  /* Try to find price-annotated headings and nearby prices */
  const pricePattern = /\$\s*([\d,]+(?:\.\d{2})?)/g;
  const namePattern  = /(Climate360|i10|i8|p6|p5|c6|c4|c2)\b/gi;

  const priceMatches = [...html.matchAll(pricePattern)].map(m => parseMoney(m[1])).filter(Boolean);
  const nameMatches  = [...html.matchAll(namePattern)].map(m => m[1]);

  const uniqueModels = [...new Set(nameMatches)];
  for (const model of uniqueModels) {
    const seriesId = guessSeriesId(model);
    const price    = priceMatches[0]; // use first price found as a rough estimate
    if (!price) continue;
    products.push({
      id: slug(`${BRAND}-${model}-queen`),
      seriesId,
      model,
      size: 'Queen',
      retailPrice: price,
      salePrice: price,
      verificationRequired: true,
      confidenceScore: 0.45,
      sourceUrl: source.url,
      lastVerified: new Date().toISOString(),
    });
  }
  return dedupeById(products);
}

/* ── Extract promos from HTML text ── */
function extractPromosFromHtml(html, source) {
  /* Strip tags and scripts */
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const promos = [];
  const patterns = [
    /\$\s*([\d,]+)\s*(off|savings?|discount)/gi,
    /save\s+\$\s*([\d,]+)/gi,
    /([\d]{2,3})\s*%\s*off/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw    = match[0].trim().slice(0, 80);
      const isPercent = raw.includes('%');
      const amount = parseMoney(match[1] || match[2]);
      if (!amount || amount > 5000) continue; // ignore implausible values
      promos.push({
        id: slug(`${source.name}-${raw}`),
        type: 'toggle',
        name: raw.replace(/\b\w/g, c => c.toUpperCase()),
        description: `Imported from ${source.name}. Verify eligibility and current validity before applying.`,
        ...(isPercent ? { discountPercent: amount } : { discountAmount: amount }),
        verificationRequired: true,
        confidenceScore: 0.4,
        sourceUrl: source.url,
        lastVerified: new Date().toISOString(),
      });
    }
  }
  return dedupeById(promos).slice(0, 10); // cap imports
}

/* ── Extract from JSON feed ── */
function extractFromJsonFeed(data, source) {
  const products = [];
  const candidates = Array.isArray(data) ? data
    : (data.products ?? data.items ?? data.results ?? []);

  for (const item of candidates) {
    const name  = item.name || item.title || item.productName;
    const price = parseMoney(item.salePrice ?? item.price ?? item.currentPrice ?? item.offerPrice);
    if (!name || !price) continue;
    const seriesId = guessSeriesId(item.series || name);
    products.push({
      id: slug(`${BRAND}-${name}`),
      seriesId,
      model: item.model || guessModel(name),
      size: item.size || guessSize(name),
      retailPrice: parseMoney(item.retailPrice ?? item.msrp ?? price) ?? price,
      salePrice: price,
      description: (item.description || '').slice(0, 200),
      productUrl: item.url || source.url,
      verificationRequired: true,
      confidenceScore: 0.7,
      sourceUrl: source.url,
      lastVerified: new Date().toISOString(),
    });
  }
  return dedupeById(products);
}

/* ══════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */
async function main() {
  const catalogRaw = await fs.readFile(catalogPath, 'utf8');
  const catalog    = JSON.parse(catalogRaw);
  const config     = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));

  const activeSources = (config.sources || []).filter(
    s => s.url && /^https?:\/\//.test(s.url) && s.enabled !== false
  );

  const importedProducts = [];
  const importedPromos   = [];
  const sourceResults    = [];

  for (const source of activeSources) {
    console.log(`Fetching: ${source.name} (${source.url})`);
    try {
      const res = await fetchWithTimeout(source.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();

      if (source.type === 'json') {
        const data = JSON.parse(text);
        importedProducts.push(...extractFromJsonFeed(data, source));
      } else {
        importedProducts.push(...extractProductsFromJsonLd(text, source));
        importedProducts.push(...extractProductsFromHtml(text, source));
        importedPromos.push(...extractPromosFromHtml(text, source));
      }

      const ip = importedProducts.length;
      const pp = importedPromos.length;
      console.log(`  ✓ ${source.name}: ${ip} product(s), ${pp} promo(s) imported so far`);
      sourceResults.push({ name: source.name, url: source.url, ok: true, importedProducts: ip, importedPromos: pp });
    } catch (err) {
      console.error(`  ✗ ${source.name}: ${err.message}`);
      sourceResults.push({ name: source.name, url: source.url, ok: false, error: err.message });
    }
  }

  /* Validate: drop products with NaN prices or missing required fields */
  const validProducts = importedProducts.filter(p => {
    if (!p.id || !p.model) return false;
    if (!Number.isFinite(p.retailPrice) || p.retailPrice <= 0) return false;
    if (!Number.isFinite(p.salePrice)   || p.salePrice   <= 0) return false;
    return true;
  });

  const invalidCount = importedProducts.length - validProducts.length;
  if (invalidCount > 0) {
    console.warn(`⚠ Dropped ${invalidCount} product(s) with invalid/missing prices.`);
  }

  const nextCatalog = {
    ...catalog,
    lastUpdated: new Date().toISOString(),
    sourceNotes: activeSources.length
      ? `Catalog updater ran. ${validProducts.length} product(s) imported from ${activeSources.length} source(s).`
      : 'Catalog updater ran with no active sources. Add URLs in scripts/sources.json.',
    sourceResults,
  };

  if (validProducts.length) {
    nextCatalog.products = mergeById(validProducts, catalog.products || []);
    console.log(`Merged products: ${nextCatalog.products.length} total`);
  }

  if (importedPromos.length) {
    nextCatalog.promos = mergeById(importedPromos, catalog.promos || []);
    console.log(`Merged promos: ${nextCatalog.promos.length} total`);
  }

  /* Write catalog */
  const output = JSON.stringify(nextCatalog, null, 2) + '\n';
  await fs.writeFile(catalogPath, output);
  console.log(`\n✅ Catalog updated: ${nextCatalog.products.length} products, ${nextCatalog.promos.length} promos, ${nextCatalog.addons.length} addons.`);
  console.log(`   Last updated: ${nextCatalog.lastUpdated}`);
  if (sourceResults.some(s => !s.ok)) {
    console.warn('   ⚠ Some sources failed. See sourceResults in catalog.json.');
  }
}

main().catch(err => {
  console.error('Catalog update failed:', err);
  process.exit(1);
});
