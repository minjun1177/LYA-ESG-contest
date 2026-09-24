import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env가 있으면 읽는다 (Node 내장 기능, 별도 패키지 불필요)
const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

// 상대 경로는 프로젝트 폴더 기준으로 해석
const resolvePath = (value, fallback) => (value ? path.resolve(ROOT_DIR, value) : fallback);

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: toInt(env.PORT, 3000),
    // 공공데이터포털 인증키 (Encoding/Decoding 키 모두 허용)
    dataGoKrKey: env.DATA_GO_KR_KEY || '',
    // HTTPS: 브라우저 GPS(Geolocation)는 보안 컨텍스트(HTTPS/localhost)에서만 동작
    tlsCert: resolvePath(env.TLS_CERT, ''),
    tlsKey: resolvePath(env.TLS_KEY, ''),
    // minitunnel -H 터널이 붙여주는 실제 방문자 IP 헤더를 신뢰할지 여부
    trustTunnelHeader: toBool(env.TRUST_TUNNEL_HEADER, true),
    dbPath: resolvePath(env.DB_PATH, path.join(ROOT_DIR, 'data', 'reports.db')),
    sheltersDir: resolvePath(env.SHELTERS_DIR, path.join(ROOT_DIR, 'data', 'shelters')),
    reportTtlHours: toInt(env.REPORT_TTL_HOURS, 24),
    reportResolveThreshold: toInt(env.REPORT_RESOLVE_THRESHOLD, 3),
    reportRateLimit: toInt(env.REPORT_RATE_LIMIT, 5),
    reportRateWindowMin: toInt(env.REPORT_RATE_WINDOW_MIN, 10),
    cacheMinutes: toInt(env.API_CACHE_MINUTES, 5),
  };
}
