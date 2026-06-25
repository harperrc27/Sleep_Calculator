/* ── Constants ──────────────────────────────────────────── */
const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY   = 'sn_quote_catalog_v2';
const QUOTE_KEY   = 'sn_quote_draft_v2';

const STEPS = [
  { id: 'customer',  title: 'Customer info' },
  { id: 'series',    title: 'Choose a series' },
  { id: 'model',     title: 'Pick a model & size' },
  { id: 'base',      title: 'Choose a base' },
  { id: 'hardware',  title: 'Furniture & hardware setup' },
  { id: 'bedding',   title: 'Bedding & pillows' },
  { id: 'plan',      title: 'Protection plan' },
  { id: 'promos',    title: 'Promos & discounts' },
  { id: 'review',    title: 'Review quote' },
];

/* ── State ──────────────────────────────────────────────── */
let catalog = null;
let currentStep = 0;
let quote = loadQuote();
let deferredInstallPrompt = null;
let adminOpen = false;

/* ── Shortcuts ──────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

/* ── PWA Install ─────────────────────────────────────────── */
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('installBtn').classList.remove('hidden');
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').classList.add('hidden');
});

/* ── Navigation ──────────────────────────────────────────── */
$('refreshCatalogBtn').addEventListener('click', () => refreshCatalog(true));
$('backBtn').addEventListener('click', () => { currentStep = Math.max(0, currentStep - 1); render(); });
$('nextBtn').addEventListener('click', () => { currentStep = Math.min(STEPS.length - 1, currentStep + 1); render(); });
$('copyQuoteBtn').addEventListener('click', copyQuote);
$('saveQuoteBtn').addEventListener('click', saveQuoteToStorage);
$('resetBtn').addEventListener('click', () => {
  if (!confirm('Start a new quote? Current quote will be lost.')) return;
  quote = defaultQuote();
  currentStep = 0;
  persistQuote();
  render();
  toast('Quote reset');
});

/* ── Admin panel ─────────────────────────────────────────── */
$('adminToggleBtn').addEventListener('click', () => {
  adminOpen = !adminOpen;
  $('adminPanel').classList.toggle('hidden', !adminOpen);
  if (adminOpen) renderAdminPanel();
});
$('adminCloseBtn').addEventListener('click', () => {
  adminOpen = false;
  $('adminPanel').classList.add('hidden');
});

/* ── Init ────────────────────────────────────────────────── */
init();

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  catalog = readSavedCatalog();
  updateCatalogStatus(catalog ? 'saved' : 'empty');
  render();
  await refreshCatalog(false);
}

/* ══════════════════════════════════════════════════════════
   CATALOG MANAGEMENT
══════════════════════════════════════════════════════════ */
async function refreshCatalog(showToast) {
  try {
    updateCatalogStatus('loading');
    const res = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
    const next = await res.json();
    validateCatalog(next);
    catalog = next;
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    updateCatalogStatus('fresh');
    normalizeQuote();
    render();
    if (adminOpen) renderAdminPanel();
    if (showToast) toast('Catalog refreshed — saved for offline use');
  } catch (err) {
    updateCatalogStatus(catalog ? 'saved' : 'error', err.message);
    if (showToast) toast(catalog ? 'Could not refresh — using saved catalog.' : 'No catalog available. Try refreshing on normal internet.');
  }
}

function readSavedCatalog() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function validateCatalog(data) {
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.addons) || !Array.isArray(data.series)) {
    throw new Error('Catalog is missing required fields (products/addons/series)');
  }
}

function updateCatalogStatus(mode, detail = '') {
  const dot  = $('statusDot');
  const meta = $('catalogMeta');
  dot.className = 'status-dot';
  if (mode === 'loading') {
    $('catalogStatus').textContent = 'Refreshing catalog…';
    meta.textContent = 'Fetching the latest catalog from GitHub.';
  } else if (mode === 'fresh') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Catalog up to date';
    meta.textContent = `Updated: ${formatDate(catalog?.lastUpdated)} · ${catalog?.products?.length ?? 0} products`;
  } else if (mode === 'saved') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Using saved catalog';
    meta.textContent = `Saved: ${formatDate(catalog?.lastUpdated)} · Works offline`;
  } else if (mode === 'error') {
    dot.classList.add('bad');
    $('catalogStatus').textContent = 'No catalog loaded';
    meta.textContent = detail || 'Press Refresh on unrestricted internet first.';
  } else {
    $('catalogStatus').textContent = 'No saved catalog';
    meta.textContent = 'Tap Refresh before going onto restricted Wi-Fi.';
  }
}

/* ══════════════════════════════════════════════════════════
   QUOTE MODEL
══════════════════════════════════════════════════════════ */
function defaultQuote() {
  return {
    // Step 1 – Customer
    customerName: '',
    customerPhone: '',
    // Step 2 – Series
    seriesId: null,
    sizeFilter: 'All',
    // Step 3 – Model
    productId: null,
    // Step 4 – Base
    baseId: 'none',
    // Step 5 – Hardware wizard
    hwSetup: 'new',            // 'new' | 'add'
    hwHeadboard: 'none',       // 'none' | 'sleep-number' | 'third-party'
    hwFootboard: false,
    hwSideRails: false,
    hwSupportType: 'base',     // 'base' | 'platform' | 'none'
    hwHeightPreference: 'standard', // 'standard' | 'higher' | 'lower'
    hardware: {},              // id -> qty
    // Step 6 – Bedding
    bedding: {},               // id -> qty
    // Step 7 – Plan
    planId: 'none',
    // Step 8 – Promos
    toggles: {},
    customDiscount: 0,
    taxRate: 0,
    financingMonths: 0,
  };
}

function loadQuote() {
  try {
    return { ...defaultQuote(), ...(JSON.parse(localStorage.getItem(QUOTE_KEY) || '{}')) };
  } catch {
    return defaultQuote();
  }
}

