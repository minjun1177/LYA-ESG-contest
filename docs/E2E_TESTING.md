# E2E Testing Guide (Playwright, headed)

Instructions for a session that can drive a **real browser** (Playwright headed, or a Playwright MCP). The unit/API suite (`npm test`) cannot see layout, Leaflet events or real browser permissions — this guide covers exactly those.

---

## 1. Start an isolated, deterministic server

```bash
# 1. Sample-only shelters (real data, if fetched, would replace the samples)
mkdir -p /tmp/e2e-shelters && cp data/shelters/sample-shelters.csv /tmp/e2e-shelters/

# 2. Fresh report DB, no KMA key → sample alerts (Seoul = heavy-rain WARNING, Daegu = heat ADVISORY)
#    Shell variables override .env, so this never touches the real DB or key.
PORT=3100 DB_PATH=/tmp/e2e-reports.db SHELTERS_DIR=/tmp/e2e-shelters DATA_GO_KR_KEY= \
  REPORT_RATE_LIMIT=50 npm start

# 3. Before each full run, delete the old DB
rm -f /tmp/e2e-reports.db
```

- Use **http://localhost:3100** — `localhost` is a secure context, so **GPS works** with granted permissions.
- **Do not** test through the public tunnel URL (plain HTTP → GPS blocked, and it's the live demo).

### Testing a remote server instead (e.g. the demo host)

If the app only runs on another machine, forward it to `localhost` so the page is still a secure context:

```bash
# Local TCP proxy: http://localhost:3100 → http://<host>:8000 (any TCP forwarder works)
ssh -N -L 3100:localhost:8000 <host>
```

- That server usually has **real shelter data** and its **own report DB** → use the "real data" variants below, and every report you submit stays on the live map for 24 h. Prefer the isolated server above whenever possible.

### Playwright setup (if missing)

```bash
# Install the browser only in the E2E session (not a project dependency)
npx -y playwright@latest install chromium
```

| Context option | Mobile | Desktop |
| --- | --- | --- |
| `viewport` | `390 × 844` | `1440 × 900` |
| `isMobile` / `hasTouch` | `true` | `false` |
| `permissions` | `['geolocation', 'clipboard-read', 'clipboard-write']` | same |
| `geolocation` | Seoul City Hall `{ latitude: 37.5665, longitude: 126.9780 }` | same |
| `locale` | `ko-KR` (language auto-detect → Korean) | same |

---

## 2. Selectors

| Element | Selector |
| --- | --- |
| Tabs | `.tabbar button[data-tab="home\|dashboard\|map\|actions"]` |
| Views | `#view-home`, `#view-dashboard`, `#view-map`, `#view-actions` |
| Language | `#lang-select` (`ko`, `en`) |
| Data banner | `#source-banner` |
| GPS / pick | `#btn-gps`, `#btn-pick`, `#location-status` |
| Map | `#map`, hint `#map-hint`, cancel `#btn-hint-cancel`, legend `#map-legend` |
| Map tools | `#btn-nationwide`, `#btn-mylocation` |
| Search | `#search-input`, `#btn-search`, results `#search-results button` |
| Report | FAB `#btn-report`, dialog `#report-dialog`, `#report-category`, `#report-description`, `#btn-report-submit`, error `#report-error` |
| Risk | `#signal[data-level]`, `#risk-level`, `#risk-reasons li`, `#shelter-list li` |
| Simulation | `#simulate-select` |
| Emergency | `dialog#emergency`, `#btn-emg-shelter`, `#btn-emg-guide`, `#btn-emg-close` |
| SOS | `#btn-sos`, `#sos-status`, `#sos-text` |
| Toast | `#toast` |
| Leaflet | popups `.leaflet-popup`, report markers `.report-marker` |

**Clicking a specific place on the map:** the Leaflet map object is not global. Center the map first (search, `#btn-mylocation`, or a shelter's "show on map"), then click the **center of `#map`** — that point is the focused coordinate.

---

## 3. Scenarios

Run every scenario on **mobile** and **desktop** unless marked otherwise. Screenshot each "Expected" state into `test-results/`.

### S1 — Layout: nothing hidden behind the tab bar (mobile)
1. Open `/`; `#source-banner` must be visible (sample data).
2. Tap the map tab.
3. **Expected:** `#map-legend` and `#btn-report` bounding boxes end **above** the top of `.tabbar` (`box.y + box.height <= tabbar.y`). No page-level scroll (`document.scrollingElement.scrollHeight === innerHeight`).

### S2 — Layout: desktop two-pane
1. Desktop viewport, open `/`.
2. **Expected:** `#view-map` visible next to `#view-home`; the map tab button is **not visible**; `.tabbar` shows 3 tabs.
3. Click dashboard and actions tabs → **Expected:** map stays visible, left panel changes.
4. Resize 1440 → 390 → 1440 → **Expected:** map re-renders without grey tiles (Leaflet `invalidateSize`).

### S3 — Pick my location on land (regression)
Province polygons have popups; Leaflet's popup handler stops map clicks. Picking must still work.
1. Home → `#btn-pick` (map opens with `#map-hint`).
2. Click the center of `#map` while it shows Korean land (e.g. after `#btn-nationwide`, the center is inland).
3. **Expected:** `#map-hint` hidden, **no** `.leaflet-popup`, `#toast` shows the "location set" message, `#location-status` names a province, blue user marker present.
4. Repeat with `#btn-report` → click land → **Expected:** `#report-dialog` opens.

### S4 — GPS
1. Home → `#btn-gps`.
2. **Expected:** `#location-status` contains the Seoul province name and a GPS accuracy; weather card shows 5 values.
3. Change geolocation by > 150 m → **Expected:** situation refreshes.

### S5 — Risk + evacuation popup (sample data)
1. With Seoul location set, wait for `dialog#emergency[open]`.
2. **Expected:** reason mentions heavy rain warning; nearest shelter named; `#btn-emg-shelter` → map tab, numbered blue marker popup open.
3. Dashboard: `#signal[data-level="danger"]`; shelter list has **no** `민방위 대피시설` (underground excluded for heavy rain).
4. Close the popup → it must **not** reappear until the situation changes.

### S6 — Simulation
1. Dashboard → `#simulate-select` = `earthquake`.
2. **Expected:** banner switches to the simulated style; every listed shelter is an earthquake site (outdoor site or earthquake-ready housing) and none is underground — **or**, if the data has no earthquake sites nearby (real-data servers), `#shelters-note` shows the "no matching shelter data, showing nearest above-ground shelters" notice; `#view-actions` shows the earthquake guide under "current".
3. Set back to off → banner returns to sample.

### S7 — Reports + real-time sharing (two contexts)
1. Open context **A** and **B** on `/#map`.
2. A: `#btn-report` → click map → category `flooding`, description `e2e test` → submit.
3. **Expected (A):** success toast, `.report-marker` added. **(B)** within 3 s: toast "new hazard report", marker added (SSE).
4. B: open the marker popup → "resolved" button → votes `1/3`.
5. Type 201 chars into `#report-description` → **Expected:** the field stops at **200** (`maxlength`). Close the dialog **without submitting** (a 200-char report is valid and would be saved).
6. Server-side limit: `POST /api/reports` directly (Playwright `request`) with a 201-char description → **Expected:** HTTP 400 `{ "error": "description_too_long", "max": 200 }`.

### S8 — Place search
**Nominatim policy:** max ~1 request/s, no search-as-you-type. Run **at most 3 searches per full run**; never loop.
1. `#search-input` = `구로역` → Enter.
2. **Expected:** first result under "places" is `구로` (railway station); clicking it centers the map with a dark search marker and popup.
3. Popup → "set as my location" → **Expected:** toast, `#location-status` updated, marker cleared.
4. Search a shelter name → **Expected:** a "shelters" section appears. Sample data: `서울 무더위` (sample cooling centers). Real data: `중구청` (Jung-gu cooling center).
5. Clear the input (×) → results and search marker disappear.

### S9 — Language switch
1. `#lang-select` = `en`.
2. **Expected:** `<html lang="en">`, all visible text English, including map legend, layer control, popups opened afterwards, dashboard reasons and search results.
3. **No raw keys:** no visible text node matches `/^[a-z]+(\.[a-zA-Z_]+)+$/`.
4. Reload → still English (saved preference).

### S10 — SOS
1. Actions → `#btn-sos`. On Linux Chromium `navigator.share` is absent → clipboard path; if a share sheet opens instead, cancel it and skip step 2.
2. **Expected:** `#sos-status` says copied; clipboard text contains `openstreetmap.org/?mlat=`.

### S11 — Failure states
1. Block `**/api/situation*` (route → abort) and set a location → **Expected:** toast with the network error, UI stays usable.
2. Block `**/api/search*` → search shows an error message inside `#search-results`.

---

## 4. Reporting

- For each failure, record: **scenario id, viewport, steps, expected vs actual, screenshot path, console errors** (`page.on('console')` / `pageerror`).
- Also fail the run on any uncaught page error or failed `/api/*` request (except S11).
- Do not "fix" a failing expectation in this document without checking the product behavior first; if the behavior changed intentionally, update the scenario in the same change.
