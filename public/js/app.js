// 화면 전체 흐름: 위치 → 상황 조회 → 신호등·대피소·행동요령 표시, 제보 실시간 공유
// 모든 문구는 t('키') 로 가져오고, 언어가 바뀌면 저장된 상태로 화면을 다시 그린다.

import { api, ApiError } from './api.js';
import {
  initI18n, t, has, getLanguages, getLanguage, setLanguage, onLanguageChange,
  formatDistance, formatTime, formatUnit, formatNumber,
} from './i18n.js';
import { createMapView } from './mapView.js';

const $ = (id) => document.getElementById(id);
const LOCATION_KEY = 'manualLocation';
const SITUATION_REFRESH_MS = 3 * 60 * 1000;
const OVERVIEW_REFRESH_MS = 5 * 60 * 1000;
const GPS_MIN_MOVE_M = 150;

const state = {
  config: null,
  overview: null,
  location: null, // { lat, lng, accuracy?, manual }
  locationError: null, // i18n 키
  locating: false,
  situation: null,
  simulate: '',
  tab: 'home',
  dismissedEmergency: null,
  pendingReport: null,
  watchId: null,
};

let mapView;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function storage(action, key, value) {
  try {
    if (action === 'get') return JSON.parse(localStorage.getItem(key));
    if (action === 'set') localStorage.setItem(key, JSON.stringify(value));
    if (action === 'remove') localStorage.removeItem(key);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 무시
  }
  return null;
}

function errorMessage(err) {
  const code = err instanceof ApiError ? err.code : 'internal';
  return t(has(`error.${code}`) ? `error.${code}` : 'error.internal', err.details ?? {});
}

let toastTimer;
function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3500);
}

function hazardText(w) {
  return `${t(`hazard.${w.hazard}.name`)} ${t(`level.${w.level}`)}`;
}

