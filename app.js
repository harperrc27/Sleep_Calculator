/**
 * Sleep Number Quote Studio — app.js
 * Mobile-first, offline-capable sales quote assistant.
 *
 * Architecture:
 *   catalog.json (static, GitHub Actions refreshed daily)
 *     → loaded on init → localStorage cache
 *       → multi-step quote wizard
 *         → hardware rules engine + promo engine
 *           → quote summary + copy/export
 */

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG_URL   = 'data/catalog.json';
const CATALOG_KEY   = 'snqs_catalog_v2';
const QUOTE_KEY     = 'snqs_quote_v2';
const SAVED_KEY     = 'snqs_saved_v2';

const SIZES = [
  { id: 'twin-xl',    label: 'Twin XL' },
  { id: 'full',       label: 'Full' },
  { id: 'queen',      label: 'Queen' },
  { id: 'king',       label: 'King' },
  { id: 'cal-king',   label: 'Cal King' },
  { id: 'split-king', label: 'Split King' },
];

const STEPS = [
  { id: 'customer',    title: 'Customer info',         subtitle: 'Optional — helps personalize the quote' },
  { id: 'mattress',    title: 'Choose a mattress',     subtitle: 'Select the Sleep Number series' },
  { id: 'size',        title: 'Bed size',              subtitle: 'Pick the size that fits their room and lifestyle' },
  { id: 'base',        title: 'Base or foundation',    subtitle: 'Select support and adjustment solution' },
  { id: 'furniture',   title: 'Furniture & hardware',  subtitle: 'Guided setup — prevents missing parts' },
  { id: 'bedding',     title: 'Bedding & pillows',     subtitle: 'Optional comfort and protection items' },
  { id: 'protection',  title: 'Protection plan',       subtitle: 'Optional extended coverage' },
  { id: 'promos',      title: 'Promotions & discounts',subtitle: 'Apply qualifying promos and discounts' },
  { id: 'review',      title: 'Review quote',          subtitle: 'Confirm everything before sharing' },
];

const FURNITURE_SCENARIOS = [
  { id: 'new-complete',      label: 'Complete new bed setup',       desc: 'Mattress + base + new furniture / frame' },
  { id: 'add-headboard',     label: 'Adding headboard only',        desc: 'Customer has a base, wants to add a headboard' },
  { id: 'third-party',       label: "Customer's own furniture",     desc: "Using non–Sleep Number frame, headboard, or rails" },
  { id: 'platform-slats',    label: 'Platform bed or slat system',  desc: 'No box spring — flat platform or wood slats' },
  { id: 'no-furniture',      label: 'No furniture needed',          desc: 'Just mattress and/or base — no frame required' },
];

const HEADBOARD_PLANS = [
  { id: 'new-sleep-number',   label: 'New Sleep Number headboard / bed',  desc: 'Purchasing a new Sleep Number upholstered bed' },
  { id: 'existing-third-party', label: 'Existing third-party headboard',  desc: "Customer already owns a headboard" },
  { id: 'new-third-party',    label: 'New third-party headboard',         desc: 'Buying a non–Sleep Number headboard' },
  { id: 'none',               label: 'No headboard',                      desc: 'No headboard in this setup' },
];

const HEIGHT_OPTIONS = [
  { id: 'none',    label: 'No height concern',    desc: 'Current height is fine' },
  { id: 'higher',  label: 'Wants bed higher',     desc: 'Customer needs more height — check tall legs' },
  { id: 'lower',   label: 'Wants bed lower',      desc: 'Customer needs lower profile — check low legs' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════

let catalog = null;
let currentScreen = 'home';
let currentStep   = 0;
let quote         = loadQuote();
let installPrompt = null;

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    el('installBtn').classList.remove('hidden');
  });

  el('installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    el('installBtn').classList.add('hidden');
  });

  // Wire up global buttons
  el('newQuoteBtn').addEventListener('click', () => {
    quote = newQuote();
    saveQuote();
    currentStep = 0;
    showScreen('quote');
    renderStep();
  });
  el('savedQuotesBtn').addEventListener('click', toggleSavedQuotes);
  el('refreshCatalogBtn').addEventListener('click', () => refreshCatalog(true));
  el('adminBtn').addEventListener('click', () => showScreen('admin'));
  el('adminBackBtn').addEventListener('click', () => showScreen('home'));
  el('summaryBackBtn').addEventListener('click', () => showScreen('quote'));
  el('backBtn').addEventListener('click', () => { currentStep--; renderStep(); });
  el('nextBtn').addEventListener('click', handleNext);
  el('copyQuoteBtn').addEventListener('click', copyQuoteText);
  el('copySummaryBtn').addEventListener('click', copyQuoteText);
  el('saveQuoteBtn').addEventListener('click', persistQuote);
  el('printSummaryBtn').addEventListener('click', () => window.print());
  el('resetBtn').addEventListener('click', confirmReset);
  el('summaryToggleBtn').addEventListener('click', showSummaryScreen);

  // Load catalog from cache
  catalog = readCachedCatalog();
  renderCatalogStatus(catalog ? 'saved' : 'empty');
  updateSavedQuoteCount();

  // Try to refresh silently
  await refreshCatalog(false);

  showScreen('home');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTING
// ═══════════════════════════════════════════════════════════════════════════

function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(`screen-${name}`).classList.add('active');

  if (name === 'admin') renderAdminScreen();
  if (name === 'summary') renderSummaryScreen();
  if (name === 'home') updateSavedQuoteCount();
  if (name === 'quote') { renderStep(); renderSummary(); }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSummaryScreen() {
  showScreen('summary');
}

// ═══════════════════════════════════════════════════════════════════════════
//  CATALOG MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

async function refreshCatalog(force) {
  if (force) renderCatalogStatus('loading');
  try {
    const res = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    validateCatalog(data);
    catalog = data;
    localStorage.setItem(CATALOG_KEY, JSON.stringify(data));
    renderCatalogStatus('fresh');
    if (force) toast('Catalog refreshed and saved for offline use ✓');
    if (currentScreen === 'quote') renderStep();
    if (currentScreen === 'admin') renderAdminScreen();
  } catch (err) {
    renderCatalogStatus(catalog ? 'saved' : 'error', err.message);
    if (force) {
      toast(catalog
        ? 'Could not refresh. Using saved catalog.'
        : 'No catalog available. Check connection and try again.');
    }
  }
}

function readCachedCatalog() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function validateCatalog(data) {
  if (!data || !Array.isArray(data.mattresses)) {
    throw new Error('Catalog missing mattresses array');
  }
}

