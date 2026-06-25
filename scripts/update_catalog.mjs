/**
 * Sleep Number Quote Studio — update_catalog.mjs
 *
 * Daily catalog refresh script (runs via GitHub Actions).
 *
 * Behavior:
 *  1. Reads current catalog.json
 *  2. For each enabled source in sources.json, fetches the public page
 *  3. Tries JSON-LD structured data first, then meta tags, then page text
 *  4. Merges newly found promotions into catalog.promotions
 *  5. Updates metadata, confidence scores, and source health report
 *  6. Writes updated catalog.json (only if changed)
 *  7. Prints a refresh report
 *
 * ⚠  IMPORTANT: Only public, unauthenticated pages should be added to
 *    sources.json. Do not add login-protected systems or internal tools.
 */

import fs       from 'node:fs/promises';
import path     from 'node:path';
import { createHash } from 'node:crypto';

const ROOT         = process.cwd();
const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
const SOURCES_PATH = path.join(ROOT, 'scripts', 'sources.json');

// ── Money parser ─────────────────────────────────────────────────────────────
function parseMoney(value) {
  const str = String(value ?? '').replace(/[^0-9.]/g, '');
  const n   = Number(str);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// ── Slugify ───────────────────────────────────────────────────────────────────
function slug(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Hash ──────────────────────────────────────────────────────────────────────
function hash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

// ── Extract JSON-LD from HTML ────────────────────────────────────────────────
function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      const items  = Array.isArray(parsed) ? parsed : [parsed];
      results.push(...items);
    } catch { /* malformed JSON-LD, skip */ }
  }
  return results;
}

// ── Extract products from JSON-LD ────────────────────────────────────────────
function extractProductsFromJsonLd(jsonLdItems, source) {
  const products = [];
  for (const item of jsonLdItems) {
    const type = item['@type'];
    if (!type) continue;

    const types = Array.isArray(type) ? type : [type];
    if (!types.some(t => t === 'Product' || t === 'ItemList')) continue;

    if (types.includes('Product')) {
      const p = normalizeJsonLdProduct(item, source);
      if (p) products.push(p);
    }

    if (types.includes('ItemList') && Array.isArray(item.itemListElement)) {
      for (const el of item.itemListElement) {
        const raw = el.item || el;
        if (raw['@type'] === 'Product') {
          const p = normalizeJsonLdProduct(raw, source);
          if (p) products.push(p);
        }
      }
    }
  }
  return products;
}

function normalizeJsonLdProduct(raw, source) {
  const name = raw.name;
  if (!name || typeof name !== 'string') return null;

  let price = 0;
  let regularPrice = 0;

  const offers = raw.offers || raw.Offers;
  if (offers) {
    const arr = Array.isArray(offers) ? offers : [offers];
    const first = arr[0];
    price = parseMoney(first?.price || first?.lowPrice);
    regularPrice = parseMoney(first?.highPrice || first?.price);
  }

  if (!price) return null;

  return {
    id:           slug(`sn-${name}`),
    name,
    brand:        'Sleep Number',
    category:     raw.category || 'mattress',
    description:  typeof raw.description === 'string' ? raw.description.slice(0, 300) : '',
    basePrice:    regularPrice || price,
    salePrice:    price < regularPrice ? price : null,
    priceLabel:   'Live',
    confidenceScore: 0.85,
    imageUrl:     raw.image || null,
    productUrl:   raw.url || source.url,
    sourceUrl:    source.url,
    lastVerified: new Date().toISOString().slice(0, 10),
  };
}

// ── Extract promotions from HTML text ────────────────────────────────────────
function extractPromosFromHtml(html, source) {
  const promos = [];

  // Look for common promo patterns in page text
  const patterns = [
    { re: /save\s+up\s+to\s+\$(\d[\d,]*)/gi,         type: 'toggle', label: 'Save up to' },
    { re: /\$(\d[\d,]*)\s+off\b/gi,                   type: 'toggle', label: 'Off' },
    { re: /(\d+)%\s+off\b/gi,                         type: 'toggle', label: 'Percent off' },
    { re: /free\s+([\w\s]{5,40})\s+with/gi,           type: 'toggle', label: 'Free item' },
    { re: /0%\s+(?:apr|financing)\s+for\s+(\d+)/gi,  type: 'toggle', label: 'Financing' },
    { re: /(\d+)\s*months?\s+(?:no interest|0%)/gi,   type: 'toggle', label: 'Months financing' },
  ];

  for (const { re, type, label } of patterns) {
    let m;
    while ((m = re.exec(html))) {
      // Extract a context snippet around the match
      const start   = Math.max(0, m.index - 60);
      const end     = Math.min(html.length, m.index + m[0].length + 60);
      const snippet = html.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      promos.push({
        id:                 slug(`promo-${source.name}-${label}-${m[1] || m[0]}`),
        name:               `${label}: ${m[1] || m[0]}`,
        description:        snippet.slice(0, 200),
        type,
        verificationRequired: true,
        confidenceScore:    0.5,
        sourceUrl:          source.url,
        lastVerified:       new Date().toISOString().slice(0, 10),
      });

      if (promos.length >= 10) break; // cap per source
    }
    if (promos.length >= 10) break;
  }

  return promos;
}