function persistQuote() {
  localStorage.setItem(QUOTE_KEY, JSON.stringify(quote));
}

function normalizeQuote() {
  if (!catalog) return;
  if (quote.seriesId  && !catalog.series.some(s => s.id === quote.seriesId))    quote.seriesId = null;
  if (quote.productId && !catalog.products.some(p => p.id === quote.productId)) quote.productId = null;
  if (quote.baseId    && quote.baseId !== 'none' && !catalog.addons.some(a => a.id === quote.baseId)) quote.baseId = 'none';
  if (quote.planId    && quote.planId !== 'none' && !catalog.addons.some(a => a.id === quote.planId)) quote.planId = 'none';
  persistQuote();
}

/* ══════════════════════════════════════════════════════════
   MAIN RENDER
══════════════════════════════════════════════════════════ */
function render() {
  updateChrome();
  if (!catalog) {
    $('stepBody').innerHTML = `<div class="empty-state">
      <h3>No catalog loaded yet</h3>
      <p class="helper">Press <strong>Refresh catalog</strong> while on normal internet. After that, this app works fully offline from the saved data.</p>
    </div>`;
    renderSummary();
    return;
  }
  const stepId = STEPS[currentStep].id;
  const renderers = {
    customer:  renderCustomer,
    series:    renderSeries,
    model:     renderModel,
    base:      renderBase,
    hardware:  renderHardware,
    bedding:   renderBedding,
    plan:      renderPlan,
    promos:    renderPromos,
    review:    renderReview,
  };
  $('stepBody').innerHTML = renderers[stepId]();
  bindStepEvents(stepId);
  renderSummary();
}

function updateChrome() {
  $('stepCounter').textContent  = `Step ${currentStep + 1} of ${STEPS.length}`;
  $('stepTitle').textContent    = STEPS[currentStep].title;
  $('progressBar').style.width  = `${((currentStep + 1) / STEPS.length) * 100}%`;
  $('backBtn').disabled         = currentStep === 0;
  $('nextBtn').textContent      = currentStep === STEPS.length - 1 ? 'Start over' : 'Continue';
  if (currentStep === STEPS.length - 1) {
    $('nextBtn').onclick = () => {
      quote = defaultQuote();
      currentStep = 0;
      persistQuote();
      render();
      toast('Started new quote');
    };
  } else {
    $('nextBtn').onclick = null;
  }
}

/* ══════════════════════════════════════════════════════════
   STEP RENDERERS
══════════════════════════════════════════════════════════ */

/* Step 1 – Customer */
function renderCustomer() {
  return `
    <p class="customer-intro">Customer details are optional but help personalise the quote summary.</p>
    <div class="form-grid">
      <label class="field">
        <span>Customer name</span>
        <input type="text" data-field="customerName" value="${escHtml(quote.customerName)}" placeholder="e.g. Alex Johnson" autocomplete="name" />
      </label>
      <label class="field">
        <span>Phone (optional)</span>
        <input type="tel" data-field="customerPhone" value="${escHtml(quote.customerPhone)}" placeholder="e.g. 555-867-5309" autocomplete="tel" />
      </label>
    </div>
    <p class="helper mt-md">This information stays on your device only — it is never transmitted anywhere.</p>`;
}

/* Step 2 – Series */
function renderSeries() {
  return `
    <div class="grid two-col">
      ${catalog.series.map(s => cardOption({
        id: s.id,
        title: s.name,
        subtitle: s.tagline || '',
        selected: quote.seriesId === s.id,
        extra: `<div class="logo-mark">${escHtml(s.name)}</div>${s.badge ? `<span class="badge">${escHtml(s.badge)}</span>` : ''}`,
        body: `<p>${escHtml(s.description || '')}</p>`,
      })).join('')}
    </div>`;
}

/* Step 3 – Model & size */
function renderModel() {
  if (!quote.seriesId) {
    return `<p class="helper">Choose a series first (step 2) to see available models.</p>`;
  }
  const sizes = ['All', ...unique(
    catalog.products.filter(p => p.seriesId === quote.seriesId).map(p => p.size)
  )];
  const products = catalog.products.filter(p => {
    if (p.seriesId !== quote.seriesId) return false;
    if (quote.sizeFilter && quote.sizeFilter !== 'All' && p.size !== quote.sizeFilter) return false;
    return true;
  });
  return `
    <div class="filter-bar">
      ${sizes.map(s => `<button class="filter-chip ${(quote.sizeFilter || 'All') === s ? 'active' : ''}" data-size-filter="${escHtml(s)}">${escHtml(s)}</button>`).join('')}
    </div>
    <div class="grid">
      ${products.map(p => {
        const sale = p.salePrice ?? p.retailPrice;
        const save = Math.max(0, (p.retailPrice || 0) - sale);
        return cardOption({
          id: p.id,
          title: `${escHtml(p.model)} — ${escHtml(p.size)}`,
          subtitle: p.description || '',
          selected: quote.productId === p.id,
          extra: `<span class="badge ${p.verificationRequired ? 'verify' : ''}">${money(sale)}${save ? ` · save ${money(save)}` : ''}${p.verificationRequired ? ' ⚠ verify' : ''}</span>
                  ${(p.tags || []).includes('requires-two-bases') ? '<span class="badge warn">Requires 2 bases</span>' : ''}`,
        });
      }).join('')}
    </div>`;
}

/* Step 4 – Base */
function renderBase() {
  const categories = ['adjustable-base', 'integrated-base', 'foundation'];
  const none = { id: 'none', name: 'No base / Skip', description: 'Skip if the customer already has a base or will arrange support separately.', price: 0, category: 'none' };
  const items = [none, ...catalog.addons.filter(a => categories.includes(a.category))];
  return `
    <div class="grid">
      ${items.map(item => cardOption({
        id: item.id,
        title: item.name,
        subtitle: item.description || item.category,
        selected: quote.baseId === item.id,
        extra: item.id !== 'none'
          ? `<span class="badge ${item.verificationRequired ? 'verify' : ''}">${money(item.price)}${item.verificationRequired ? ' ⚠ verify' : ''}</span>`
          : `<span class="badge info">No charge</span>`,
      })).join('')}
    </div>`;
}

