// 다국어 처리: 화면 문구는 모두 /locales/<언어>.json 에서 가져온다.
// 새 언어 추가 = locales/<code>.json 파일 추가 + locales/index.json 에 한 줄 추가

const STORAGE_KEY = 'lang';
const listeners = new Set();

let languages = [];
let current = 'ko';
let messages = {};
let fallback = {};
let fallbackCode = 'ko';

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 사생활 보호 모드 등에서는 저장하지 않고 넘어감
  }
}

async function fetchLocale(code) {
  const res = await fetch(`/locales/${code}.json`);
  if (!res.ok) throw new Error(`locale ${code}: HTTP ${res.status}`);
  return res.json();
}

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

function pickLanguage(saved, preferred) {
  const codes = languages.map((l) => l.code);
  if (saved && codes.includes(saved)) return saved;
  for (const pref of preferred) {
    const base = pref.toLowerCase().split('-')[0];
    if (codes.includes(base)) return base;
  }
  return fallbackCode;
}

export async function initI18n() {
  const index = await (await fetch('/locales/index.json')).json();
  languages = index.languages;
  fallbackCode = index.default;
  fallback = await fetchLocale(fallbackCode);
  await setLanguage(pickLanguage(storageGet(STORAGE_KEY), navigator.languages ?? [navigator.language]), { silent: true });
}

export function getLanguages() {
  return languages;
}

export function getLanguage() {
  return current;
}

export async function setLanguage(code, { silent = false } = {}) {
  messages = code === fallbackCode ? fallback : await fetchLocale(code);
  current = code;
  storageSet(STORAGE_KEY, code);
  document.documentElement.lang = code;
  applyTranslations(document);
  if (!silent) listeners.forEach((fn) => fn(code));
}

export function onLanguageChange(fn) {
  listeners.add(fn);
}

/**
 * 번역 문자열. {name} 자리에 params 값을 넣는다.
 * params.count 가 있으면 key_one / key_other (Intl.PluralRules) 를 먼저 찾는다.
 */
export function t(key, params = {}) {
  let value;
  if (typeof params.count === 'number') {
    const form = new Intl.PluralRules(current).select(params.count);
    value = lookup(messages, `${key}_${form}`) ?? lookup(fallback, `${key}_${form}`);
  }
  value ??= lookup(messages, key) ?? lookup(fallback, key);
  if (value === undefined) return key;
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

/** 번역 키가 있는지 */
export function has(key) {
  return lookup(messages, key) !== undefined || lookup(fallback, key) !== undefined;
}

/** data-i18n* 속성이 있는 요소의 문구를 현재 언어로 바꾼다 */
export function applyTranslations(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  if (root === document) document.title = t('app.title');
}

// ---- 언어에 맞춘 숫자·거리·시각 표시 (Intl 사용, 단위 문구 하드코딩 없음) ----

export function formatNumber(n, options) {
  return new Intl.NumberFormat(current, options).format(n);
}

export function formatDistance(meters) {
  if (meters >= 1000) {
    return formatNumber(meters / 1000, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  }
  return formatNumber(Math.round(meters), { style: 'unit', unit: 'meter' });
}

export function formatUnit(value, unit, digits = 1) {
  return formatNumber(value, { style: 'unit', unit, maximumFractionDigits: digits });
}

export function formatTime(iso) {
  return new Intl.DateTimeFormat(current, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(iso));
}

export function formatAgo(iso, now = Date.now()) {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  return t('time.hoursAgo', { n: Math.floor(diffMin / 60) });
}