function renderCatalogStatus(mode, detail = '') {
  const dot = el('statusDot');
  dot.className = 'status-dot';

  const map = {
    loading: ['pulse',   'Refreshing catalog…',    'Loading the latest product data.'],
    fresh:   ['good',    'Catalog is fresh',        () => `Updated ${fmtDate(catalog?.lastUpdated)} · ${mattressCount()} mattresses`],
    saved:   ['good',    'Using saved catalog',     () => `Saved ${fmtDate(catalog?.lastUpdated)} · Works offline`],
    error:   ['bad',     'No catalog loaded',       detail || 'Refresh on unrestricted internet first.'],
    empty:   ['',        'No saved catalog',        'Tap Refresh catalog before going to a customer meeting.'],
  };

  const [cls, title, meta] = map[mode] || map['empty'];
  dot.classList.add(cls);
  el('catalogStatus').textContent = title;
  el('catalogMeta').textContent = typeof meta === 'function' ? meta() : meta;
}

function mattressCount() {
  return catalog?.mattresses?.length || 0;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUOTE STATE
// ═══════════════════════════════════════════════════════════════════════════

function newQuote() {
  return {
    id:             crypto.randomUUID?.() || `q-${Date.now()}`,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    customerName:   '',
    customerPhone:  '',
    customerNotes:  '',
    mattressId:     null,
    sizeId:         null,
    baseId:         null,
    furnitureId:    null,
    furnitureAnswers: {
      scenario:       null,
      headboardPlan:  null,
      hasFootboard:   false,
      hasSideRails:   false,
      heightConcern:  'none',
      furnitureBrand: null,
    },
    addons:      {},   // { productId: qty }  — bedding, hardware, etc.
    promoToggles:{},   // { promoId: bool }
    customDiscount: 0,
    taxRate: 0,
  };
}

function loadQuote() {
  try {
    const raw = localStorage.getItem(QUOTE_KEY);
    return raw ? { ...newQuote(), ...JSON.parse(raw) } : newQuote();
  } catch { return newQuote(); }
}

function saveQuote() {
  quote.updatedAt = new Date().toISOString();
  localStorage.setItem(QUOTE_KEY, JSON.stringify(quote));
}

function persistQuote() {
  const saved = loadSavedQuotes();
  const existing = saved.findIndex(q => q.id === quote.id);
  const snap = { ...quote };
  if (existing >= 0) saved[existing] = snap;
  else saved.unshift(snap);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, 20)));
  toast('Quote saved ✓');
  updateSavedQuoteCount();
}

function loadSavedQuotes() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
  catch { return []; }
}

function deleteSavedQuote(id) {
  const saved = loadSavedQuotes().filter(q => q.id !== id);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  updateSavedQuoteCount();
  renderSavedQuotesList();
}

function loadSavedQuote(id) {
  const saved = loadSavedQuotes().find(q => q.id === id);
  if (!saved) return;
  quote = { ...newQuote(), ...saved };
  saveQuote();
  currentStep = 0;
  showScreen('quote');
}

function updateSavedQuoteCount() {
  const saved = loadSavedQuotes();
  el('savedQuoteCount').textContent = saved.length
    ? `${saved.length} saved quote${saved.length > 1 ? 's' : ''}`
    : 'No saved quotes';
}

function toggleSavedQuotes() {
  const list = el('savedQuotesList');
  if (list.classList.contains('hidden')) {
    renderSavedQuotesList();
    list.classList.remove('hidden');
  } else {
    list.classList.add('hidden');
  }
}