/* Step 5 – Hardware & Furniture Wizard */
function renderHardware() {
  const base = addonById(quote.baseId);
  const isAdjustable = base && base.category === 'adjustable-base';
  const product = productById(quote.productId);
  const splitBed = (product?.tags || []).includes('requires-two-bases');

  const recs = getHardwareRecommendations();

  return `
    <!-- Section: Setup type -->
    <div class="hw-section">
      <p class="hw-section-title">Setup type</p>
      <div class="grid two-col">
        ${radioCard('hwSetup', 'new', 'Complete new bed setup', 'Starting fresh — new mattress, base, and furniture.', quote.hwSetup === 'new')}
        ${radioCard('hwSetup', 'add', 'Adding to existing setup', 'Customer already has some furniture or a frame.', quote.hwSetup === 'add')}
      </div>
    </div>

    <!-- Section: Headboard -->
    <div class="hw-section">
      <p class="hw-section-title">Headboard</p>
      <div class="grid">
        ${radioCard('hwHeadboard', 'none', 'No headboard', 'No headboard needed.', quote.hwHeadboard === 'none')}
        ${radioCard('hwHeadboard', 'sleep-number', 'Sleep Number headboard', 'Using a Sleep Number furniture headboard.', quote.hwHeadboard === 'sleep-number')}
        ${radioCard('hwHeadboard', 'third-party', 'Third-party headboard', 'Using an existing or non-Sleep Number headboard.', quote.hwHeadboard === 'third-party')}
      </div>
      ${isAdjustable && quote.hwHeadboard !== 'none' ? `<p class="badge warn mt-sm">⚠ Headboard bracket kit likely required with adjustable base</p>` : ''}
      ${quote.hwHeadboard === 'third-party' ? `<p class="badge verify mt-sm">Verify bolt spacing, clearance, and bracket compatibility</p>` : ''}
    </div>

    <!-- Section: Footboard & rails -->
    <div class="hw-section">
      <p class="hw-section-title">Footboard & side rails</p>
      <div class="grid two-col">
        <label class="toggle-row">
          <input type="checkbox" data-hw-check="hwFootboard" ${quote.hwFootboard ? 'checked' : ''}>
          <span><strong>Has a footboard</strong><p>Customer has or wants a footboard.</p></span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" data-hw-check="hwSideRails" ${quote.hwSideRails ? 'checked' : ''}>
          <span><strong>Has side rails</strong><p>Customer has or wants side rails.</p></span>
        </label>
      </div>
      ${isAdjustable && quote.hwFootboard ? `<p class="badge warn mt-sm">⚠ Footboard solution bar likely required with adjustable base</p>` : ''}
    </div>

    <!-- Section: Floor support -->
    <div class="hw-section">
      <p class="hw-section-title">Floor/support type</p>
      <div class="grid">
        ${radioCard('hwSupportType', 'base', 'Sleep Number base', 'Using the selected Sleep Number base for support.', quote.hwSupportType === 'base')}
        ${radioCard('hwSupportType', 'platform', 'Platform bed / slats', 'Using a platform bed or slatted frame.', quote.hwSupportType === 'platform')}
        ${radioCard('hwSupportType', 'none', 'No support / unsure', 'Support type not yet determined.', quote.hwSupportType === 'none')}
      </div>
      ${quote.hwSupportType === 'platform' ? `<p class="badge verify mt-sm">Verify flat support, clearance, and Sleep Number compatibility</p>` : ''}
    </div>

    <!-- Section: Bed height -->
    <div class="hw-section">
      <p class="hw-section-title">Bed height preference</p>
      <div class="grid">
        ${radioCard('hwHeightPreference', 'standard', 'Standard height', 'Default height works well.', quote.hwHeightPreference === 'standard')}
        ${radioCard('hwHeightPreference', 'higher', 'Higher preferred', 'Easier entry/exit or more under-bed storage.', quote.hwHeightPreference === 'higher')}
        ${radioCard('hwHeightPreference', 'lower', 'Lower preferred', 'Closer-to-floor feel.', quote.hwHeightPreference === 'lower')}
      </div>
    </div>

    <!-- Section: Split king warning -->
    ${splitBed ? `<div class="hw-alert warning mt-sm"><span class="hw-alert-icon">⚠</span><div class="hw-alert-body"><strong>Split bed requires 2 bases</strong>This size needs two separate FlexFit adjustable bases (one per side). Confirm base quantity in the base step.</div></div>` : ''}

    <!-- Section: Replacement parts & missing hardware -->
    <div class="hw-section">
      <p class="hw-section-title">Missing hardware / replacement parts</p>
      <div class="grid two-col">
        ${['hw-remote', 'hw-power-cord', 'hw-air-cap', 'hw-retainer-bar'].map(id => {
          const item = addonById(id);
          if (!item) return '';
          const qty = quote.hardware[id] || 0;
          return `<div class="card-option ${qty ? 'selected' : ''}">
            <h3>${escHtml(item.name)}</h3>
            <p>${escHtml(item.description || '')}</p>
            <span class="badge ${item.verificationRequired ? 'verify' : ''}">${money(item.price)}${item.verificationRequired ? ' ⚠ verify' : ''}</span>
            <div class="qty-row">
              <button data-qty-minus="hardware:${id}" class="secondary">−</button>
              <span>${qty}</span>
              <button data-qty-plus="hardware:${id}">+</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Recommendations -->
    ${recs.length ? `
    <div class="hw-recommendations">
      <h4>📋 Setup recommendations</h4>
      ${recs.map(rec => `
        <div class="hw-rec-item">
          <div class="hw-rec-label">
            ${escHtml(rec.message)}
            ${rec.items.length ? `<span>${rec.items.map(i => i.name).join(', ')}</span>` : ''}
          </div>
          <div class="hw-rec-actions">
            ${rec.items.map(item => {
              const qty = quote.hardware[item.id] || 0;
              return qty
                ? `<span class="badge success">Added ×${qty}</span>`
                : `<button class="small" data-add-hw="${item.id}">+ Add</button>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>` : ''}

    <!-- Furniture items -->
    <div class="hw-section mt-md">
      <p class="hw-section-title">Furniture (optional)</p>
      <div class="grid two-col">
        ${catalog.addons.filter(a => a.category === 'furniture').map(item => {
          const qty = quote.hardware[item.id] || 0;
          return `<div class="card-option ${qty ? 'selected' : ''}${(item.warnings || []).length ? ' warn-card' : ''}">
            <h3>${escHtml(item.name)}</h3>
            <p>${escHtml(item.description || '')}</p>
            <span class="badge ${item.verificationRequired ? 'verify' : ''}">${money(item.price)}${item.verificationRequired ? ' ⚠ verify' : ''}</span>
            ${(item.warnings || []).map(w => `<span class="badge warn">${escHtml(w)}</span>`).join('')}
            <div class="qty-row">
              <button data-qty-minus="hardware:${item.id}" class="secondary">−</button>
              <span>${qty}</span>
              <button data-qty-plus="hardware:${item.id}">+</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* Step 6 – Bedding & Pillows */
function renderBedding() {
  const items = catalog.addons.filter(a => ['bedding', 'pillow'].includes(a.category));
  if (!items.length) return '<p class="helper">No bedding items in catalog yet.</p>';
  return `
    <div class="grid">
      ${items.map(item => {
        const qty = quote.bedding[item.id] || 0;
        return `<div class="card-option ${qty ? 'selected' : ''}">
          <h3>${escHtml(item.name)}</h3>
          <p>${escHtml(item.description || '')}</p>
          <span class="badge ${item.verificationRequired ? 'verify' : ''}">${money(item.price)} each${item.verificationRequired ? ' ⚠ verify' : ''}</span>
          <div class="qty-row">
            <button data-qty-minus="bedding:${item.id}" class="secondary">−</button>
            <span>${qty}</span>
            <button data-qty-plus="bedding:${item.id}">+</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/* Step 7 – Protection plan */
function renderPlan() {
  const none = { id: 'none', name: 'No plan', description: 'Decline protection plan.', price: 0 };
  const plans = [none, ...catalog.addons.filter(a => a.category === 'protection-plan')];
  return `
    <div class="grid">
      ${plans.map(p => cardOption({
        id: p.id,
        title: p.name,
        subtitle: p.description || '',
        selected: quote.planId === p.id,
        extra: p.id !== 'none'
          ? `${p.badge ? `<span class="badge success">${escHtml(p.badge)}</span>` : ''}
             <span class="badge ${p.verificationRequired ? 'verify' : ''}">${money(p.price)}${p.verificationRequired ? ' ⚠ verify' : ''}</span>`
          : `<span class="badge info">No charge</span>`,
      })).join('')}
    </div>`;
}

/* Step 8 – Promos */
function renderPromos() {
  const calc  = calculateQuote();
  const autos = calc.automaticPromos;
  const fins  = catalog.promos.filter(p => p.type === 'financing');
  const toggles = catalog.promos.filter(p => ['toggle', 'manual'].includes(p.type));

  return `
    <!-- Automatic promos -->
    <h3>Auto-applied promos</h3>
    <div class="promo-list">
      ${autos.length
        ? autos.map(p => `<div class="promo-item"><strong>${escHtml(p.name)}</strong><span class="promo-amount">−${money(p.amount)}</span></div>`).join('')
        : '<div class="promo-item text-muted">No automatic promos qualify yet.</div>'}
    </div>

    <!-- Financing options -->
    <h3 class="mt-md">Financing options</h3>
    <div class="toggle-list">
      ${fins.map(p => `
        <label class="toggle-row">
          <input type="checkbox" data-promo-toggle="${p.id}" ${quote.toggles[p.id] ? 'checked' : ''}>
          <span>
            <strong>${escHtml(p.name)}</strong>
            <p>${escHtml(p.description || '')}${p.verificationRequired ? ' <em>— verify current offer</em>' : ''}</p>
          </span>
        </label>`).join('')}
    </div>

    <!-- Conditional discounts -->
    <h3 class="mt-md">Conditional discounts</h3>
    <div class="toggle-list">
      ${toggles.map(p => `
        <label class="toggle-row">
          <input type="checkbox" data-promo-toggle="${p.id}" ${quote.toggles[p.id] ? 'checked' : ''}>
          <span>
            <strong>${escHtml(p.name)}${p.customerQualificationRequired ? ' — qualification required' : ''}</strong>
            <p>${escHtml(p.description || '')}</p>
          </span>
        </label>`).join('')}
    </div>

    <!-- Manual overrides -->
    <h3 class="mt-md">Manual overrides</h3>
    <div class="form-grid">
      <label class="field">
        <span>Custom approved discount ($)</span>
        <input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}" />
      </label>
      <label class="field">
        <span>Estimated tax (%)</span>
        <input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate || 0}" />
      </label>
      <label class="field">
        <span>Financing term (months, 0 = none)</span>
        <input type="number" min="0" step="1" data-field="financingMonths" value="${quote.financingMonths || 0}" />
      </label>
    </div>`;
}

/* Step 9 – Review */
function renderReview() {
  const calc    = calculateQuote();
  const product = productById(quote.productId);
  const base    = addonById(quote.baseId);
  const plan    = addonById(quote.planId);
  const allPromos = [...calc.automaticPromos, ...calc.togglePromos];
  const recs    = getHardwareRecommendations();
  const hasVerify = calc.lines.some(l => l.verify);

  const financing = quote.financingMonths > 0 && calc.total > 0
    ? `~${money(calc.total / quote.financingMonths)}/mo for ${quote.financingMonths} months (0% APR — verify with finance)`
    : null;

  return `
    <div class="review-block">
      <h4>Customer</h4>
      <div class="review-line"><span>Name</span><strong>${escHtml(quote.customerName || '—')}</strong></div>
      <div class="review-line"><span>Phone</span><strong>${escHtml(quote.customerPhone || '—')}</strong></div>
    </div>

    <div class="review-block">
      <h4>Mattress</h4>
      ${product
        ? `<div class="review-line"><span>${escHtml(product.model)} — ${escHtml(product.size)}</span><strong>${money(product.salePrice ?? product.retailPrice)}${product.verificationRequired ? ' ⚠' : ''}</strong></div>`
        : '<div class="review-line text-muted"><span>No mattress selected</span></div>'}
    </div>

    <div class="review-block">
      <h4>Base</h4>
      ${base && base.id !== 'none'
        ? `<div class="review-line"><span>${escHtml(base.name)}</span><strong>${money(base.price)}${base.verificationRequired ? ' ⚠' : ''}</strong></div>`
        : '<div class="review-line text-muted"><span>No base selected</span></div>'}
    </div>

    ${Object.entries(quote.hardware).filter(([,q]) => q > 0).length ? `
    <div class="review-block">
      <h4>Hardware & Furniture</h4>
      ${Object.entries(quote.hardware).filter(([,q]) => q > 0).map(([id, qty]) => {
        const item = addonById(id);
        if (!item) return '';
        return `<div class="review-line"><span>${escHtml(item.name)} ×${qty}</span><strong>${money(item.price * qty)}${item.verificationRequired ? ' ⚠' : ''}</strong></div>`;
      }).join('')}
    </div>` : ''}

    ${Object.entries(quote.bedding).filter(([,q]) => q > 0).length ? `
    <div class="review-block">
      <h4>Bedding & Pillows</h4>
      ${Object.entries(quote.bedding).filter(([,q]) => q > 0).map(([id, qty]) => {
        const item = addonById(id);
        if (!item) return '';
        return `<div class="review-line"><span>${escHtml(item.name)} ×${qty}</span><strong>${money(item.price * qty)}${item.verificationRequired ? ' ⚠' : ''}</strong></div>`;
      }).join('')}
    </div>` : ''}

    ${plan && plan.id !== 'none' ? `
    <div class="review-block">
      <h4>Protection Plan</h4>
      <div class="review-line"><span>${escHtml(plan.name)}</span><strong>${money(plan.price)}${plan.verificationRequired ? ' ⚠' : ''}</strong></div>
    </div>` : ''}

    ${allPromos.length ? `
    <div class="review-block">
      <h4>Promos & Discounts</h4>
      ${allPromos.map(p => `<div class="review-line review-savings"><span>${escHtml(p.name)}</span><strong>−${money(p.amount)}</strong></div>`).join('')}
      ${quote.customDiscount ? `<div class="review-line review-savings"><span>Custom approved discount</span><strong>−${money(quote.customDiscount)}</strong></div>` : ''}
    </div>` : ''}

    <div class="review-block">
      <h4>Totals</h4>
      <div class="review-line"><span>Subtotal before discounts</span><strong>${money(calc.subtotal)}</strong></div>
      ${calc.savings ? `<div class="review-line review-savings"><span>Total savings</span><strong>−${money(calc.savings)}</strong></div>` : ''}
      ${calc.tax ? `<div class="review-line"><span>Estimated tax (${quote.taxRate}%)</span><strong>${money(calc.tax)}</strong></div>` : ''}
      <div class="review-line review-total"><span>Estimated total</span><strong>${money(calc.total)}</strong></div>
      ${financing ? `<div class="review-line"><span>Financing estimate</span><strong>${financing}</strong></div>` : ''}
    </div>

    ${recs.length ? `
    <div class="review-block">
      <h4>Setup recommendations</h4>
      <div class="review-warnings">
        ${recs.map(r => `<div class="hw-alert ${r.level}"><span class="hw-alert-icon">${alertIcon(r.level)}</span><div class="hw-alert-body">${escHtml(r.message)}</div></div>`).join('')}
      </div>
    </div>` : ''}

    ${hasVerify ? `
    <div class="review-disclaimer">
      ⚠ Items marked with ⚠ have prices that require verification before completing the sale. Catalog last updated: ${formatDate(catalog?.lastUpdated)}.
    </div>` : ''}

    ${catalog?.delivery?.note ? `
    <div class="review-block">
      <h4>Delivery note</h4>
      <p class="helper">${escHtml(catalog.delivery.note)}</p>
    </div>` : ''}

    <div class="nav-row" style="margin-top:1.2rem;border-top:1px solid var(--line);padding-top:.9rem">
      <button id="reviewCopyBtn">Copy full quote</button>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   EVENT BINDING
══════════════════════════════════════════════════════════ */
function bindStepEvents(stepId) {
  /* Card selections */
  document.querySelectorAll('.card-option[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (stepId === 'series')   { quote.seriesId = id; quote.productId = null; }
      if (stepId === 'model')    { quote.productId = id; }
      if (stepId === 'base')     { quote.baseId = id; }
      if (stepId === 'plan')     { quote.planId = id; }
      persistQuote();
      render();
    });
  });

  /* Size filters */
  document.querySelectorAll('[data-size-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      quote.sizeFilter = btn.dataset.sizeFilter;
      persistQuote();
      render();
    });
  });

  /* Text / number inputs */
  document.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      quote[key] = input.type === 'number' ? Number(input.value || 0) : input.value;
      persistQuote();
      renderSummary();
    });
  });

  /* Radio cards (hardware wizard) */
  document.querySelectorAll('[data-radio-group]').forEach(card => {
    card.addEventListener('click', () => {
      quote[card.dataset.radioGroup] = card.dataset.radioValue;
      persistQuote();
      render();
    });
  });

  /* HW checkboxes */
  document.querySelectorAll('[data-hw-check]').forEach(input => {
    input.addEventListener('change', () => {
      quote[input.dataset.hwCheck] = input.checked;
      persistQuote();
      render();
    });
  });

  /* Promo toggles */
  document.querySelectorAll('[data-promo-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      quote.toggles[input.dataset.promoToggle] = input.checked;
      persistQuote();
      render();
    });
  });

  /* Qty +/- buttons */
  document.querySelectorAll('[data-qty-plus]').forEach(btn  => btn.addEventListener('click',  e => changeQty(e.currentTarget.dataset.qtyPlus,  1)));
  document.querySelectorAll('[data-qty-minus]').forEach(btn => btn.addEventListener('click',  e => changeQty(e.currentTarget.dataset.qtyMinus, -1)));

  /* Add hardware recommendation buttons */
  document.querySelectorAll('[data-add-hw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.addHw;
      quote.hardware[id] = (quote.hardware[id] || 0) + 1;
      persistQuote();
      render();
    });
  });

  /* Review copy button */
  const revCopy = $('reviewCopyBtn');
  if (revCopy) revCopy.addEventListener('click', copyQuote);
}

