# Sleep Number Quote Studio

A phone-first, offline-capable Sleep Number quote assistant — built for fast, accurate in-store quoting.

## What it does

- Guided 9-step quote flow: customer info → series → model/size → base → furniture/hardware wizard → bedding/pillows → protection plan → promos/discounts → review
- Hardware and furniture setup wizard with automatic recommendations (headboard brackets, retainer bars, footboard bars, modular legs, etc.)
- Smart compatibility warnings (adjustable base + footboard, split beds requiring two bases, third-party furniture verification)
- Promo engine with automatic, toggle, and manual discounts
- Sticky live quote panel with running total and savings
- Admin panel showing catalog age, source health, and product counts
- Full quote copy-to-clipboard for text messaging or printing
- Works offline after first load — catalog is cached locally
- Installable as a PWA on any mobile or desktop device

## Quick start

1. **Enable GitHub Pages**
   - Go to your repo → Settings → Pages
   - Set source to **GitHub Actions**
   - The `deploy-pages.yml` workflow will deploy on every push to `main`

2. **Open the app on your phone**
   - Navigate to `https://[your-github-username].github.io/Sleep_Calculator`
   - Tap **Refresh catalog** once while on normal internet

3. **Add to home screen**
   - On iOS: tap Share → Add to Home Screen
   - On Android: tap the install prompt or browser menu → Add to Home Screen

4. **Use offline**
   - After the first load and catalog refresh, the app works fully offline from cached data

## Daily catalog refresh

A GitHub Action runs at **5:00 AM Central** every day:

```
.github/workflows/update-catalog.yml
```

- Fetches public Sleep Number product and promo pages listed in `scripts/sources.json`
- Builds/merges into `data/catalog.json`
- Commits only if data changed

To adjust the schedule:
- **CDT (Mar–Nov):** `cron: '0 10 * * *'` (10:00 UTC = 5:00 AM CDT)
- **CST (Nov–Mar):** `cron: '0 11 * * *'` (11:00 UTC = 5:00 AM CST)

## Manual catalog refresh

### From the app (recommended)
Tap **Refresh catalog** on the status bar at the top.

### Via GitHub Actions
1. Go to your repo → Actions
2. Select "Update Sleep Number catalog"
3. Click **Run workflow**

## Adding or updating product sources

Edit `scripts/sources.json`:

```json
{
  "name": "Sleep Number mattresses overview",
  "type": "html",
  "url": "https://www.sleepnumber.com/collections/beds",
  "enabled": true
}
```

Set `enabled: true` to activate a source. Add any public Sleep Number product or promo page.
Supported types: `html` (parses JSON-LD and page text), `json` (parses product feed JSON).

## Adding or adjusting promo rules

Edit the `promos` array in `data/catalog.json`:

```json
{
  "id": "my-promo",
  "type": "automatic",
  "name": "$200 Event Savings",
  "description": "Current event savings on qualifying beds.",
  "discountAmount": 200,
  "conditions": {
    "requiresProduct": true,
    "minimumSubtotal": 1500
  }
}
```

Promo types:
- `automatic` — applies automatically when conditions are met
- `toggle` — appears as a toggle; user must enable it
- `manual` — like toggle, for manager-approved overrides
- `financing` — shown in financing section; informational

## Adding or adjusting hardware rules

Edit the `hardwareRules` array in `data/catalog.json`:

```json
{
  "id": "my-rule",
  "trigger": {
    "baseCategory": "adjustable-base",
    "hwHeadboard": ["sleep-number", "third-party"]
  },
  "action": "recommend",
  "level": "recommended",
  "message": "Headboard Bracket Kit recommended with adjustable base.",
  "recommendItems": ["hw-headboard-bracket"]
}
```

Trigger conditions (all are optional, ANDed together):
- `baseCategory` — matches addon category of selected base
- `baseId` — matches specific base id
- `hwHeadboard` — `"none"`, `"sleep-number"`, `"third-party"` or array of those
- `hwFootboard` — `true` or `false`
- `hwSupportType` — `"base"`, `"platform"`, `"none"`
- `hwHeightPreference` — `"standard"`, `"higher"`, `"lower"`
- `productTags` — array of tags that must be present on the selected product

Rule levels: `recommended`, `warning`, `verify`, `info`, `error`

## How to deploy on GitHub Pages

1. Enable GitHub Pages in Settings → Pages, source = **GitHub Actions**
2. Push any change to `main`
3. The `deploy-pages.yml` workflow will deploy automatically
4. Visit the published URL (shown in Pages settings)

## Known limitations

- All starter prices are approximate estimates from public information and are marked "verify price"
- Promo amounts change frequently — refresh the catalog before each shift
- Split King/Cal King sizes require two adjustable bases; the app warns but cannot verify in-store inventory
- Financing is shown as an estimate only — actual terms subject to credit approval
- Third-party furniture compatibility must always be verified in-store
- Image support is available in the catalog schema but images are not included in the starter catalog

## Catalog data model

See `data/catalog.json` for the full schema. Key arrays:

| Array | Purpose |
|---|---|
| `series` | Sleep Number product series (c, p, i, Climate360) |
| `products` | Individual mattress models by size |
| `addons` | Bases, hardware, furniture, bedding, protection plans |
| `promos` | Promotions with conditions and amounts |
| `hardwareRules` | Trigger-based setup recommendations |
| `compatibilityRules` | Known compatibility constraints |
| `financing` | Financing option terms |
| `delivery` | Delivery/setup notes |

## Next best improvements

1. Add real product images from public CDN URLs
2. Tune the HTML parser for Sleep Number's actual page structure once sources are enabled
3. Add saved quote history (multiple quotes per device)
4. Add PDF/print export
5. Add admin override for price corrections
6. Add delivery fee estimation
7. Improve promo confidence scoring based on date patterns from legal pages