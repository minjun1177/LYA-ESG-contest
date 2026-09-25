# Climate Disaster Safety Map

[![CI](https://github.com/minjun1177/LYA-ESG-contest/actions/workflows/ci.yml/badge.svg)](https://github.com/minjun1177/LYA-ESG-contest/actions/workflows/ci.yml)

A two-way disaster safety web app built on **OpenStreetMap**. It visualizes **nationwide weather alerts and earthquakes** across South Korea, shows a **risk traffic light** for the user's location, recommends **shelters suited to the current disaster**, and lets citizens **report street-level hazards in real time**.
Entry for the ESG Problem-Solving Vibe Coding Challenge (high school division) — **data-driven type / E & S areas**.

```text
 [Phone browser]                           [This server: Node.js + Express]                  [Public data]
  Leaflet map   ── /api/situation ──▶  location → province → alerts + quakes + weather  ◀── KMA alert / quake / nowcast APIs
  Signal+shelter ◀─ risk + matched shelters ─  risk.js assessment + shelter filtering  ◀── Shelter CSVs (data/shelters)
  Hazard report ── POST /api/reports ─▶  SQLite ── SSE (/api/events) ──▶ every open map, instantly
        ▲
        └──── minitunnel (public server 58.x.x.x:8000 → local 127.0.0.1:8000) ────┘
```

## What it does

| Core feature | Description |
| --- | --- |
| **1. Nationwide disaster monitoring map** | KMA active alerts drawn as province polygons (**warning** red / **advisory** amber); recent earthquakes as circles |
| **2. Nearby safety-infrastructure matching** | GPS location + active alerts → risk level (safe / caution / danger). Shelters unsuitable for the disaster are hidden (e.g. heavy rain → no underground shelters). An **evacuation popup** appears at danger level |
| **3. Real-time neighborhood hazard reports** | Tap the map to report flooding, road damage, fallen trees, etc. Reports appear on every user's map instantly and disappear after 24 h or 3 "resolved" votes |

- **Four screens:** Home (location, weather) → Risk (traffic light, shelters) → Safety map (report button) → What to do (SOS share, 119/112)
- **Responsive:** phones get a bottom tab bar; on **PC (≥ 1024 px)** the map stays on the right and the panels switch on the left
- **Place search:** search the map by name (e.g. `서울시청`, `구로역`) via OpenStreetMap **Nominatim**, plus matching shelters; any result can be **set as my location** — handy on plain HTTP where GPS is blocked
- **Multilingual:** every UI string lives in `public/locales/*.json` — switch **한국어 / English** from the top-right selector
- **Demo mode:** a "disaster simulation" selector lets you present even when no real alert is active (clearly labelled on screen)

---

## Quickstart

| Requirement | Version / Notes |
| --- | --- |
| **Node.js** | **22.13+** (uses built-in `node:sqlite` and `process.loadEnvFile`) |
| **npm** | Ships with Node |
| data.go.kr service key | Optional — without it the app runs on **sample data** |
| minitunnel server | Optional — only for access from outside (phones) |

```bash
# 1. Install dependencies
npm install

# 2. Create the environment file (runs on sample data if left as is)
cp .env.example .env

# 3. Start → http://127.0.0.1:3000 (or the PORT set in .env)
npm start
```

## Installation / Usage

### Option A — Run locally only

```bash
npm start          # production run
npm run dev        # auto-restart on file save
npm test           # unit, API and locale tests
npm run lint       # ESLint
```

**CI:** GitHub Actions runs `npm run lint` and `npm test` on **Node 22 and 24** for every push to `main` and every pull request (`.github/workflows/ci.yml`).

**Browser (E2E) testing:** follow [`docs/E2E_TESTING.md`](docs/E2E_TESTING.md) in a session that can run Playwright headed.

Browser GPS works on **localhost**.

### Option B — Publish with minitunnel (HTTP)

The tunnel server only opens **8000, 8001, 8002, 8496, 8497, 8516, 8517**. Pick one of them for `TUNNEL_REMOTE_PORT`.

```bash
# 1. Configure .env
#    PORT=8000
#    TUNNEL_SERVER=<server-ip>:<tunnel-port>
#    TUNNEL_TOKEN=...
#    TUNNEL_REMOTE_PORT=8000
#    TUNNEL_MODE=http

# 2. Start the app (terminal 1)
npm start

# 3. Start the tunnel (terminal 2) → http://<server-ip>:8000
npm run tunnel
```

- **Important:** one public port serves **one** tunnel client. If another minitunnel client already forwards `8000=127.0.0.1:8000`, **skip step 3** — just run the app on local port 8000 and the existing tunnel serves it.
- The token is passed through `.tunnel/client.toml` (mode 600), **not the command line**, so it never shows up in the process list.
- http mode forwards the visitor's real IP (`mt-connection-ip`), so the report rate limit applies **per visitor**.
- **Note:** browsers **block GPS on plain HTTP**. In this mode, use **"Pick on map"** on the Home screen.

### Option C — Publish over HTTPS (phone GPS)

```bash
# 1. Generate a self-signed certificate for the server's public IP → certs/
bash scripts/gen-cert.sh <server-ip>

# 2. Add to .env
#    TLS_CERT=certs/cert.pem
#    TLS_KEY=certs/key.pem
#    TUNNEL_MODE=tcp

# 3. Start app + tunnel → https://<server-ip>:8000 (accept the "not secure" warning once)
npm start
npm run tunnel
```

- tcp mode cannot see visitor IPs, so the report rate limit is **shared by everyone** → raise `REPORT_RATE_LIMIT` if needed.

---

### Connecting real public data

1. Apply for these three APIs on [data.go.kr](https://www.data.go.kr)
   - KMA Weather Alert Service (`WthrWrnInfoService/getPwnStatus`)
   - KMA Earthquake Information Service (`EqkInfoService/getEqkMsg`)
   - KMA Short-term Forecast Service (`VilageFcstInfoService_2.0/getUltraSrtNcst`)
2. Put the key in `DATA_GO_KR_KEY` in `.env` (Encoding or Decoding key both work) and restart
3. If a key is set but a call fails, the app **does not fall back to samples** — it shows a "could not load KMA data" banner, so no fake data appears during a real disaster.

### Adding shelter data (CSV)

**Real shelters (no login, no key):** a curated list of data.go.kr file datasets lives in `data/shelter-sources.json` (Seoul Geumcheon-gu / Jung-gu / Gwangjin-gu and Daejeon Seo-gu, license: unrestricted).

```bash
# 1. Download and convert every dataset in data/shelter-sources.json → data/shelters/real-*.csv
npm run fetch:shelters

# 2. Restart the server — once real data exists, the sample shelters are ignored automatically
npm start
```

**One more dataset by its data.go.kr number** (the number in `https://www.data.go.kr/data/<number>/fileData.do`):

```bash
# Seoul Geumcheon-gu cooling centers → data/shelters/heat.csv
npm run import:shelters -- --type heat --datago 15116079

# Or a CSV you downloaded yourself (EUC-KR / UTF-8 detected automatically)
npm run import:shelters -- --type civil_defense ~/Downloads/civil-defense.csv
```

- Rows with **swapped latitude/longitude** (it happens in real data) are fixed automatically.
- Datasets **without coordinates** (address only) are rejected with a clear error.
- `data/shelters/real-*.csv` is **not committed** — run `npm run fetch:shelters` after cloning.

**Where to get more coverage (needs your account):**

| Source | What you get | What you must do |
| --- | --- | --- |
| [Seoul Open Data](https://data.seoul.go.kr) | Seoul-wide cooling centers (`OA-21065`), outdoor earthquake sites (`OA-21063`), warming centers | Download the CSV in a browser, then `npm run import:shelters -- --type … file.csv` |
| [Disaster Safety Data Platform](https://www.safetydata.go.kr) | Nationwide MOIS shelters (earthquake sites, civil defense, temporary housing) | Sign up and apply for each dataset (file download is limited to 100 rows; full data needs its own API key) |
| data.go.kr district files | Other cities / districts | Add `{ "id", "type", "out", "title" }` to `data/shelter-sources.json` if the file has coordinates |

| `--type` | Shelter kind | Recommended for |
| --- | --- | --- |
| `temporary_housing` | Temporary housing | Heavy rain, typhoon, storm surge, strong wind |
| `earthquake_indoor` | Earthquake-ready temporary housing | Earthquake, heavy rain, typhoon |
| `earthquake_outdoor` | Outdoor earthquake evacuation site | Earthquake |
| `civil_defense` | Civil defense shelter | Strong wind (**underground excluded** for rain/quake) |
| `heat` | Cooling center | Heat wave |
| `cold` | Warming center | Cold wave, heavy snow |

### Adding a language

```bash
# 1. Copy an existing locale and translate it
cp public/locales/en.json public/locales/ja.json

# 2. Add { "code": "ja", "name": "日本語" } to "languages" in public/locales/index.json

# 3. Check for missing keys
npm test
```

---

## Configuration / Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address (keep as is when tunnelling) |
| `PORT` | `3000` | App port (use `8000` with the tunnel server) |
| `DATA_GO_KR_KEY` | *(empty)* | data.go.kr service key; empty = sample data |
| `TLS_CERT` / `TLS_KEY` | *(empty)* | When set, the app serves HTTPS (for GPS) |
| `TRUST_TUNNEL_HEADER` | `true` | Trust the visitor-IP header added by minitunnel |
| `DB_PATH` | `data/reports.db` | SQLite file for reports |
| `SHELTERS_DIR` | `data/shelters` | Folder of shelter CSVs |
| `REPORT_TTL_HOURS` | `24` | Hours before a report expires |
| `REPORT_RESOLVE_THRESHOLD` | `3` | "Resolved" votes that remove a report |
| `REPORT_RATE_LIMIT` | `5` | Reports allowed per IP per window |
| `REPORT_RATE_WINDOW_MIN` | `10` | Rate-limit window (minutes) |
| `API_CACHE_MINUTES` | `5` | KMA response cache time |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Place-search server (point it at a self-hosted Nominatim if needed) |
| `NOMINATIM_USER_AGENT` | `climate-safety-dashboard/0.1` | App identifier sent to Nominatim (**required** by its usage policy) |
| `NOMINATIM_EMAIL` | *(empty)* | Contact email sent to Nominatim (recommended for the public server) |
| `SEARCH_RATE_LIMIT` | `20` | Searches allowed per IP per minute |
| `TUNNEL_SERVER` | *(required)* | minitunnel server `host:port` |
| `TUNNEL_TOKEN` | *(required)* | minitunnel token |
| `TUNNEL_REMOTE_PORT` | `8000` | Public port on the server (8000–8002, 8496, 8497, 8516, 8517) |
| `TUNNEL_MODE` | `http` | `http` (plaintext, forwards IP) / `tcp` (passes HTTPS through) |
| `TUNNEL_BIN` | `./minitunnel` | Path to the minitunnel binary |

### Risk rules (`src/lib/risk.js`)

| Signal | Condition |
| --- | --- |
| **Danger (red)** | A **warning** is active in the user's province / **M4.0+ earthquake** within 100 km in the last 24 h |
| **Caution (amber)** | An **advisory** is active / citizen report within 1 km / rain ≥ 30 mm/h / ≥ 33 °C / ≤ −12 °C |
| **Safe (green)** | None of the above |

---

## Project Structure

```text
LYA-ESG-contest/
├── src/
│   ├── server.js            # entry: HTTP/HTTPS server, expired-report cleanup
│   ├── app.js               # Express app (API, static files, Leaflet)
│   ├── config.js            # .env → settings
│   ├── routes/api.js        # /api/* (errors returned as language-neutral codes)
│   ├── services/kma.js      # KMA alerts / quakes / nowcast + cache + samples
│   ├── services/geocoder.js # place search (Nominatim) with throttle + cache
│   ├── services/dataGoFile.js # download data.go.kr file datasets by id
│   └── lib/
│       ├── geo.js           # distance, point-in-polygon, KMA grid conversion
│       ├── provinces.js     # province boundaries, KMA region-name parsing
│       ├── warnings.js      # alert text (t6) parser
│       ├── hazards.js       # per-hazard shelter policy
│       ├── risk.js          # risk traffic-light assessment
│       ├── shelters.js      # shelter CSV loading and matching
│       ├── shelterImport.js # public CSV → shelter format (column detection, lat/lng fix)
│       ├── reportStore.js   # citizen reports (node:sqlite)
│       ├── events.js        # real-time push (Server-Sent Events)
│       ├── rateLimit.js     # report flood protection
│       └── csv.js           # CSV parser (EUC-KR aware)
├── public/
│   ├── index.html           # 4 screens + evacuation popup + report dialog
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js           # screen flow, GPS, SOS, live reports
│   │   ├── mapView.js       # Leaflet map layers
│   │   ├── i18n.js          # translations and locale formatting
│   │   └── api.js           # server calls
│   └── locales/             # index.json, ko.json, en.json
├── data/
│   ├── provinces.geojson    # province boundaries (Statistics Korea)
│   ├── shelters/            # shelter CSVs (sample-shelters.csv is demo data)
│   ├── samples/             # sample alerts / quakes / weather used without a key
│   └── shelter-sources.json # real shelter datasets for `npm run fetch:shelters`
├── docs/
│   └── E2E_TESTING.md       # Playwright headed test scenarios
├── scripts/
│   ├── import-shelters.js   # convert one shelter CSV (file or --datago id)
│   ├── fetch-shelters.js    # download every dataset in shelter-sources.json
│   ├── tunnel.sh            # run the minitunnel client
│   └── gen-cert.sh          # self-signed HTTPS certificate
├── test/                    # node:test unit, API and locale tests
├── CLAUDE.md                # notes for Claude sessions
├── .github/workflows/ci.yml # lint + test on Node 22 / 24
├── .env.example
└── package.json
```

## Compatibility / Permissions / License

| Item | Details |
| --- | --- |
| **Runtime** | Node.js ≥ 22.13 (**Linux / macOS / Windows**) |
| **Browsers** | Latest Chrome, Safari, Edge, Firefox (mobile-first layout) |
| **Browser permissions** | Location (GPS) — requestable **only on HTTPS or localhost** |
| **Tunnel** | `minitunnel` binary is not tracked in git; place it in the project root |
| **Map** | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), [Leaflet](https://leafletjs.com) (BSD-2) |
| **Search** | [Nominatim](https://nominatim.org) — the public server allows **≤ 1 request/s** and no search-as-you-type; the app queues requests server-side, caches results for 24 h and searches only on submit ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)) |
| **Data** | KMA and Ministry of the Interior and Safety open data (KOGL); province boundaries: Statistics Korea via [southkorea-maps](https://github.com/southkorea/southkorea-maps) |
| **Shelter data** | data.go.kr file datasets listed in `data/shelter-sources.json` (license: unrestricted); source: each local government |
| **Disclaimer** | Sample shelters and alerts are fictional demo data. In a real disaster, **follow emergency alerts and 119 instructions first**. |