function changeQty(token, delta) {
  const [bucket, id] = token.split(':');
  quote[bucket] ||= {};
  quote[bucket][id] = Math.max(0, (quote[bucket][id] || 0) + delta);
  if (!quote[bucket][id]) delete quote[bucket][id];
  persistQuote();
  render();
}

/* ══════════════════════════════════════════════════════════
   QUOTE CALCULATION
══════════════════════════════════════════════════════════ */
function calculateQuote() {
  const lines = [];
  let subtotal = 0;

  const product = productById(quote.productId);
  if (product) {
    const price = product.salePrice ?? product.retailPrice;
    lines.push({ label: `${product.model} — ${product.size}`, amount: price, verify: !!product.verificationRequired });
    subtotal += price;
  }

  const base = addonById(quote.baseId);
  if (base && base.id !== 'none') {
    lines.push({ label: base.name, amount: base.price, verify: !!base.verificationRequired });
    subtotal += base.price;
  }

  for (const [id, qty] of Object.entries(quote.hardware || {})) {
    if (!qty) continue;
    const item = addonById(id);
    if (item) {
      lines.push({ label: `${item.name} ×${qty}`, amount: item.price * qty, verify: !!item.verificationRequired });
      subtotal += item.price * qty;
    }
  }

  for (const [id, qty] of Object.entries(quote.bedding || {})) {
    if (!qty) continue;
    const item = addonById(id);
    if (item) {
      lines.push({ label: `${item.name} ×${qty}`, amount: item.price * qty, verify: !!item.verificationRequired });
      subtotal += item.price * qty;
    }
  }

  const plan = addonById(quote.planId);
  if (plan && plan.id !== 'none') {
    lines.push({ label: plan.name, amount: plan.price, verify: !!plan.verificationRequired });
    subtotal += plan.price;
  }

  const { automatic, toggles } = getAppliedPromos(subtotal);
  const promoDiscount   = [...automatic, ...toggles].reduce((s, p) => s + p.amount, 0);
  const customDiscount  = Number(quote.customDiscount || 0);
  const taxRate         = Number(quote.taxRate || 0) / 100;
  const taxable         = Math.max(0, subtotal - promoDiscount - customDiscount);
  const tax             = Math.round(taxable * taxRate);
  const total           = Math.max(0, taxable + tax);
  const savings         = promoDiscount + customDiscount + Math.max(0,
    product ? (product.retailPrice || 0) - (product.salePrice ?? (product.retailPrice || 0)) : 0
  );

  return { lines, subtotal, savings, tax, total, automaticPromos: automatic, togglePromos: toggles };
}

