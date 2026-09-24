# Climate Disaster Safety Map

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

Download shelter CSVs from data.go.kr (cooling centers, warming centers, outdoor earthquake sites, civil defense shelters, temporary housing, …) and convert them. **EUC-KR and UTF-8 are detected automatically.**

```bash
# Cooling-center CSV → data/shelters/heat.csv
npm run import:shelters -- --type heat ~/Downloads/cooling-centers.csv

# Civil defense shelters (underground flag detected from a column containing "지하")
npm run import:shelters -- --type civil_defense ~/Downloads/civil-defense.csv

# Stop using the sample shelters
rm data/shelters/sample-shelters.csv
```

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
│   └── lib/
│       ├── geo.js           # distance, point-in-polygon, KMA grid conversion
│       ├── provinces.js     # province boundaries, KMA region-name parsing
│       ├── warnings.js      # alert text (t6) parser
│       ├── hazards.js       # per-hazard shelter policy
│       ├── risk.js          # risk traffic-light assessment
│       ├── shelters.js      # shelter CSV loading and matching
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
│   └── samples/             # sample alerts / quakes / weather used without a key
├── scripts/
│   ├── import-shelters.js   # convert data.go.kr shelter CSVs
│   ├── tunnel.sh            # run the minitunnel client
│   └── gen-cert.sh          # self-signed HTTPS certificate
├── test/                    # node:test unit, API and locale tests
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
| **Data** | KMA and Ministry of the Interior and Safety open data (KOGL); province boundaries: Statistics Korea via [southkorea-maps](https://github.com/southkorea/southkorea-maps) |
| **Disclaimer** | Sample shelters and alerts are fictional demo data. In a real disaster, **follow emergency alerts and 119 instructions first**. |