function renderSavedQuotesList() {
  const saved = loadSavedQuotes();
  const list  = el('savedQuotesList');
  if (!saved.length) {
    list.innerHTML = '<p class="helper-text">No saved quotes yet.</p>';
    return;
  }
  list.innerHTML = saved.map(q => {
    const mat = catalog?.mattresses?.find(m => m.id === q.mattressId);
    const size = SIZES.find(s => s.id === q.sizeId);
    const desc = mat
      ? `${mat.name}${size ? ' · ' + size.label : ''}`
      : 'Quote not started';
    const total = calcTotal(q);
    return `<div class="saved-quote-item">
      <div>
        <strong>${esc(q.customerName || 'Unnamed customer')}</strong>
        <span>${esc(desc)} · ${money(total)}</span>
        <span>${fmtDate(q.updatedAt)}</span>
      </div>
      <div class="saved-quote-actions">
        <button class="btn btn-sm btn-secondary" onclick="loadSavedQuote('${q.id}')">Load</button>
        <button class="btn btn-sm btn-danger-ghost" onclick="deleteSavedQuote('${q.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function confirmReset() {
  if (confirm('Start over? This will clear the current quote.')) {
    quote = newQuote();
    saveQuote();
    currentStep = 0;
    renderStep();
    renderSummary();
    toast('Quote reset');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderStep() {
  if (!catalog) {
    el('stepBody').innerHTML = `<p class="helper-text">
      No catalog loaded yet. Tap <strong>Refresh catalog</strong> on the home screen while connected to the internet.
      Once loaded, the catalog is saved locally so it works offline.
    </p>`;
    updateStepChrome();
    el('hardwareRecs').classList.add('hidden');
    return;
  }

  updateStepChrome();

  const renderers = {
    customer:   renderCustomerStep,
    mattress:   renderMattressStep,
    size:       renderSizeStep,
    base:       renderBaseStep,
    furniture:  renderFurnitureStep,
    bedding:    renderBeddingStep,
    protection: renderProtectionStep,
    promos:     renderPromosStep,
    review:     renderReviewStep,
  };

  const stepId = STEPS[currentStep].id;
  el('stepBody').innerHTML = (renderers[stepId] || (() => '<p>Step not found.</p>'))();
  bindStepEvents();
  renderHardwareRecs();
  renderSummary();
}

function updateStepChrome() {
  const n = currentStep + 1;
  const total = STEPS.length;
  const step  = STEPS[currentStep];

  el('stepCounter').textContent  = `Step ${n} of ${total}`;
  el('stepTitle').textContent    = step.title;
  el('stepSubtitle').textContent = step.subtitle || '';
  el('progressBar').style.width  = `${(n / total) * 100}%`;
  el('backBtn').disabled         = currentStep === 0;
  el('nextBtn').textContent      = currentStep === STEPS.length - 1 ? 'View summary →' : 'Continue →';
}

function handleNext() {
  if (currentStep === STEPS.length - 1) {
    showSummaryScreen();
    return;
  }
  currentStep = Math.min(STEPS.length - 1, currentStep + 1);
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Step: Customer ──────────────────────────────────────────────────────────
function renderCustomerStep() {
  return `<div class="form-grid form-grid-1">
    <div class="field">
      <label for="customerName">Customer name <span style="font-weight:400;text-transform:none">(optional)</span></label>
      <input id="customerName" type="text" placeholder="e.g. Jane & John Smith" value="${esc(quote.customerName)}" data-field="customerName" autocomplete="off" />
    </div>
    <div class="field">
      <label for="customerPhone">Phone / contact <span style="font-weight:400;text-transform:none">(optional)</span></label>
      <input id="customerPhone" type="tel" placeholder="555-867-5309" value="${esc(quote.customerPhone)}" data-field="customerPhone" autocomplete="off" />
    </div>
    <div class="field">
      <label for="customerNotes">Notes <span style="font-weight:400;text-transform:none">(optional)</span></label>
      <input id="customerNotes" type="text" placeholder="Any concerns or context…" value="${esc(quote.customerNotes)}" data-field="customerNotes" autocomplete="off" />
    </div>
  </div>
  <p class="note-text" style="margin-top:.8rem">
    Customer info is stored locally on this device only and never sent anywhere.
  </p>`;
}

// ── Step: Mattress ──────────────────────────────────────────────────────────
function renderMattressStep() {
  const tiers = ['Essential', 'Performance', 'Innovation', 'Climate', 'Luxury'];
  const grouped = {};
  tiers.forEach(t => {
    const items = catalog.mattresses.filter(m => m.tier === t);
    if (items.length) grouped[t] = items;
  });

  return Object.entries(grouped).map(([tier, items]) => `
    <p class="section-heading">${tier} Series</p>
    <div class="card-grid">
      ${items.map(m => optionCard({
        id: m.id,
        selected: quote.mattressId === m.id,
        extra: `<span class="tier-badge tier-${tier.toLowerCase()}">${tier}</span>${m.recommended ? '<span class="badge-recommended">Popular</span>' : ''}`,
        title: m.name,
        subtitle: m.description,
        price: null,
        priceLabel: 'Prices by size — next step',
        features: m.features?.slice(0, 3),
      })).join('')}
    </div>
  `).join('');
}

// ── Step: Size ──────────────────────────────────────────────────────────────
function renderSizeStep() {
  if (!quote.mattressId) {
    return `<p class="helper-text">Choose a mattress series first (Step 2), then come back to pick the size.</p>`;
  }
  const mattress = catalog.mattresses.find(m => m.id === quote.mattressId);
  const sizes = catalog.sizes || SIZES.map(s => ({ ...s, description: '' }));

  return `
    <p class="note-text" style="margin-bottom:.8rem">Pricing shown is approximate and requires verification before quoting to customer.</p>
    <div class="card-grid">
      ${sizes.map(sz => {
        const pricing = mattress?.sizePricing?.[sz.id];
        const price   = pricing?.sale ?? pricing?.regular;
        const onSale  = pricing?.sale && pricing.sale < pricing.regular;
        return optionCard({
          id: sz.id,
          selected: quote.sizeId === sz.id,
          extra: sz.id === 'split-king'
            ? '<span class="badge-recommended" style="background:#0057a8">Split King</span>'
            : '',
          title: sz.label,
          subtitle: sz.description || '',
          price: price || null,
          priceLabel: pricing ? pricing.priceLabel : 'Not available in this size',
          onSale,
          regularPrice: onSale ? pricing.regular : null,
        });
      }).join('')}
    </div>
    ${quote.sizeId === 'split-king' ? `<p class="note-text" style="margin-top:.8rem">
      ⚡ Split King = two Twin XL halves. Each partner controls their own side. Works best with a FlexFit adjustable base per side.
    </p>` : ''}`;
}

// ── Step: Base ──────────────────────────────────────────────────────────────
function renderBaseStep() {
  const bases = catalog.bases || [];
  const sizeId = quote.sizeId || 'queen';
  return `
    <p class="section-heading">Non-adjustable</p>
    <div class="card-grid">
      ${bases.filter(b => b.type === 'none' || b.type === 'foundation' || b.type === 'integrated')
        .map(b => baseCard(b, sizeId)).join('')}
    </div>
    <p class="section-heading" style="margin-top:1.2rem">FlexFit Adjustable Bases</p>
    <div class="card-grid">
      ${bases.filter(b => b.type === 'adjustable')
        .map(b => baseCard(b, sizeId)).join('')}
    </div>`;
}

function baseCard(base, sizeId) {
  const pricing = base.sizePricing?.[sizeId];
  const price   = pricing?.sale ?? pricing?.regular;
  return optionCard({
    id: base.id,
    selected: quote.baseId === base.id,
    extra: base.recommended ? '<span class="badge-recommended">Popular</span>' : '',
    title: base.name,
    subtitle: base.description,
    price: price ?? base.price ?? 0,
    priceLabel: pricing ? pricing.priceLabel : (base.price === 0 ? 'No charge' : 'Verify'),
    features: base.features?.slice(0, 3),
    warnings: base.warnings,
  });
}

// ── Step: Furniture & Hardware Wizard ───────────────────────────────────────
function renderFurnitureStep() {
  const fa = quote.furnitureAnswers;
  const base = catalog.bases?.find(b => b.id === quote.baseId);
  const isAdj = base?.type === 'adjustable';

  return `
    <!-- Q1: Setup Scenario -->
    <div class="wizard-section">
      <span class="wizard-label">What describes this furniture setup?</span>
      <div class="card-grid">
        ${FURNITURE_SCENARIOS.map(s => optionCard({
          id: `scenario:${s.id}`,
          selected: fa.scenario === s.id,
          title: s.label,
          subtitle: s.desc,
        })).join('')}
      </div>
    </div>

    ${fa.scenario && fa.scenario !== 'no-furniture' ? `
    <div class="wizard-divider"></div>

    <!-- Q2: Headboard plan -->
    <div class="wizard-section">
      <span class="wizard-label">Headboard situation?</span>
      <div class="card-grid">
        ${HEADBOARD_PLANS.map(h => optionCard({
          id: `headboard:${h.id}`,
          selected: fa.headboardPlan === h.id,
          title: h.label,
          subtitle: h.desc,
        })).join('')}
      </div>
      ${isAdj && fa.headboardPlan && fa.headboardPlan !== 'none'
        ? `<p class="note-text" style="margin-top:.6rem">⚠️ Adjustable base + headboard requires the <strong>Headboard Bracket Kit</strong>.</p>`
        : ''}
    </div>

    <div class="wizard-divider"></div>

    <!-- Q3: Footboard / Rails -->
    <div class="wizard-section">
      <span class="wizard-label">Does this setup include a footboard?</span>
      <div class="card-grid card-grid-1" style="grid-template-columns:1fr 1fr">
        ${yesNoCard('hasFootboard:true',  fa.hasFootboard === true,  'Yes', 'Has a footboard')}
        ${yesNoCard('hasFootboard:false', fa.hasFootboard === false, 'No',  'No footboard')}
      </div>
      ${isAdj && fa.hasFootboard === true
        ? `<p class="note-text" style="margin-top:.6rem;background:var(--warning-bg);color:var(--warning)">⚠️ Most adjustable bases <strong>cannot be used with traditional footboards</strong> — the base needs full foot-end flex. Verify compatibility.</p>`
        : ''}
    </div>

    <div class="wizard-section">
      <span class="wizard-label">Are side rails involved?</span>
      <div class="card-grid card-grid-1" style="grid-template-columns:1fr 1fr">
        ${yesNoCard('hasSideRails:true',  fa.hasSideRails === true,  'Yes', 'Has side rails')}
        ${yesNoCard('hasSideRails:false', fa.hasSideRails === false, 'No',  'No side rails')}
      </div>
    </div>

    <div class="wizard-divider"></div>

    <!-- Q4: Height -->
    <div class="wizard-section">
      <span class="wizard-label">Any bed height concerns?</span>
      <div class="card-grid">
        ${HEIGHT_OPTIONS.map(h => optionCard({
          id: `height:${h.id}`,
          selected: fa.heightConcern === h.id,
          title: h.label,
          subtitle: h.desc,
        })).join('')}
      </div>
    </div>` : ''}

    <div class="wizard-divider"></div>

    <!-- Sleep Number Furniture Selection -->
    ${catalog.furniture?.length ? `
    <div class="wizard-section">
      <span class="wizard-label">Add Sleep Number furniture? <span class="wizard-sublabel">(optional)</span></span>
      <div class="card-grid">
        ${[{ id: 'none', name: 'No furniture', description: 'Skip furniture — mattress and/or base only.', sizePricing: null, tags: [] },
           ...catalog.furniture
        ].map(f => {
          const pricing = f.sizePricing?.[quote.sizeId || 'queen'];
          return optionCard({
            id: `furniture:${f.id}`,
            selected: quote.furnitureId === f.id,
            title: f.name,
            subtitle: f.description,
            price: pricing ? (pricing.sale ?? pricing.regular) : (f.id === 'none' ? 0 : null),
            priceLabel: pricing ? pricing.priceLabel : (f.id === 'none' ? 'No charge' : null),
            warnings: f.warnings,
            features: f.features,
          });
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Hardware -->
    <div class="wizard-section">
      <span class="wizard-label">Hardware & replacement parts</span>
      <span class="wizard-sublabel">Tap + to add items. Recommendations appear below automatically.</span>
      <div class="card-grid">
        ${(catalog.hardware || []).map(h => qtyCard(h, 'addons')).join('')}
      </div>
    </div>`;
}

// ── Step: Bedding ───────────────────────────────────────────────────────────
function renderBeddingStep() {
  const sizeId = quote.sizeId || 'queen';
  const bedding = (catalog.bedding || []);
  const pillows = bedding.filter(b => b.category === 'pillow');
  const other   = bedding.filter(b => b.category !== 'pillow');

  const renderBeddingItems = (items) => items.map(item => {
    const sp = item.sizePricing?.[sizeId] || item.sizePricing?.['standard'] || item.sizePricing?.['queen'];
    const price = sp ? (sp.sale ?? sp.regular) : (item.price ?? null);
    const priceLabel = sp ? sp.priceLabel : (item.priceLabel ?? 'Verify');
    return qtyCardItem({ ...item, basePrice: price, priceLabel });
  }).join('');

  return `
    <p class="section-heading">Pillows</p>
    <div class="card-grid">
      ${renderBeddingItems(pillows) || '<p class="helper-text">No pillow items in catalog.</p>'}
    </div>
    <p class="section-heading" style="margin-top:1rem">Bedding</p>
    <div class="card-grid">
      ${renderBeddingItems(other) || '<p class="helper-text">No bedding items in catalog.</p>'}
    </div>
    <p class="note-text" style="margin-top:.8rem">Prices are per item and require verification. Tap + to add quantities.</p>`;
}

// ── Step: Protection ─────────────────────────────────────────────────────────
function renderProtectionStep() {
  const plans = catalog.protectionPlans || [];
  const base = catalog.bases?.find(b => b.id === quote.baseId);
  const basePlans = base?.type === 'adjustable'
    ? plans
    : plans.filter(p => !p.requiredBaseTypes?.includes('adjustable'));

  return `
    <p class="note-text" style="margin-bottom:.8rem">Protection plan pricing is set by the store. Verify with your manager before quoting exact amounts.</p>
    <div class="card-grid card-grid-1">
      ${basePlans.map(p => optionCard({
        id: `protection:${p.id}`,
        selected: quote.protectionPlanId === p.id,
        title: p.name,
        subtitle: p.description,
        price: p.price,
        priceLabel: p.priceLabel || (p.price === 0 ? 'No charge' : 'Verify'),
        features: p.covers,
      })).join('')}
    </div>`;
}

// ── Step: Promos ─────────────────────────────────────────────────────────────
function renderPromosStep() {
  const promos = catalog.promotions || [];
  const calc = calculateQuote();

  const autoPromos = promos.filter(p => p.type === 'automatic');
  const togglePromos = promos.filter(p => p.type === 'toggle');
  const manualPromos = promos.filter(p => p.type === 'manual');

  const activeAuto = calc.appliedPromos.filter(p => p.source === 'auto');

  return `
    <!-- Auto promos -->
    ${autoPromos.length ? `
    <p class="section-heading">Auto-applied promotions</p>
    ${autoPromos.map(p => `
      <div class="rec-item ${activeAuto.some(a => a.id === p.id) ? 'rec-recommended' : 'rec-info'}">
        <div class="rec-item-body">
          <strong>${esc(p.name)} ${activeAuto.some(a => a.id === p.id) ? '✓ Applied' : ''}</strong>
          <p>${esc(p.description)}</p>
        </div>
      </div>`).join('')}
    ` : ''}

    <!-- Toggle promos -->
    <p class="section-heading" style="margin-top:1rem">Conditional promotions</p>
    <p class="helper-text" style="padding-top:0;margin-bottom:.8rem;font-size:.82rem">Check any promotions the customer qualifies for. Always verify before applying.</p>
    ${togglePromos.map(p => `
      <label class="toggle-card">
        <input type="checkbox" data-promo="${p.id}" ${quote.promoToggles[p.id] ? 'checked' : ''} />
        <div>
          <strong>${esc(p.name)} <span class="badge-verify">Verify</span></strong>
          <p>${esc(p.description)}</p>
          ${p.notes ? `<p style="margin-top:.25rem;font-size:.78rem;color:var(--muted)">${esc(p.notes)}</p>` : ''}
        </div>
      </label>`).join('')}

    <!-- Manual promos -->
    ${manualPromos.length ? `
    <p class="section-heading" style="margin-top:1rem">Manager overrides</p>
    ${manualPromos.map(p => `
      <div class="rec-item rec-info">
        <div class="rec-item-body">
          <strong>${esc(p.name)}</strong>
          <p>${esc(p.description || p.notes || '')}</p>
        </div>
      </div>`).join('')}` : ''}

    <!-- Custom discount + tax -->
    <p class="section-heading" style="margin-top:1.2rem">Custom amounts</p>
    <div class="form-grid">
      <div class="field">
        <label>Approved custom discount ($)</label>
        <input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}" />
      </div>
      <div class="field">
        <label>Estimated tax rate (%)</label>
        <input type="number" min="0" max="30" step="0.01" data-field="taxRate" value="${quote.taxRate || 0}" />
      </div>
    </div>`;
}

// ── Step: Review ─────────────────────────────────────────────────────────────
function renderReviewStep() {
  const calc = calculateQuote();
  const warnings = getHardwareRecommendations().filter(r => r.level === 'warning' || r.level === 'verify');

  return `
    <p class="helper-text">Review everything below before sharing with the customer.</p>

    <div class="summary-section" style="margin-top:.8rem">
      <h3 class="section-heading">Quote summary</h3>
      ${calc.lines.map(l => `
        <div class="summary-item">
          <span>${esc(l.label)}</span>
          <strong>${money(l.amount)}</strong>
        </div>`).join('') || '<p class="helper-text">No items selected yet.</p>'}
      ${calc.appliedPromos.length ? calc.appliedPromos.map(p => `
        <div class="summary-item" style="color:var(--success)">
          <span>🏷 ${esc(p.name)}</span>
          <strong style="color:var(--success)">${p.amount ? '−' + money(p.amount) : 'Applied'}</strong>
        </div>`).join('') : ''}
      <div class="summary-item" style="border-top:1.5px solid var(--navy);margin-top:.4rem;padding-top:.6rem;font-weight:800;color:var(--navy)">
        <span>Estimated total</span>
        <strong>${money(calc.total)}</strong>
      </div>
      ${calc.savings ? `<div class="summary-item" style="color:var(--success);font-size:.88rem"><span>Total savings</span><strong>${money(calc.savings)}</strong></div>` : ''}
    </div>

    ${warnings.length ? `
    <div class="summary-section" style="margin-top:1rem">
      <h3 class="section-heading">⚠ Compatibility warnings</h3>
      ${warnings.map(w => `<div class="warning-item">${esc(w.text)}: ${esc(w.reason)}</div>`).join('')}
    </div>` : ''}

    <div class="summary-section" style="margin-top:1rem">
      <p class="note-text">
        <strong>All prices are approximate and require verification before purchase.</strong>
        Always confirm current pricing, active promotions, and availability with your manager or on sleepnumber.com.
      </p>
    </div>

    <div style="display:flex;flex-direction:column;gap:.5rem;margin-top:1.2rem">
      <button class="btn btn-primary wide" onclick="window._showSummary()">View customer-facing summary →</button>
      <button class="btn btn-secondary wide" onclick="window._copyQuote()">Copy quote text</button>
    </div>`;
}

// Expose globals for onclick in dynamic HTML
window._showSummary = showSummaryScreen;
window._copyQuote   = copyQuoteText;
window.loadSavedQuote   = loadSavedQuote;
window.deleteSavedQuote = deleteSavedQuote;

// ═══════════════════════════════════════════════════════════════════════════
//  STEP EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════

function bindStepEvents() {
  // Option cards
  document.querySelectorAll('.option-card[data-id]').forEach(card => {
    card.addEventListener('click', () => handleCardClick(card.dataset.id));
  });

  // Text/number inputs
  document.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      quote[key] = input.type === 'number' ? Number(input.value || 0) : input.value;
      saveQuote();
      renderSummary();
    });
  });

  // Promo toggles
  document.querySelectorAll('[data-promo]').forEach(cb => {
    cb.addEventListener('change', () => {
      quote.promoToggles[cb.dataset.promo] = cb.checked;
      saveQuote();
      renderSummary();
    });
  });

  // Qty buttons
  document.querySelectorAll('[data-qty-plus]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(btn.dataset.qtyPlus, 1); }));
  document.querySelectorAll('[data-qty-minus]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(btn.dataset.qtyMinus, -1); }));

  // Add-to-quote from rec buttons
  document.querySelectorAll('[data-add-product]').forEach(btn =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.addProduct;
      changeQty(id, 1);
    }));
}