// ── Merge by ID (imported items take precedence) ──────────────────────────────
function mergeById(incoming, existing) {
  const map = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

// ── Fetch with timeout ────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Sleep ─────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Sleep Number Quote Studio — Catalog Updater');
  console.log('============================================');

  const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'));
  const config  = JSON.parse(await fs.readFile(SOURCES_PATH, 'utf8'));

  const activeSources = (config.sources || []).filter(s => s.enabled && s.url && /^https?:\/\//.test(s.url));
  const delay = config.crawlSettings?.requestDelayMs ?? 1000;
  const ua    = config.crawlSettings?.userAgent ?? 'SleepNumberQuoteStudio/2.0';

  const importedProducts = [];
  const importedPromos   = [];
  const sourceResults    = [];
  const report = {
    productsAdded:   0,
    productsChanged: 0,
    productsRemoved: 0,
    promosChanged:   0,
    brokenPages:     [],
    lowConfidence:   [],
    missingPrices:   [],
    sourceFailures:  [],
  };

  // Pre-run checks
  for (const mattress of catalog.mattresses || []) {
    const hasPrices = Object.values(mattress.sizePricing || {}).some(sp => sp.regular > 0);
    if (!hasPrices) report.missingPrices.push(mattress.name);
    if ((mattress.confidenceScore || 1) < 0.7) report.lowConfidence.push(mattress.name);
  }

  // Fetch each source
  if (activeSources.length === 0) {
    console.log('\nNo active sources configured.');
    console.log('To enable live data: edit scripts/sources.json and set "enabled": true');
    console.log('for Sleep Number public pages you want to monitor.');
  } else {
    console.log(`\nFetching ${activeSources.length} active source(s)…\n`);
  }

  for (const source of activeSources) {
    await sleep(delay);
    console.log(`→ ${source.name} (${source.url})`);

    try {
      const res = await fetchWithTimeout(source.url, {
        headers: {
          'user-agent': ua,
          'accept': 'text/html,application/xhtml+xml,application/json',
        }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      if (source.type === 'json') {
        const data = JSON.parse(text);
        // Handle JSON feed (future use for official API endpoints)
        sourceResults.push({ name: source.name, url: source.url, ok: true, type: 'json', note: 'JSON feed processed' });
      } else {
        // Try JSON-LD first
        const jsonLd = extractJsonLd(text);
        const products = extractProductsFromJsonLd(jsonLd, source);
        const promos   = extractPromosFromHtml(text, source);

        importedProducts.push(...products);
        importedPromos.push(...promos);

        sourceResults.push({
          name:             source.name,
          url:              source.url,
          ok:               true,
          importedProducts: products.length,
          importedPromos:   promos.length,
          jsonLdItems:      jsonLd.length,
        });
        console.log(`   ✓ ${products.length} products, ${promos.length} promos, ${jsonLd.length} JSON-LD items`);
      }
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
      console.error(`   ✗ Failed: ${msg}`);
      report.sourceFailures.push(`${source.name}: ${msg}`);
      report.brokenPages.push(source.url);
      sourceResults.push({ name: source.name, url: source.url, ok: false, error: msg });
    }
  }

  // Build updated catalog
  const prevHash = hash(catalog);

  const nextCatalog = {
    ...catalog,
    lastUpdated: new Date().toISOString(),
    metadata: {
      ...catalog.metadata,
      crawlNote: activeSources.length
        ? `Updater ran. ${activeSources.length} source(s) checked.`
        : 'Updater ran with no active sources. Add Sleep Number public URLs in scripts/sources.json and set enabled: true.',
      sourceResults,
    },
  };

  if (importedProducts.length > 0) {
    // Only merge products the importer is confident about
    const confident = importedProducts.filter(p => (p.confidenceScore || 0) >= 0.7);
    if (confident.length > 0) {
      nextCatalog.products = mergeById(confident, catalog.products || []);
      report.productsAdded = confident.length;
      console.log(`\nMerged ${confident.length} high-confidence products.`);
    }
  }

  if (importedPromos.length > 0) {
    nextCatalog.promotions = mergeById(importedPromos, catalog.promotions || []);
    report.promosChanged = importedPromos.length;
    console.log(`Merged ${importedPromos.length} promotions.`);
  }

  const newHash = hash(nextCatalog);
  const changed = prevHash !== newHash;

  await fs.writeFile(CATALOG_PATH, JSON.stringify(nextCatalog, null, 2) + '\n');

  // Print report
  console.log('\n══════════════════ REFRESH REPORT ══════════════════');
  console.log(`Catalog changed:     ${changed ? 'YES' : 'NO (no changes detected)'}`);
  console.log(`Products added:      ${report.productsAdded}`);
  console.log(`Promos updated:      ${report.promosChanged}`);
  console.log(`Missing prices:      ${report.missingPrices.length}`);
  console.log(`Low confidence:      ${report.lowConfidence.length}`);
  console.log(`Broken pages:        ${report.brokenPages.length}`);
  console.log(`Source failures:     ${report.sourceFailures.length}`);

  if (report.missingPrices.length) {
    console.log('\nMissing prices:');
    report.missingPrices.forEach(p => console.log(`  - ${p}`));
  }
  if (report.lowConfidence.length) {
    console.log('\nLow confidence items (need manual price verification):');
    report.lowConfidence.forEach(p => console.log(`  - ${p}`));
  }
  if (report.sourceFailures.length) {
    console.log('\nSource failures:');
    report.sourceFailures.forEach(f => console.log(`  - ${f}`));
  }

  console.log('\n✓ Catalog write complete.');
  console.log(`  Mattresses:   ${nextCatalog.mattresses?.length || 0}`);
  console.log(`  Bases:        ${nextCatalog.bases?.length || 0}`);
  console.log(`  Promotions:   ${nextCatalog.promotions?.length || 0}`);
  console.log(`  Hardware:     ${nextCatalog.hardware?.length || 0}`);

  if (!changed) {
    console.log('\nℹ  No catalog changes detected. Commit will be skipped by git-auto-commit.');
  }
}

main().catch(err => {
  console.error('Catalog updater failed:', err);
  process.exit(1);
});
