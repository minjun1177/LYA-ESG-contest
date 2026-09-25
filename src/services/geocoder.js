// 장소 검색 (OpenStreetMap Nominatim)
//
// 공개 Nominatim 서버 이용 정책을 지키기 위해 서버에서만 호출한다:
//   - 초당 1회 이하 (요청을 순서대로 줄 세워 간격 유지)
//   - 앱을 식별하는 User-Agent 필수
//   - 결과 캐시, 입력 중 자동완성 금지(검색 버튼/엔터로만 요청)
// NOMINATIM_URL 을 바꾸면 자체 Nominatim 서버로 전환할 수 있다.

import { isInKorea, distanceMeters } from '../lib/geo.js';

const REQUEST_TIMEOUT_MS = 8000;
const RESULT_LIMIT = 8;
const CACHE_MAX = 500;

// OSM 한국 철도역은 '구로역'이 아니라 '구로'로 등록되어 있어 접미사를 떼고 다시 찾는다
const STATION_SUFFIXES = [/역$/, /\s+station$/i];
// 승강장(stop) 등은 제외하고 역 자체만
const isStation = (p) =>
  (p.category === 'railway' && ['station', 'halt'].includes(p.type)) ||
  (p.category === 'public_transport' && p.type === 'station');

export class GeocoderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class Geocoder {
  constructor({
    baseUrl = 'https://nominatim.openstreetmap.org',
    userAgent,
    email = '',
    minIntervalMs = 1100,
    cacheMinutes = 24 * 60,
    maxQueue = 10,
    fetchImpl = globalThis.fetch,
  }) {
    if (!userAgent) throw new Error('Geocoder requires a userAgent (Nominatim usage policy)');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.userAgent = userAgent;
    this.email = email;
    this.minIntervalMs = minIntervalMs;
    this.cacheMs = cacheMinutes * 60 * 1000;
    this.maxQueue = maxQueue;
    this.fetch = fetchImpl;
    this.cache = new Map();
    this.queue = Promise.resolve();
    this.pending = 0;
    this.lastRequestAt = 0;
  }

  // 모든 요청을 한 줄로 세워 minIntervalMs 간격을 보장
  #throttled(task) {
    if (this.pending >= this.maxQueue) return Promise.reject(new GeocoderError('search_busy'));
    this.pending += 1;
    const run = async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return task();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result.finally(() => { this.pending -= 1; });
  }

  async #request(query, lang) {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      countrycodes: 'kr',
      limit: String(RESULT_LIMIT),
      'accept-language': lang,
    });
    if (this.email) params.set('email', this.email);
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/search?${params}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`[geocoder] request failed: ${err.message}`);
      throw new GeocoderError('search_unavailable');
    }
    if (!res.ok) {
      console.warn(`[geocoder] HTTP ${res.status}`);
      throw new GeocoderError('search_unavailable');
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new GeocoderError('search_unavailable');
    }
    return Array.isArray(data) ? data.map(toPlace).filter(Boolean) : [];
  }

  /** 장소 검색 → [{ name, address, lat, lng, category, type, bbox }] */
  async search(query, lang = 'ko') {
    const q = String(query).trim();
    const key = `${lang}|${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.places;

    let places = await this.#throttled(() => this.#request(q, lang));

    const suffix = STATION_SUFFIXES.find((re) => re.test(q));
    const stripped = suffix ? q.replace(suffix, '').trim() : '';
    if (stripped && !places.some(isStation)) {
      const stations = (await this.#throttled(() => this.#request(stripped, lang))).filter(isStation);
      places = [...stations, ...places];
    }

    places = rankPlaces(places);
    this.cache.set(key, { at: Date.now(), places });
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    return places;
  }
}

function toPlace(item) {
  const lat = Number.parseFloat(item.lat);
  const lng = Number.parseFloat(item.lon);
  if (!isInKorea(lat, lng)) return null;
  const bb = (item.boundingbox ?? []).map(Number.parseFloat);
  return {
    name: item.name || String(item.display_name ?? '').split(',')[0],
    address: item.display_name ?? '',
    lat,
    lng,
    category: item.category ?? item.class ?? '',
    type: item.type ?? '',
    // Nominatim: [남, 북, 서, 동]
    bbox: bb.length === 4 && bb.every(Number.isFinite) ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null,
  };
}

/** 버스정류장은 뒤로 보내고, 같은 이름이 100m 안에 겹치면 하나만 남긴다 */
export function rankPlaces(places) {
  const ordered = [
    ...places.filter((p) => !(p.category === 'highway' && p.type === 'bus_stop')),
    ...places.filter((p) => p.category === 'highway' && p.type === 'bus_stop'),
  ];
  const kept = [];
  for (const p of ordered) {
    const dup = kept.some((k) => k.name === p.name && distanceMeters(k.lat, k.lng, p.lat, p.lng) < 100);
    if (!dup) kept.push(p);
  }
  return kept.slice(0, RESULT_LIMIT);
}