// ---------------------------------------------------------------- 탭
function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== tab; });
  document.querySelectorAll('.tabbar button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (tab === 'map') requestAnimationFrame(() => mapView.invalidate());
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

// ---------------------------------------------------------------- 렌더링
function renderLanguageSelect() {
  const select = $('lang-select');
  select.replaceChildren(...getLanguages().map((l) => {
    const opt = el('option', null, l.name);
    opt.value = l.code;
    return opt;
  }));
  select.value = getLanguage();
}

function renderBanner() {
  const banner = $('source-banner');
  const sources = state.situation?.sources ?? {
    warnings: state.overview?.warnings.source,
    earthquakes: state.overview?.earthquakes.source,
  };
  banner.className = 'banner';
  let key = null;
  if (state.simulate) {
    key = 'source.simulated';
    banner.classList.add('simulated');
  } else if (Object.values(sources).includes('unavailable')) {
    key = 'source.unavailable';
    banner.classList.add('unavailable');
  } else if (Object.values(sources).includes('sample')) {
    key = 'source.sample';
  }
  banner.hidden = !key;
  if (key) banner.textContent = t(key);
}

function renderLocation() {
  const status = $('location-status');
  if (state.locating) {
    status.textContent = t('home.locating');
    return;
  }
  const lines = [];
  if (state.locationError) lines.push(t(state.locationError));
  if (state.location) {
    const province = state.situation?.province;
    lines.push(province ? t('home.yourArea', { province: t(`province.${province}`) }) : t('home.outsideKorea'));
    lines.push(state.location.manual
      ? t('home.manualLocation')
      : t('home.gpsLocation', { accuracy: formatDistance(state.location.accuracy ?? 0) }));
  } else if (!state.locationError) {
    lines.push(t('home.locationUnknown'));
  }
  status.textContent = lines.join(' · ');
}

function renderWeather() {
  const box = $('weather');
  box.replaceChildren();
  const w = state.situation?.weather;
  if (!w || w.source === 'unavailable' || w.temperature === undefined) {
    box.append(el('p', 'muted', state.location ? t('weather.unavailable') : t('home.locationUnknown')));
    return;
  }
  const grid = el('div', 'weather-grid');
  const items = [
    ['weather.temperature', w.temperature !== null ? formatUnit(w.temperature, 'celsius') : '-'],
    ['weather.rain1h', w.rain1h !== null ? formatUnit(w.rain1h, 'millimeter') : '-'],
    ['weather.humidity', w.humidity !== null ? formatNumber(w.humidity / 100, { style: 'percent' }) : '-'],
    ['weather.wind', w.windSpeed !== null ? formatUnit(w.windSpeed, 'meter-per-second') : '-'],
    ['weather.precip', w.precipitationType !== null ? t(`weather.precipType.${w.precipitationType}`) : '-'],
  ];
  for (const [label, value] of items) {
    const item = el('div', 'weather-item');
    item.append(el('div', 'label', t(label)), el('div', 'value', value));
    grid.append(item);
  }
  box.append(grid);
  if (w.observedAt) box.append(el('p', 'muted small', t('weather.observedAt', { time: formatTime(w.observedAt) })));
}

function reasonText(reason) {
  const p = reason.params;
  switch (reason.code) {
    case 'warning':
      return p.partial && p.detail
        ? t('risk.reason.warningPartial', { hazard: t(`hazard.${p.hazard}.name`), level: t(`level.${p.level}`), detail: p.detail })
        : t('risk.reason.warning', { hazard: t(`hazard.${p.hazard}.name`), level: t(`level.${p.level}`) });
    case 'earthquake':
      return t('risk.reason.earthquake', { magnitude: p.magnitude, distance: formatDistance(p.distanceKm * 1000) });
    case 'reports':
      return t('risk.reason.reports', { count: p.count, radius: formatDistance(p.radiusM) });
    default:
      return t(`risk.reason.${reason.code}`, p);
  }
}

function renderDashboard() {
  const s = state.situation;
  $('dashboard-empty').hidden = Boolean(s);
  $('dashboard-content').hidden = !s;
  $('home-risk').hidden = !s;
  if (!s) return;

  const { level, reasons, hazards } = s.risk;
  $('signal').dataset.level = level;
  $('signal').setAttribute('aria-label', t(`risk.level.${level}`));
  $('risk-level').textContent = t(`risk.level.${level}`);
  $('risk-level').className = `risk-level ${level}`;
  $('risk-desc').textContent = t(`risk.levelDesc.${level}`);
  $('home-risk-dot').className = `dot ${level}`;
  $('home-risk-label').textContent = t(`risk.level.${level}`);

  // 특보의 세부 지역(detail)은 reasons 에 없으므로 warnings 에서 보충
  const detailByHazard = Object.fromEntries(s.warnings.map((w) => [w.hazard, w.detail]));
  $('risk-reasons').replaceChildren(...reasons.map((r) => {
    const enriched = r.code === 'warning' ? { ...r, params: { ...r.params, detail: detailByHazard[r.params.hazard] } } : r;
    return el('li', null, reasonText(enriched));
  }));

  $('nearby-reports').textContent = s.nearbyReports.length > 0
    ? t('dashboard.nearbyReports', { count: s.nearbyReports.length, radius: formatDistance(state.config.riskRules.reportRadiusM) })
    : '';

  $('shelters-note').textContent = hazards.length > 0
    ? t('dashboard.sheltersFiltered', { hazard: t(`hazard.${hazards[0]}.name`) })
    : '';

  const list = $('shelter-list');
  if (s.shelters.length === 0) {
    list.replaceChildren(el('li', 'muted', t('dashboard.noShelters')));
  } else {
    list.replaceChildren(...s.shelters.map((sh) => {
      const li = el('li');
      const info = el('div');
      const name = el('div', 'shelter-name', sh.name);
      if (sh.sample) name.append(el('span', 'badge sample', t('shelter.sample')));
      const meta = [formatDistance(sh.distanceM), t(`shelter.type.${sh.type}`)];
      if (sh.capacity) meta.push(t('shelter.capacity', { count: formatNumber(sh.capacity) }));
      info.append(name, el('div', 'shelter-meta', meta.join(' · ')));
      const btn = el('button', 'btn small', t('dashboard.showOnMap'));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        showTab('map');
        mapView.focusShelter(sh.id);
      });
      li.append(info, btn);
      return li;
    }));
  }
}

function renderSimulateSelect() {
  const select = $('simulate-select');
  const off = el('option', null, t('dashboard.simulateOff'));
  off.value = '';
  const options = state.config.hazards.map((code) => {
    const opt = el('option', null, t(`hazard.${code}.name`));
    opt.value = code;
    return opt;
  });
  select.replaceChildren(off, ...options);
  select.value = state.simulate;
}

function guideBlock(code, open, current) {
  const details = el('details', `guide${current ? ' current' : ''}`);
  details.open = open;
  details.append(el('summary', null, t(`hazard.${code}.name`)));
  const steps = t(`hazard.${code}.guide`);
  const ol = el('ol');
  (Array.isArray(steps) ? steps : []).forEach((step) => ol.append(el('li', null, step)));
  details.append(ol);
  return details;
}

function renderGuides() {
  const hazards = state.situation?.risk.hazards ?? [];
  const current = $('current-guides');
  current.replaceChildren();
  if (hazards.length === 0) current.append(el('p', 'muted', t('actions.noCurrent')));
  hazards.forEach((code) => current.append(guideBlock(code, true, true)));
  $('all-guides').replaceChildren(...state.config.hazards.map((code) => guideBlock(code, false, false)));
}

