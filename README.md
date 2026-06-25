# Sleep Number Quote Studio

A fast, mobile-first Sleep Number sales quote assistant. Build complete, accurate quotes in under 60 seconds — even offline.

---

## What it does

- **9-step quote wizard** guides you through mattress → size → base → furniture → bedding → protection → promos → review
- **Hardware & furniture wizard** asks simple yes/no questions and automatically flags required parts (headboard bracket kits, retainer bars, leg height options, etc.)
- **Promo engine** applies qualifying promotions automatically; shows toggle promos for customer-specific deals
- **Offline-first** — loads from local cache after first visit; works on restricted store networks
- **Daily catalog refresh** via GitHub Actions at 5 AM Central; manual refresh button in the app
- **Copy quote** generates a clean text summary ready to share with the customer
- **Admin screen** shows catalog health, source status, low-confidence items, and refresh history
- **Installable PWA** — add to phone home screen for native-app feel

---

## Quick start (GitHub Pages)

1. **Fork or push** this repo to GitHub
2. Go to **Settings → Pages**
3. Set **Source** to **GitHub Actions**
4. The site deploys automatically on push to `main`
5. Open the Pages URL on your phone and tap **Add to Home Screen**
6. Before your first customer, tap **Refresh catalog** to load the latest data

---

## Daily catalog refresh

The GitHub Action in `.github/workflows/update-catalog.yml` runs at **5 AM Central** every morning.

It:
1. Reads `scripts/sources.json` for configured public Sleep Number URLs
2. Fetches each enabled source and tries to extract product/promo data
3. Merges new data into `data/catalog.json`
4. Commits only if the catalog changed
5. Prints a detailed refresh report in the Actions log

**To manually trigger:** Go to your repo → Actions tab → "Update Sleep Number quote catalog" → Run workflow.

---

## App refresh (in-app)

Tap the **Refresh catalog** button on the home screen.  
The app fetches the latest `data/catalog.json` from GitHub Pages and saves it to `localStorage`.  
After that it works fully offline until you refresh again.

---

## How to add product sources

Edit `scripts/sources.json`. Each source entry:

```json
{
  "name": "Sleep Number Deals",
  "type": "html",
  "url": "https://www.sleepnumber.com/pages/deals",
  "enabled": true,
  "notes": "Public deals page"
}
```

Set `"enabled": true` for sources you want the updater to fetch.

**Only add public, unauthenticated pages.** Do not add employee portals or login-protected internal systems.

The updater:
1. Tries to extract **JSON-LD structured product data** from the page
2. Falls back to scanning page text for promotion patterns

---

## How to update catalog prices manually

Edit `data/catalog.json` directly.

Each mattress has a `sizePricing` object:

```json
"sizePricing": {
  "queen": { "regular": 2699, "sale": 2399, "priceLabel": "Verify" }
}
```

- Set `"sale"` to the current sale price (or `null` if no sale)
- Set `"priceLabel"` to `"Verify"` if you want the app to show a verification badge
- Set `"confidenceScore"` to `0.9` when you've manually verified the price

After editing, commit the file. GitHub Actions will redeploy the Pages site automatically.

---

## How to add or adjust promo rules

Edit the `promotions` array in `data/catalog.json`.

```json
{
  "id": "spring-sale",
  "name": "Spring Sale — Save $400",
  "description": "Save $400 on select smart beds during the Spring Sale.",
  "type": "toggle",
  "discountAmount": 400,
  "verificationRequired": true,
  "confidenceScore": 0.8,
  "sourceUrl": "https://www.sleepnumber.com/pages/deals"
}
```

Promo types:
- `"automatic"` — applied automatically when conditions in `conditions` are met
- `"toggle"` — appears as a checkbox the salesperson can enable when the customer qualifies
- `"manual"` — shown as a note; use the custom discount field for the amount

---

## How to add hardware rules

Edit the `hardwareRules` array in `data/catalog.json`.

```json
{
  "id": "my-new-rule",
  "condition": {
    "baseType": "adjustable",
    "headboardPlan": ["new-sleep-number", "existing-third-party"]
  },
  "recommendation": {
    "level": "required",
    "text": "Headboard Bracket Kit is required",
    "reason": "All FlexFit adjustable bases need the bracket kit to attach a headboard.",
    "suggestedProductId": "headboard-bracket-kit"
  }
}
```

Condition fields: `baseType`, `headboardPlan`, `hasFootboard`, `hasSideRails`, `heightConcern`, `furnitureBrand`, `furnitureScenario`, `sizeId`, `baseId`

Levels: `required`, `recommended`, `warning`, `verify`, `info`

---

## File structure

```
.
├── index.html                   App shell (all screens)
├── app.js                       Full quote logic (vanilla JS module)
├── styles.css                   Sleep Number branded mobile-first styles
├── service-worker.js            Offline caching
├── manifest.webmanifest         PWA config
├── data/
│   └── catalog.json             Sleep Number product catalog (refreshed daily)
├── scripts/
│   ├── sources.json             Public data sources configuration
│   └── update_catalog.mjs       Catalog refresh script (runs in GitHub Actions)
├── assets/
│   └── logos/                   Place app icons here (icon-192.png, icon-512.png)
└── .github/
    └── workflows/
        ├── update-catalog.yml   Daily 5 AM catalog refresh
        └── pages.yml            GitHub Pages auto-deployment
```

---

## Adding app icons

Place icon files in `assets/logos/`:

- `icon-192.png` (192×192)
- `icon-512.png` (512×512)

Use a dark navy background (`#00234b`) with the Sleep Number logo or a simple bed/quote icon in white.

---

## Known limitations

- **Prices are approximate** — all prices in the starter catalog require verification. The catalog updater will improve price confidence as sources are enabled.
- **No live pricing API** — Sleep Number does not expose a public pricing API, so prices are populated manually or via public page parsing.
- **Promo parsing is best-effort** — the updater uses regex patterns to find promotion text on public pages. Always verify promos before quoting.
- **No PDF export** — print from the browser or use the "Copy quote" button and paste into a document.
- **No multi-user sync** — quotes are stored in browser `localStorage` on each device. Not synced between devices.

## Next improvements

1. Better product image extraction from Sleep Number product pages
2. More precise promo date parsing (start/end dates)
3. PDF export via browser print CSS
4. Saved quote sync via GitHub Gist or simple backend
5. Quote history with price change tracking
6. Admin override mode for manager-level price edits
7. Sleep IQ health tracking integration notes

---

## Important

This tool is for internal sales team use and uses only **public Sleep Number website data**.  
Do not add login-protected systems, employee portals, or private internal tools.  
Always verify pricing and promotions before customer purchase.