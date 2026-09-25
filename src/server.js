import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { EventHub } from './lib/events.js';
import { ReportStore } from './lib/reportStore.js';
import { loadShelters } from './lib/shelters.js';
import { Geocoder } from './services/geocoder.js';
import { KmaService } from './services/kma.js';

const config = loadConfig();

const kma = new KmaService({ serviceKey: config.dataGoKrKey, cacheMinutes: config.cacheMinutes });
const shelters = loadShelters(config.sheltersDir);
const reportStore = new ReportStore({
  dbPath: config.dbPath,
  ttlHours: config.reportTtlHours,
  resolveThreshold: config.reportResolveThreshold,
});
const events = new EventHub();
const geocoder = new Geocoder({
  baseUrl: config.nominatimUrl,
  userAgent: config.nominatimUserAgent,
  email: config.nominatimEmail,
});

const app = createApp({ config, kma, geocoder, shelters, reportStore, events });

// 만료된 제보를 주기적으로 지우고 접속자에게 알림
const purgeTimer = setInterval(() => {
  for (const id of reportStore.purgeExpired()) events.broadcast('report:removed', { id });
}, 60 * 1000);
purgeTimer.unref();

let server;
if (config.tlsCert && config.tlsKey) {
  try {
    server = https.createServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, app);
  } catch (err) {
    console.error(`[server] cannot read TLS_CERT/TLS_KEY: ${err.message}`);
    process.exit(1);
  }
} else {
  server = http.createServer(app);
}

server.on('error', (err) => {
  console.error(`[server] ${err.code === 'EADDRINUSE' ? `port ${config.port} is already in use` : err.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`[server] listening on ${scheme}://${config.host}:${config.port}`);
  console.log(`[server] KMA data: ${kma.live ? 'live (DATA_GO_KR_KEY set)' : 'SAMPLE (DATA_GO_KR_KEY not set)'}`);
  console.log(`[server] shelters loaded: ${shelters.length}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  events.close();
  server.close(() => {
    reportStore.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