function renderReportDialogText() {
  const cfg = state.config;
  const select = $('report-category');
  const prev = select.value;
  select.replaceChildren(...cfg.reportCategories.map((c) => {
    const opt = el('option', null, t(`report.category.${c}`));
    opt.value = c;
    return opt;
  }));
  if (prev) select.value = prev;
  $('report-description').maxLength = cfg.reportDescriptionMax;
  $('report-desc-label').textContent = t('report.descriptionLabel', { max: cfg.reportDescriptionMax });
  $('report-expires').textContent = t('report.expiresNote', { hours: cfg.reportTtlHours });
}

function renderEmergencyText() {
  const s = state.situation;
  if (!s) return;
  const reason = s.risk.reasons.find((r) => r.code === 'warning' || r.code === 'earthquake');
  $('emergency-reason').textContent = reason ? reasonText(reason) : t('risk.levelDesc.danger');
  const nearest = s.shelters[0];
  $('emergency-shelter').textContent = nearest
    ? t('emergency.nearest', { name: nearest.name, distance: formatDistance(nearest.distanceM) })
    : t('emergency.noShelter');
  $('btn-emg-shelter').hidden = !nearest;
}

function renderAll() {
  renderBanner();
  renderLocation();
  renderWeather();
  renderDashboard();
  renderGuides();
  renderSimulateSelect();
  renderReportDialogText();
  renderEmergencyText();
}

// ---------------------------------------------------------------- 긴급 팝업
function emergencySignature(s) {
  return `${s.risk.level}|${s.risk.hazards.join(',')}|${s.simulated ?? ''}`;
}

function maybeShowEmergency() {
  const s = state.situation;
  const dialog = $('emergency');
  if (!s || s.risk.level !== 'danger') return;
  const sig = emergencySignature(s);
  if (state.dismissedEmergency === sig || dialog.open) return;
  renderEmergencyText();
  dialog.showModal();
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}

// ---------------------------------------------------------------- 데이터 갱신
let situationSeq = 0;
async function refreshSituation() {
  if (!state.location) return;
  const seq = ++situationSeq;
  try {
    const s = await api.situation({ lat: state.location.lat, lng: state.location.lng, simulate: state.simulate });
    if (seq !== situationSeq) return; // 더 최신 요청이 있으면 무시
    state.situation = s;
    mapView.setRecommended(s.shelters);
    renderAll();
    maybeShowEmergency();
  } catch (err) {
    toast(errorMessage(err));
  }
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshSituation, 400);
}

async function refreshOverview() {
  try {
    state.overview = await api.overview();
    mapView.setOverview(state.overview);
    renderBanner();
  } catch (err) {
    toast(errorMessage(err));
  }
}

function setLocation(location) {
  state.location = location;
  state.locationError = null;
  if (location.manual) storage('set', LOCATION_KEY, { lat: location.lat, lng: location.lng });
  mapView.setUser(location);
  renderLocation();
  refreshSituation();
}