/* ══════════════════════════════════════════════════════════
   PROMO ENGINE
══════════════════════════════════════════════════════════ */
function getAppliedPromos(subtotalOverride = null) {
  if (!catalog) return { automatic: [], toggles: [] };
  const subtotal   = subtotalOverride ?? calculateBareSubtotal();
  const product    = productById(quote.productId);
  const categories = selectedCategorySet();
  const automatic  = [];
  const toggles    = [];

  for (const promo of catalog.promos) {
    if (promo.type === 'automatic' && qualifiesForPromo(promo, product, categories, subtotal)) {
      automatic.push(resolvePromo(promo, subtotal));
    }
    if (['toggle', 'manual'].includes(promo.type) && quote.toggles[promo.id]) {
      toggles.push(resolvePromo(promo, subtotal));
    }
  }
  return { automatic, toggles };
}

function qualifiesForPromo(promo, product, categories, subtotal) {
  const c = promo.conditions || {};
  if (c.requiresProduct && !product) return false;
  if (c.minimumSubtotal && subtotal < c.minimumSubtotal) return false;
  if (c.requiresSeries && product && !c.requiresSeries.includes(product.seriesId)) return false;
  if (c.requiresCategories) {
    for (const cat of c.requiresCategories) {
      if (!categories.has(cat)) return false;
    }
  }
  return true;
}

