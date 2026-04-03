# NutriSnap 📸

An AI-powered calorie counter and nutrition tracker that works on all devices (iOS, Android, desktop) as a Progressive Web App.

## Features

- **📷 AI Food Photo Analysis** — Photograph any meal and get instant calorie + macro breakdown powered by Claude AI
- **▥ Barcode Scanner** — Scan packaged food barcodes; pulls real data from Open Food Facts database (millions of products), falls back to Claude AI
- **💧 Water Intake Tracker** — Log water with quick-add buttons, customizable daily goal, and hydration ring
- **⚖️ Body Weight Log** — Track weight over time with a progress chart and 7-day rolling average
- **🧮 Smart Calorie Goal** — Uses Mifflin-St Jeor formula with your age, weight, height, sex, and activity level
- **🎯 Diet Goals** — Bulk (+350 kcal, 2.2g protein/kg), Maintain, or Cut (−500 kcal, 2.4g protein/kg)
- **📊 7-Day History Charts** — Calories, macros (stacked), and hydration charts
- **💾 Local Storage** — All data persists on-device, no account needed
- **📱 PWA** — Installable on iOS & Android home screen, works offline

## Getting Started

### Option 1 — Use directly in browser
Open `index.html` in any modern browser. For full features (camera, barcode), serve over HTTPS.

### Option 2 — GitHub Pages (recommended)
1. Push to a GitHub repo
2. Go to **Settings → Pages → Source: main branch / root**
3. Your app is live at `https://username.github.io/nutrisnap`

### Option 3 — Any static host
Deploy the files to Netlify, Vercel, Cloudflare Pages, etc. No build step needed.

## Setup — Anthropic API Key

The app calls the Anthropic API directly from the browser for:
- Food photo analysis
- Barcode fallback lookup

You need to set your API key. Open `app.js` and update the fetch headers:

```js
headers: {
  'Content-Type': 'application/json',
  'x-api-key': 'YOUR_API_KEY_HERE',
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true'
}
```

> ⚠️ For production use, proxy API calls through your own backend to keep your key private.

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no framework, no build step
- [Chart.js](https://www.chartjs.org/) — history and weight charts
- [Open Food Facts API](https://world.openfoodfacts.org/) — barcode nutrition data
- [Anthropic Claude API](https://docs.anthropic.com/) — AI food analysis
- Browser `BarcodeDetector` API — native barcode scanning (Chrome/Android; falls back to manual)
- `localStorage` — all user data stored locally

## File Structure

```
nutrisnap/
├── index.html      # App shell + all UI markup
├── app.js          # All JavaScript logic
├── manifest.json   # PWA manifest
├── sw.js           # Service worker (offline support)
└── icons/          # App icons (add your own)
    ├── icon-192.png
    └── icon-512.png
```

## License

MIT