function handleCardClick(rawId) {
  // Prefixed IDs: "scenario:X", "headboard:X", "furniture:X", "protection:X", "height:X", "hasFootboard:X", "hasSideRails:X"
  const [prefix, ...rest] = rawId.split(':');
  const value = rest.join(':');
  const fa = quote.furnitureAnswers;

  switch (prefix) {
    case 'scenario':    fa.scenario = value; break;
    case 'headboard':   fa.headboardPlan = value; break;
    case 'height':      fa.heightConcern = value; break;
    case 'hasFootboard':fa.hasFootboard = value === 'true'; break;
    case 'hasSideRails':fa.hasSideRails = value === 'true'; break;
    case 'furniture':   quote.furnitureId = value; break;
    case 'protection':  quote.protectionPlanId = value; break;
    default:
      // Plain IDs for mattress/size/base
      const step = STEPS[currentStep].id;
      if (step === 'mattress') { quote.mattressId = rawId; quote.sizeId = null; }
      else if (step === 'size')   quote.sizeId    = rawId;
      else if (step === 'base')   quote.baseId    = rawId;
  }

  saveQuote();
  renderStep();
}

function changeQty(id, delta) {
  quote.addons[id] = Math.max(0, (quote.addons[id] || 0) + delta);
  if (!quote.addons[id]) delete quote.addons[id];
  saveQuote();
  renderStep();
}