function resolvePromo(promo, subtotal) {
  const amount = promo.discountAmount
    ?? Math.round(subtotal * ((promo.discountPercent || 0) / 100));
  return { ...promo, amount: Math.max(0, Math.min(amount, subtotal)) };
}

function calculateBareSubtotal() {
  let t = 0;
  const p = productById(quote.productId);
  if (p) t += p.salePrice ?? p.retailPrice;
  const b = addonById(quote.baseId); if (b && b.id !== 'none') t += b.price;
  const pl = addonById(quote.planId); if (pl && pl.id !== 'none') t += pl.price;
  for (const [id, qty] of Object.entries(quote.hardware || {})) { const i = addonById(id); if (i) t += i.price * qty; }
  for (const [id, qty] of Object.entries(quote.bedding  || {})) { const i = addonById(id); if (i) t += i.price * qty; }
  return t;
}

function selectedCategorySet() {
  const set = new Set();
  if (quote.productId) set.add('mattress');
  const b = addonById(quote.baseId);   if (b) set.add(b.category);
  const p = addonById(quote.planId);   if (p) set.add(p.category);
  for (const id of Object.keys(quote.hardware || {})) { const i = addonById(id); if (i) set.add(i.category); }
  for (const id of Object.keys(quote.bedding  || {})) { const i = addonById(id); if (i) set.add(i.category); }
  return set;
}