// ---------------------------------------------------------------- GPS
function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function startGps() {
  // 브라우저는 HTTPS(또는 localhost)에서만 GPS를 허용한다
  if (!window.isSecureContext || !navigator.geolocation) {
    state.locationError = window.isSecureContext ? 'home.gpsUnavailable' : 'home.gpsInsecure';
    renderLocation();
    return;
  }
  state.locating = true;
  renderLocation();
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, manual: false };
      const moved = !state.location || state.location.manual || distanceM(state.location, next) > GPS_MIN_MOVE_M;
      state.locating = false;
      if (moved) {
        storage('remove', LOCATION_KEY);
        setLocation(next);
      }
    },
    (err) => {
      state.locating = false;
      state.locationError = err.code === err.PERMISSION_DENIED ? 'home.gpsDenied' : 'home.gpsUnavailable';
      renderLocation();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// ---------------------------------------------------------------- 제보
function openReportDialog(latlng) {
  state.pendingReport = latlng;
  $('report-error').hidden = true;
  $('report-description').value = '';
  renderReportDialogText();
  $('report-dialog').showModal();
}

async function submitReport(event) {
  event.preventDefault();
  if (!state.pendingReport) return;
  const btn = $('btn-report-submit');
  btn.disabled = true;
  try {
    const { report } = await api.createReport({
      ...state.pendingReport,
      category: $('report-category').value,
      description: $('report-description').value,
    });
    mapView.upsertReport(report);
    ownReports.add(report.id);
    $('report-dialog').close();
    toast(t('report.success'));
    scheduleRefresh();
  } catch (err) {
    $('report-error').textContent = errorMessage(err);
    $('report-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function resolveReport(id) {
  try {
    const { report, removed } = await api.resolveReport(id);
    if (removed) mapView.removeReport(id);
    else mapView.upsertReport(report);
    toast(t('report.resolveDone'));
    scheduleRefresh();
  } catch (err) {
    toast(errorMessage(err));
  }
}

// ---------------------------------------------------------------- 실시간(SSE)
const ownReports = new Set();
function connectEvents() {
  const source = new EventSource('/api/events');
  source.addEventListener('report:new', (e) => {
    const report = JSON.parse(e.data);
    mapView.upsertReport(report);
    if (!ownReports.has(report.id)) toast(t('report.newToast', { category: t(`report.category.${report.category}`) }));
    scheduleRefresh();
  });
  source.addEventListener('report:updated', (e) => mapView.upsertReport(JSON.parse(e.data)));
  source.addEventListener('report:removed', (e) => {
    mapView.removeReport(JSON.parse(e.data).id);
    scheduleRefresh();
  });
  // EventSource 는 연결이 끊기면 스스로 다시 연결한다
}

// ---------------------------------------------------------------- SOS
async function shareSos() {
  const statusBox = $('sos-status');
  const textBox = $('sos-text');
  if (!state.location) {
    statusBox.textContent = t('actions.noLocation');
    return;
  }
  const { lat, lng } = state.location;
  const url = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  const s = state.situation;
  const status = s
    ? [t(`risk.level.${s.risk.level}`), ...s.warnings.map(hazardText)].join(', ')
    : '-';
  const text = t('actions.sosText', { status, url });
  textBox.value = text;
  try {
    if (navigator.share) {
      await navigator.share({ title: t('app.title'), text });
      statusBox.textContent = '';
      return;
    }
    await navigator.clipboard.writeText(text);
    statusBox.textContent = t('actions.sosCopied');
  } catch (err) {
    if (err?.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    statusBox.textContent = t('actions.sosFailed');
    textBox.hidden = false;
    textBox.select();
  }
}

// ---------------------------------------------------------------- 시작
function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('lang-select').addEventListener('change', (e) => setLanguage(e.target.value));
  $('btn-gps').addEventListener('click', startGps);
  $('btn-pick').addEventListener('click', () => {
    showTab('map');
    mapView.startPick('location');
  });
  $('btn-go-dashboard').addEventListener('click', () => showTab('dashboard'));
  $('simulate-select').addEventListener('change', (e) => {
    state.simulate = e.target.value;
    state.dismissedEmergency = null;
    renderBanner();
    refreshSituation();
  });
  $('btn-report').addEventListener('click', () => mapView.startPick('report'));
  $('report-form').addEventListener('submit', submitReport);
  $('btn-report-cancel').addEventListener('click', () => $('report-dialog').close());

  const emergency = $('emergency');
  const dismiss = () => {
    if (state.situation) state.dismissedEmergency = emergencySignature(state.situation);
    emergency.close();
  };
  emergency.addEventListener('cancel', dismiss);
  $('btn-emg-close').addEventListener('click', dismiss);
  $('btn-emg-shelter').addEventListener('click', () => {
    dismiss();
    showTab('map');
    const nearest = state.situation?.shelters[0];
    if (nearest) mapView.focusShelter(nearest.id);
  });
  $('btn-emg-guide').addEventListener('click', () => {
    dismiss();
    showTab('actions');
  });
  $('btn-sos').addEventListener('click', shareSos);

  onLanguageChange(() => {
    renderLanguageSelect();
    renderAll();
    mapView.relocalize();
  });
}

async function main() {
  await initI18n();
  renderLanguageSelect();

  try {
    state.config = await api.config();
  } catch (err) {
    document.body.prepend(el('p', 'banner unavailable', errorMessage(err)));
    return;
  }

  mapView = createMapView({
    api,
    getConfig: () => state.config,
    onResolveReport: resolveReport,
    onPick: (mode, latlng) => {
      if (mode === 'report') openReportDialog(latlng);
      else {
        if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        setLocation({ ...latlng, manual: true });
        mapView.focus(latlng.lat, latlng.lng, 14);
      }
    },
  });

  bindEvents();
  renderAll();
  showTab(['home', 'dashboard', 'map', 'actions'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');

  const [provinces, reports] = await Promise.all([api.provinces(), api.reports()]).catch((err) => {
    toast(errorMessage(err));
    return [null, null];
  });
  if (provinces) mapView.setProvinces(provinces);
  if (reports) mapView.setReports(reports.reports);
  await refreshOverview();
  connectEvents();

  // 이전에 직접 고른 위치 복원, 또는 이미 권한이 있으면 GPS 자동 시작
  const saved = storage('get', LOCATION_KEY);
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
    setLocation({ lat: saved.lat, lng: saved.lng, manual: true });
  }
  if (window.isSecureContext && navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') startGps();
    } catch {
      // permissions API 미지원 브라우저
    }
  }

  setInterval(refreshSituation, SITUATION_REFRESH_MS);
  setInterval(refreshOverview, OVERVIEW_REFRESH_MS);
}

main();