// ═══════════════════════════════════════════════════════════════════════════
//  HARDWARE RULES ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function getHardwareRecommendations() {
  if (!catalog) return [];
  const recs = [];
  const base = catalog.bases?.find(b => b.id === quote.baseId);
  const isAdj = base?.type === 'adjustable';
  const fa = quote.furnitureAnswers;
  const rules = catalog.hardwareRules || [];

  // Evaluate each rule from catalog
  for (const rule of rules) {
    const c = rule.condition;
    let match = true;

    if (c.baseType !== undefined && base?.type !== c.baseType) match = false;
    if (c.hasFootboard !== undefined && fa.hasFootboard !== c.hasFootboard) match = false;
    if (c.hasSideRails !== undefined && fa.hasSideRails !== c.hasSideRails) match = false;
    if (c.heightConcern !== undefined && fa.heightConcern !== c.heightConcern) match = false;
    if (c.furnitureBrand !== undefined && fa.furnitureBrand !== c.furnitureBrand) match = false;
    if (c.furnitureScenario !== undefined && fa.scenario !== c.furnitureScenario) match = false;
    if (c.sizeId !== undefined && quote.sizeId !== c.sizeId) match = false;
    if (c.baseId !== undefined && quote.baseId !== c.baseId) match = false;
    if (c.headboardPlan !== undefined) {
      if (Array.isArray(c.headboardPlan)) {
        if (!c.headboardPlan.includes(fa.headboardPlan)) match = false;
      } else {
        if (fa.headboardPlan !== c.headboardPlan) match = false;
      }
    }

    if (match) recs.push(rule.recommendation);
  }

  // Extra built-in logic
  if (fa.scenario === 'third-party') {
    const alreadyHas = recs.some(r => r.text?.toLowerCase().includes('third-party'));
    if (!alreadyHas) recs.push({
      level: 'verify',
      text: 'Third-party furniture — verify compatibility',
      reason: 'Check bolt spacing, clearance, weight rating, and bracket compatibility with Sleep Number bed.',
    });
  }

  return recs;
}

