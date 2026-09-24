// 위치 계산 유틸리티: 거리, 다각형 포함 여부, 기상청 격자 변환

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

// 대한민국 주변 좌표 범위 (제보 좌표 검증용)
export const KOREA_BOUNDS = { minLat: 32.8, maxLat: 38.9, minLng: 124.5, maxLng: 131.2 };

export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function isInKorea(lat, lng) {
  const b = KOREA_BOUNDS;
  return isValidLatLng(lat, lng) && lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** 두 좌표 사이의 거리(미터) — 하버사인 공식 */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 광선 투사(ray casting) — ring은 [lng, lat] 배열
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(lng, lat, rings) {
  if (!inRing(lng, lat, rings[0])) return false;
  // 구멍(hole) 안이면 제외
  return !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

/** GeoJSON Polygon/MultiPolygon 안에 점이 있는지 */
export function geometryContains(geometry, lat, lng) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => inPolygon(lng, lat, poly));
  return false;
}

/**
 * 위경도 → 기상청 동네예보 격자(nx, ny) 변환 (Lambert Conformal Conic)
 * 기상청 단기예보 조회서비스 활용가이드의 변환식
 */
export function toKmaGrid(lat, lng) {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = toRad(30.0);
  const SLAT2 = toRad(60.0);
  const OLON = toRad(126.0);
  const OLAT = toRad(38.0);
  const XO = 43;
  const YO = 136;

  const re = RE / GRID;
  let sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(SLAT1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + OLAT * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + toRad(lat) * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = toRad(lng) - OLON;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