/* ══════════════════════════════════════════════════════════
   HARDWARE RULES ENGINE
══════════════════════════════════════════════════════════ */
function getHardwareRecommendations() {
  if (!catalog?.hardwareRules) return [];
  const base    = addonById(quote.baseId);
  const product = productById(quote.productId);
  const results = [];

  for (const rule of catalog.hardwareRules) {
    const t = rule.trigger;
    let matches = true;

    if (t.baseCategory !== undefined && (!base || base.category !== t.baseCategory)) matches = false;
    if (t.baseId !== undefined && quote.baseId !== t.baseId) matches = false;
    if (t.hwHeadboard !== undefined) {
      if (Array.isArray(t.hwHeadboard)) {
        if (!t.hwHeadboard.includes(quote.hwHeadboard)) matches = false;
      } else {
        if (quote.hwHeadboard !== t.hwHeadboard) matches = false;
      }
    }
    if (t.hwFootboard !== undefined && quote.hwFootboard !== t.hwFootboard) matches = false;
    if (t.hwSupportType !== undefined && quote.hwSupportType !== t.hwSupportType) matches = false;
    if (t.hwHeightPreference !== undefined && quote.hwHeightPreference !== t.hwHeightPreference) matches = false;
    if (t.productTags !== undefined) {
      const tags = product?.tags || [];
      if (!t.productTags.some(tag => tags.includes(tag))) matches = false;
    }

    if (matches) {
      const items = (rule.recommendItems || []).map(id => addonById(id)).filter(Boolean);
      results.push({ ...rule, items });
    }
  }
  return results;
}

/* ══════════════════════════════════════════════════════════
   SUMMARY RENDER
══════════════════════════════════════════════════════════ */
function renderSummary() {
  const calc = calculateQuote();
  $('totalDue').textContent    = money(calc.total);
  $('savingsPill').textContent = `${money(calc.savings)} saved`;

  $('miniSummary').innerHTML = calc.lines.length
    ? calc.lines.map(l => `<div class="summary-line ${l.verify ? 'verify' : ''}"><span>${escHtml(l.label)}</span><strong>${money(l.amount)}${l.verify ? ' ⚠' : ''}</strong></div>`).join('')
      + `<div class="summary-line total"><span>Estimated total</span><strong>${money(calc.total)}</strong></div>`
    : '<p class="helper">Start selecting options to build a quote.</p>';

  const allPromos = [...calc.automaticPromos, ...calc.togglePromos];
  $('promoList').innerHTML = allPromos.length
    ? allPromos.map(p => `<div class="promo-item"><strong>${escHtml(p.name)}</strong><span class="promo-amount">−${money(p.amount)}</span></div>`).join('')
    : '';

  /* Hardware alerts in sidebar */
  const recs = getHardwareRecommendations();
  $('hwAlerts').innerHTML = recs.slice(0, 3).map(r =>
    `<div class="hw-alert ${r.level}"><span class="hw-alert-icon">${alertIcon(r.level)}</span><div class="hw-alert-body">${escHtml(r.message)}</div></div>`
  ).join('');
}

/* ══════════════════════════════════════════════════════════
   ADMIN PANEL
══════════════════════════════════════════════════════════ */
function renderAdminPanel() {
  if (!catalog) {
    $('adminGrid').innerHTML = '<p class="helper">No catalog loaded.</p>';
    return;
  }
  const age = catalog.lastUpdated ? `${Math.round((Date.now() - new Date(catalog.lastUpdated).getTime()) / 3600000)}h ago` : 'Unknown';
  $('adminAge').textContent      = age;
  $('adminProducts').textContent = catalog.products?.length ?? 0;
  $('adminPromos').textContent   = catalog.promos?.length ?? 0;
  $('adminAddons').textContent   = catalog.addons?.length ?? 0;

  const rows = [];
  if (catalog.sourceNotes) {
    rows.push(`<div class="admin-row"><span class="admin-icon">📝</span><span>${escHtml(catalog.sourceNotes)}</span></div>`);
  }
  const sources = catalog.sourceResults || [];
  if (sources.length) {
    const failed = sources.filter(s => !s.ok);
    if (failed.length) {
      rows.push(`<div class="admin-row"><span class="admin-icon">❌</span><span>${failed.length} source(s) failed: ${failed.map(s => escHtml(s.name || s.url)).join(', ')}</span></div>`);
    } else {
      rows.push(`<div class="admin-row"><span class="admin-icon">✅</span><span>All ${sources.length} source(s) fetched successfully.</span></div>`);
    }
  } else {
    rows.push(`<div class="admin-row"><span class="admin-icon">ℹ️</span><span>No sources have run yet. Daily refresh runs at 5 AM Central via GitHub Actions.</span></div>`);
  }

  const verifyItems = (catalog.products || []).filter(p => p.verificationRequired);
  if (verifyItems.length) {
    rows.push(`<div class="admin-row"><span class="admin-icon">⚠</span><span>${verifyItems.length} product(s) marked as verification required.</span></div>`);
  }
  rows.push(`<div class="admin-row"><span class="admin-icon">🕐</span><span>Catalog last updated: ${formatDate(catalog.lastUpdated)}</span></div>`);
  rows.push(`<div class="admin-row"><span class="admin-icon">📋</span><span>Schema version: ${catalog.schemaVersion ?? 'Unknown'}</span></div>`);

  $('adminHealth').innerHTML = rows.join('');
}