function renderHardwareRecs() {
  const recs = getHardwareRecommendations();
  const container = el('hardwareRecs');

  if (!recs.length || STEPS[currentStep].id !== 'furniture') {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <p class="hardware-recs-title">Setup recommendations</p>
    ${recs.map(r => {
      const icons = {
        required:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`,
        recommended: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
        warning:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>`,
        verify:      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`,
        info:        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`,
      };
      const addBtn = r.suggestedProductId ? `
        <button class="btn btn-sm btn-secondary rec-add-btn" data-add-product="${r.suggestedProductId}">+ Add to quote</button>
      ` : '';
      return `<div class="rec-item rec-${r.level}">
        <div class="rec-item-icon">${icons[r.level] || icons.info}</div>
        <div class="rec-item-body">
          <strong>${esc(r.text)}</strong>
          <p>${esc(r.reason)}</p>
          ${addBtn}
        </div>
      </div>`;
    }).join('')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROMO ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function getAppliedPromos(subtotal) {
  const promos = catalog?.promotions || [];
  const applied = [];

  for (const p of promos) {
    if (p.type === 'automatic' && qualifiesForPromo(p, subtotal)) {
      applied.push({ ...p, amount: resolvePromoAmount(p, subtotal), source: 'auto' });
    }
    if ((p.type === 'toggle' || p.type === 'manual') && quote.promoToggles[p.id]) {
      applied.push({ ...p, amount: resolvePromoAmount(p, subtotal), source: 'toggle' });
    }
  }

  return applied;
}

function qualifiesForPromo(promo, subtotal) {
  const rules = promo.conditions || {};
  if (rules.minimumSubtotal && subtotal < rules.minimumSubtotal) return false;
  if (rules.requiresCategories) {
    const cats = selectedCategories();
    if (!rules.requiresCategories.every(c => cats.has(c))) return false;
  }
  return true;
}

function resolvePromoAmount(promo, subtotal) {
  if (promo.discountAmount) return promo.discountAmount;
  if (promo.discountPercent) return Math.round(subtotal * promo.discountPercent / 100);
  return 0;
}

function selectedCategories() {
  const cats = new Set();
  if (quote.mattressId) cats.add('mattress');
  const base = catalog?.bases?.find(b => b.id === quote.baseId);
  if (base) cats.add(base.type === 'adjustable' ? 'adjustable-base' : 'base');
  return cats;
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUOTE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

function calculateQuote(q = quote) {
  const lines = [];
  let subtotal = 0;
  let savings  = 0;

  const sizeId = q.sizeId || 'queen';
  const c = catalog;

  // Mattress
  const mat = c?.mattresses?.find(m => m.id === q.mattressId);
  if (mat) {
    const sp = mat.sizePricing?.[sizeId];
    if (sp) {
      const price   = sp.sale ?? sp.regular ?? 0;
      const regular = sp.regular ?? price;
      if (price) {
        lines.push({ label: `${mat.name} (${SIZES.find(s=>s.id===sizeId)?.label || sizeId})`, amount: price });
        subtotal += price;
        savings  += Math.max(0, regular - price);
      }
    }
  }

  // Base
  const base = c?.bases?.find(b => b.id === q.baseId);
  if (base && base.id !== 'none') {
    const sp    = base.sizePricing?.[sizeId];
    const price = sp?.sale ?? sp?.regular ?? base.price ?? 0;
    if (price) {
      lines.push({ label: base.name, amount: price });
      subtotal += price;
    }
  }

  // Furniture
  const furn = c?.furniture?.find(f => f.id === q.furnitureId);
  if (furn && q.furnitureId !== 'none') {
    const sp    = furn.sizePricing?.[sizeId];
    const price = sp?.sale ?? sp?.regular ?? 0;
    if (price) {
      lines.push({ label: furn.name, amount: price });
      subtotal += price;
    }
  }

  // Hardware addons
  Object.entries(q.addons || {}).forEach(([id, qty]) => {
    const hw = c?.hardware?.find(h => h.id === id);
    if (!hw || !qty) return;
    const price = (hw.salePrice ?? hw.price ?? 0) * qty;
    if (price) {
      lines.push({ label: `${hw.name} × ${qty}`, amount: price });
      subtotal += price;
    }
  });

  // Bedding addons
  (c?.bedding || []).forEach(item => {
    const qty = q.addons?.[item.id];
    if (!qty) return;
    const sp    = item.sizePricing?.[sizeId] || item.sizePricing?.['standard'] || item.sizePricing?.['queen'];
    const price = (sp?.sale ?? sp?.regular ?? item.price ?? 0) * qty;
    if (price) {
      lines.push({ label: `${item.name} × ${qty}`, amount: price });
      subtotal += price;
    }
  });

  // Protection plan
  const plan = (c?.protectionPlans || []).find(p => p.id === q.protectionPlanId);
  if (plan && plan.id !== 'plan-none' && plan.price) {
    lines.push({ label: plan.name, amount: plan.price });
    subtotal += plan.price;
  }

  // Promos
  const appliedPromos = getAppliedPromos(subtotal);
  const promoDiscount = appliedPromos.reduce((sum, p) => sum + (p.amount || 0), 0);

  // Custom discount
  const customDiscount = Number(q.customDiscount || 0);

  // Tax
  const taxBase = Math.max(0, subtotal - promoDiscount - customDiscount);
  const taxRate  = Number(q.taxRate || 0) / 100;
  const tax      = Math.round(taxBase * taxRate * 100) / 100;

  if (customDiscount) lines.push({ label: 'Custom approved discount', amount: -customDiscount, type: 'discount' });
  if (tax) lines.push({ label: `Est. tax (${q.taxRate}%)`, amount: tax });

  const total = Math.max(0, taxBase + tax);
  savings += promoDiscount + customDiscount;

  return { lines, subtotal, savings, total, appliedPromos };
}

function calcTotal(q) {
  try { return calculateQuote(q).total; } catch { return 0; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SIDEBAR SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

function renderSummary() {
  const calc = calculateQuote();

  // Sticky bar (mobile)
  el('stickyTotal').textContent = money(calc.total);
  const stickySavings = el('stickySavings');
  stickySavings.textContent = calc.savings ? `Save ${money(calc.savings)}` : '';
  stickySavings.style.display = calc.savings ? '' : 'none';

  // Desktop sidebar
  el('summaryTotal').textContent = money(calc.total);

  const savings = el('savingsBadge');
  if (calc.savings) {
    savings.textContent = `Save ${money(calc.savings)}`;
    savings.style.display = '';
  } else {
    savings.style.display = 'none';
  }

  const lines = el('summaryLines');
  if (calc.lines.length) {
    lines.innerHTML = calc.lines.map(l => `
      <div class="summary-line ${l.type === 'discount' ? 'discount' : ''}">
        <span>${esc(l.label)}</span>
        <strong>${money(Math.abs(l.amount))}${l.amount < 0 ? ' off' : ''}</strong>
      </div>`).join('');
  } else {
    lines.innerHTML = '<p class="empty-summary">Start selecting options to build a quote.</p>';
  }

  const promoDiv = el('promoLines');
  promoDiv.innerHTML = calc.appliedPromos.map(p => `
    <div class="promo-line">
      <strong>🏷 ${esc(p.name)}</strong>
      <span>${p.amount ? '−' + money(p.amount) : 'Applied'}</span>
    </div>`).join('');

  const warnDiv = el('warningLines');
  const recs = getHardwareRecommendations();
  const warnings = recs.filter(r => r.level === 'warning' || r.level === 'verify');
  warnDiv.innerHTML = warnings.map(w => `
    <div class="warning-line">⚠ ${esc(w.text)}</div>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  CUSTOMER-FACING SUMMARY SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function renderSummaryScreen() {
  const calc  = calculateQuote();
  const mat   = catalog?.mattresses?.find(m => m.id === quote.mattressId);
  const base  = catalog?.bases?.find(b => b.id === quote.baseId);
  const furn  = catalog?.furniture?.find(f => f.id === quote.furnitureId);
  const plan  = catalog?.protectionPlans?.find(p => p.id === quote.protectionPlanId);
  const sz    = SIZES.find(s => s.id === quote.sizeId);
  const recs  = getHardwareRecommendations();
  const warns = recs.filter(r => r.level === 'warning' || r.level === 'verify');
  const hwReq = recs.filter(r => r.level === 'required' || r.level === 'recommended');

  const addonItems = Object.entries(quote.addons || {}).map(([id, qty]) => {
    const hw = catalog?.hardware?.find(h => h.id === id) ||
               catalog?.bedding?.find(b => b.id === id);
    return hw ? `${hw.name} × ${qty}` : null;
  }).filter(Boolean);

  el('customerSummaryCard').innerHTML = `
    <div class="summary-brand">
      <span class="brand-logo-text">sleep<strong>number</strong> Quote Studio</span>
    </div>

    ${quote.customerName ? `<div class="summary-section">
      <h3>Prepared for</h3>
      <div class="summary-item"><span>Name</span><strong>${esc(quote.customerName)}</strong></div>
      ${quote.customerPhone ? `<div class="summary-item"><span>Phone</span><strong>${esc(quote.customerPhone)}</strong></div>` : ''}
    </div>` : ''}

    <div class="summary-section">
      <h3>Selected sleep system</h3>
      ${mat ? `<div class="summary-item"><span>Mattress</span><strong>${esc(mat.name)}</strong></div>` : ''}
      ${sz  ? `<div class="summary-item"><span>Size</span><strong>${esc(sz.label)}</strong></div>` : ''}
      ${base && base.id !== 'none' ? `<div class="summary-item"><span>Base</span><strong>${esc(base.name)}</strong></div>` : ''}
      ${furn && quote.furnitureId !== 'none' ? `<div class="summary-item"><span>Furniture</span><strong>${esc(furn.name)}</strong></div>` : ''}
      ${plan && plan.id !== 'plan-none' ? `<div class="summary-item"><span>Protection</span><strong>${esc(plan.name)}</strong></div>` : ''}
      ${addonItems.length ? `<div class="summary-item"><span>Add-ons</span><strong>${addonItems.map(esc).join(', ')}</strong></div>` : ''}
    </div>

    <div class="summary-section">
      <h3>Pricing</h3>
      ${calc.lines.map(l => `
        <div class="summary-item">
          <span>${esc(l.label)}</span>
          <strong>${l.amount < 0 ? '−' + money(Math.abs(l.amount)) : money(l.amount)}</strong>
        </div>`).join('')}
      ${calc.appliedPromos.map(p => `
        <div class="summary-item" style="color:var(--success)">
          <span>🏷 ${esc(p.name)}</span>
          <strong>${p.amount ? '−' + money(p.amount) : 'Applied'}</strong>
        </div>`).join('')}
    </div>

    <div class="summary-total-row">
      <span>Estimated total</span>
      <strong>${money(calc.total)}</strong>
    </div>
    ${calc.savings ? `<div class="summary-savings-row"><span>You save</span><strong>${money(calc.savings)}</strong></div>` : ''}

    ${hwReq.length ? `
    <div class="summary-section" style="margin-top:1.2rem">
      <h3>Setup recommendations</h3>
      ${hwReq.map(r => `<div class="summary-item"><span>${esc(r.text)}</span><strong class="badge-${r.level === 'required' ? 'required' : 'recommended'}" style="font-size:.8rem">${r.level === 'required' ? 'Required' : 'Recommended'}</strong></div>`).join('')}
    </div>` : ''}

    ${warns.length ? `
    <div class="summary-section" style="margin-top:1rem">
      <h3>Compatibility notes</h3>
      ${warns.map(w => `<div class="warning-item">${esc(w.text)}</div>`).join('')}
    </div>` : ''}

    <div class="summary-disclaimer">
      <strong>Verify before purchase:</strong> All prices are approximate and subject to change.
      Promotions, availability, and financing terms must be confirmed with the associate at time of purchase.
      Catalog last updated: ${fmtDate(catalog?.lastUpdated)}.
    </div>
    <p class="summary-timestamp">Quote built with Sleep Number Quote Studio · ${new Date().toLocaleString()}</p>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════

function renderAdminScreen() {
  const c = catalog;

  if (!c) {
    el('adminBody').innerHTML = `<div class="admin-card">
      <p class="helper-text">No catalog loaded. Tap Refresh catalog on the home screen.</p>
    </div>`;
    return;
  }

  const sources = c.metadata?.sourceResults || c.sourceResults || [];
  const warnings = [];

  // Detect low-confidence items
  c.mattresses?.forEach(m => {
    if ((m.confidenceScore || 1) < 0.7)
      warnings.push(`Low confidence pricing: ${m.name}`);
  });

  // Check for missing prices
  c.mattresses?.forEach(m => {
    const hasPrices = Object.values(m.sizePricing || {}).some(sp => sp.regular);
    if (!hasPrices) warnings.push(`Missing prices: ${m.name}`);
  });

  const totalProducts =
    (c.mattresses?.length || 0) +
    (c.bases?.length || 0) +
    (c.furniture?.length || 0) +
    (c.hardware?.length || 0) +
    (c.bedding?.length || 0);

  el('adminBody').innerHTML = `

    <div class="admin-card">
      <h3>Catalog overview</h3>
      <div class="admin-stat">
        <div class="stat-item"><span class="stat-num">${c.mattresses?.length || 0}</span><span class="stat-label">Mattresses</span></div>
        <div class="stat-item"><span class="stat-num">${c.bases?.length || 0}</span><span class="stat-label">Bases</span></div>
        <div class="stat-item"><span class="stat-num">${c.promotions?.length || 0}</span><span class="stat-label">Promotions</span></div>
      </div>
      <div class="admin-stat">
        <div class="stat-item"><span class="stat-num">${c.hardware?.length || 0}</span><span class="stat-label">Hardware items</span></div>
        <div class="stat-item"><span class="stat-num">${c.bedding?.length || 0}</span><span class="stat-label">Bedding items</span></div>
        <div class="stat-item"><span class="stat-num">${c.hardwareRules?.length || 0}</span><span class="stat-label">HW rules</span></div>
      </div>
      <p style="font-size:.82rem;color:var(--muted);margin-top:.4rem">
        Last updated: <strong>${fmtDate(c.lastUpdated)}</strong><br>
        Schema version: ${c.schemaVersion || '?'}
      </p>
    </div>

    <div class="admin-card">
      <h3>Source health</h3>
      ${sources.length ? sources.map(s => `
        <div class="source-item ${s.ok ? 'source-ok' : 'source-fail'}">
          <span>${esc(s.name || s.url)}</span>
          <strong>${s.ok ? `✓ ${s.importedProducts || 0} products` : `✗ ${esc(s.error || 'Failed')}`}</strong>
        </div>`).join('') : `
        <div class="source-item source-skip">
          No external sources configured. Add public Sleep Number URLs in <code>scripts/sources.json</code>.
        </div>`}
      <p style="font-size:.8rem;color:var(--muted);margin-top:.6rem">${esc(c.metadata?.crawlNote || c.sourceNotes || '')}</p>
    </div>

    ${warnings.length ? `
    <div class="admin-card">
      <h3>⚠ Warnings (${warnings.length})</h3>
      <div class="warning-list">
        ${warnings.map(w => `<div class="warning-item">${esc(w)}</div>`).join('')}
      </div>
    </div>` : `
    <div class="admin-card" style="background:var(--success-bg);border-color:rgba(22,163,74,.2)">
      <h3 style="color:var(--success)">✓ No catalog warnings</h3>
      <p style="font-size:.88rem;color:var(--success)">All products have prices and confidence scores look OK.</p>
    </div>`}

    <div class="admin-card">
      <h3>Low-confidence items</h3>
      ${c.mattresses?.filter(m => (m.confidenceScore || 1) < 0.7).map(m =>
        `<div class="warning-item">${esc(m.name)} — confidence ${m.confidenceScore || '?'} — ${esc(m.lastVerified || 'never verified')}</div>`
      ).join('') || '<p style="font-size:.88rem;color:var(--muted)">None</p>'}
    </div>

    <div class="admin-card">
      <h3>How to refresh catalog</h3>
      <p style="font-size:.88rem;color:var(--muted);line-height:1.6">
        The catalog is automatically refreshed daily by GitHub Actions at 5 AM Central Time.<br>
        To manually trigger: go to the repository → Actions tab → "Update mattress quote catalog" → Run workflow.<br>
        To refresh in the app: tap the <strong>Refresh catalog</strong> button on the home screen while on unrestricted internet.
      </p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COPY / EXPORT
// ═══════════════════════════════════════════════════════════════════════════

async function copyQuoteText() {
  const calc = calculateQuote();
  const mat  = catalog?.mattresses?.find(m => m.id === quote.mattressId);
  const base = catalog?.bases?.find(b => b.id === quote.baseId);
  const sz   = SIZES.find(s => s.id === quote.sizeId);
  const recs = getHardwareRecommendations().filter(r => r.level === 'required' || r.level === 'recommended');
  const warns= getHardwareRecommendations().filter(r => r.level === 'warning' || r.level === 'verify');

  const lines = [
    'SLEEP NUMBER QUOTE',
    '══════════════════',
    quote.customerName ? `Customer: ${quote.customerName}` : '',
    '',
    mat  ? `Mattress: ${mat.name}` : 'Mattress: Not selected',
    sz   ? `Size: ${sz.label}` : '',
    base && base.id !== 'none' ? `Base: ${base.name}` : '',
    '',
    '── Line items ──────────────',
    ...calc.lines.map(l => `  ${l.label}: ${l.amount < 0 ? '−' + money(Math.abs(l.amount)) : money(l.amount)}`),
    '',
    `Estimated total: ${money(calc.total)}`,
    calc.savings ? `Total savings:   ${money(calc.savings)}` : '',
    '',
    ...calc.appliedPromos.map(p => `Promo: ${p.name}${p.amount ? ' (−' + money(p.amount) + ')' : ''}`),
    recs.length ? '\n── Setup recommendations ────' : '',
    ...recs.map(r => `  [${r.level.toUpperCase()}] ${r.text}`),
    warns.length ? '\n── Compatibility warnings ───' : '',
    ...warns.map(w => `  ⚠ ${w.text}`),
    '',
    '── Notes ───────────────────',
    'All prices are approximate and require verification.',
    'Confirm current pricing and promotions before purchase.',
    `Catalog updated: ${fmtDate(catalog?.lastUpdated)}`,
    `Quote date: ${new Date().toLocaleDateString()}`,
  ].filter(l => l !== null && l !== undefined).join('\n').replace(/\n\n\n+/g, '\n\n');

  try {
    await navigator.clipboard.writeText(lines);
    toast('Quote copied to clipboard ✓');
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = lines;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Quote copied ✓');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD BUILDER HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function optionCard({ id, selected, extra = '', title, subtitle, price, priceLabel, onSale, regularPrice, features, warnings: warns }) {
  const priceHtml = price !== null && price !== undefined
    ? `<span class="card-price ${onSale ? 'card-sale' : 'card-verify'}">${money(price)}${onSale && regularPrice ? ` <s style="opacity:.5">${money(regularPrice)}</s>` : ''} <small>${priceLabel || 'Verify'}</small></span>`
    : (priceLabel ? `<span class="card-price card-verify"><small>${esc(priceLabel)}</small></span>` : '');

  const featuresHtml = features?.length
    ? `<ul class="feature-list">${features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';

  const warnsHtml = warns?.length
    ? `<p style="font-size:.75rem;color:var(--warning);margin-top:.3rem">⚠ ${esc(warns[0])}</p>`
    : '';

  return `<button class="option-card ${selected ? 'selected' : ''}" data-id="${esc(id)}">
    <span class="card-check" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
    </span>
    ${extra}
    <h3>${esc(title)}</h3>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
    ${priceHtml}
    ${featuresHtml}
    ${warnsHtml}
  </button>`;
}

function yesNoCard(id, selected, label, desc) {
  return optionCard({ id, selected, title: label, subtitle: desc });
}

function qtyCard(item, bucket) {
  const qty = quote[bucket]?.[item.id] || 0;
  return qtyCardItem({ ...item, _qty: qty });
}

function qtyCardItem(item) {
  const qty = quote.addons?.[item.id] || 0;
  const price = item.basePrice ?? item.price ?? 0;
  return `<div class="option-card ${qty > 0 ? 'selected' : ''}" style="cursor:default">
    <h3>${esc(item.name)}</h3>
    <p>${esc(item.description || '')}</p>
    ${price ? `<span class="card-price">${money(price)} <small>${esc(item.priceLabel || 'Verify')}</small></span>` : ''}
    <div class="qty-control">
      <button class="btn btn-secondary btn-qty btn-sm" data-qty-minus="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button>
      <span class="qty-num" aria-live="polite">${qty}</span>
      <button class="btn btn-primary btn-qty btn-sm" data-qty-plus="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function el(id) { return document.getElementById(id); }

function esc(str) {
  return String(str ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function money(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  }).format(n);
}

function fmtDate(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(value); }
}

function toast(message) {
  const t = el('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}