/* ══════════════════════════════════════════════════════════
   COPY / SAVE QUOTE
══════════════════════════════════════════════════════════ */
async function copyQuote() {
  const calc    = calculateQuote();
  const product = productById(quote.productId);
  const base    = addonById(quote.baseId);
  const plan    = addonById(quote.planId);
  const allPromos = [...calc.automaticPromos, ...calc.togglePromos];
  const recs    = getHardwareRecommendations();

  const lines = [
    '═══════════════════════════════',
    'Sleep Number Quote',
    `Date: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`,
    '═══════════════════════════════',
  ];

  if (quote.customerName || quote.customerPhone) {
    lines.push('');
    if (quote.customerName)  lines.push(`Customer: ${quote.customerName}`);
    if (quote.customerPhone) lines.push(`Phone:    ${quote.customerPhone}`);
  }

  lines.push('');
  lines.push('── Mattress ────────────────────');
  lines.push(product ? `${product.model} — ${product.size}: ${money(product.salePrice ?? product.retailPrice)}${product.verificationRequired ? ' (verify price)' : ''}` : 'None selected');

  lines.push('');
  lines.push('── Base ────────────────────────');
  lines.push(base && base.id !== 'none' ? `${base.name}: ${money(base.price)}${base.verificationRequired ? ' (verify price)' : ''}` : 'None selected');

  const hwItems = Object.entries(quote.hardware || {}).filter(([,q]) => q > 0);
  if (hwItems.length) {
    lines.push('');
    lines.push('── Hardware & Furniture ────────');
    for (const [id, qty] of hwItems) {
      const item = addonById(id);
      if (item) lines.push(`${item.name} ×${qty}: ${money(item.price * qty)}${item.verificationRequired ? ' (verify)' : ''}`);
    }
  }

  const beddingItems = Object.entries(quote.bedding || {}).filter(([,q]) => q > 0);
  if (beddingItems.length) {
    lines.push('');
    lines.push('── Bedding & Pillows ───────────');
    for (const [id, qty] of beddingItems) {
      const item = addonById(id);
      if (item) lines.push(`${item.name} ×${qty}: ${money(item.price * qty)}${item.verificationRequired ? ' (verify)' : ''}`);
    }
  }

  if (plan && plan.id !== 'none') {
    lines.push('');
    lines.push('── Protection Plan ─────────────');
    lines.push(`${plan.name}: ${money(plan.price)}`);
  }

  if (allPromos.length || quote.customDiscount) {
    lines.push('');
    lines.push('── Discounts & Promos ──────────');
    for (const p of allPromos) lines.push(`${p.name}: −${money(p.amount)}`);
    if (quote.customDiscount) lines.push(`Custom approved discount: −${money(quote.customDiscount)}`);
  }

  lines.push('');
  lines.push('── Totals ──────────────────────');
  lines.push(`Subtotal:          ${money(calc.subtotal)}`);
  if (calc.savings) lines.push(`Savings:           −${money(calc.savings)}`);
  if (calc.tax) lines.push(`Estimated tax:     ${money(calc.tax)}`);
  lines.push(`Estimated total:   ${money(calc.total)}`);
  if (quote.financingMonths > 0 && calc.total > 0) {
    lines.push(`Financing:         ~${money(calc.total / quote.financingMonths)}/mo × ${quote.financingMonths} months (0% — verify)`);
  }

  if (recs.length) {
    lines.push('');
    lines.push('── Setup Notes ─────────────────');
    for (const r of recs) lines.push(`[${r.level.toUpperCase()}] ${r.message}`);
  }

  lines.push('');
  lines.push('── Disclaimer ──────────────────');
  lines.push('Prices marked (verify) require confirmation before completing the sale.');
  lines.push(`Catalog updated: ${formatDate(catalog?.lastUpdated)}`);
  lines.push('Final price, eligibility, and financing subject to current store policy.');

  const text = lines.join('\n');

  try {
    await navigator.clipboard.writeText(text);
    toast('Quote copied to clipboard');
  } catch {
    /* Clipboard API failed — show in a prompt so user can copy manually */
    prompt('Copy the quote below:', text);
  }
}

function saveQuoteToStorage() {
  persistQuote();
  toast('Quote saved locally');
}

/* ══════════════════════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════════════════════ */
function cardOption({ id, title, subtitle, selected, extra = '', body = '' }) {
  return `<div class="card-option ${selected ? 'selected' : ''}" data-id="${escHtml(id)}">
    ${extra}
    <h3>${escHtml(title)}</h3>
    ${subtitle ? `<p>${escHtml(subtitle)}</p>` : ''}
    ${body}
  </div>`;
}

function radioCard(group, value, title, subtitle, selected) {
  return `<div class="card-option ${selected ? 'selected' : ''}" data-radio-group="${group}" data-radio-value="${value}">
    <h3>${escHtml(title)}</h3>
    <p>${escHtml(subtitle)}</p>
  </div>`;
}

function alertIcon(level) {
  const icons = { recommended: '💡', warning: '⚠', verify: '🚫', info: 'ℹ️', error: '❌' };
  return icons[level] || 'ℹ️';
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

/* ══════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════════ */
function productById(id) { return catalog?.products?.find(p => p.id === id) ?? null; }
function addonById(id)   { return catalog?.addons?.find(a => a.id === id)   ?? null; }
function unique(arr)     { return [...new Set(arr.filter(Boolean))]; }

function money(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '$—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatDate(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]
  ));
}
