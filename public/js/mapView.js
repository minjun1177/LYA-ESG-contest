// Leaflet + OpenStreetMap 지도 화면
// 사용자 입력(제보 설명 등)은 innerHTML 대신 textContent 로만 넣는다 (XSS 방지)

import { t, formatAgo, formatDistance, formatTime } from './i18n.js';

const KOREA_CENTER = [36.35, 127.8];
const KOREA_ZOOM = 7;
const SHELTER_MIN_ZOOM = 11; // 이 배율 이상에서만 화면 범위 대피소를 불러옴
const COLORS = { warning: '#dc2626', advisory: '#f59e0b', none: '#94a3b8', shelter: '#16a34a', recommended: '#2563eb', quake: '#7c3aed' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hazardLabel(w) {
  return `${t(`hazard.${w.hazard}.name`)} ${t(`level.${w.level}`)}`;
}

export function createMapView({ api, onPick, onResolveReport, getConfig }) {
  const map = L.map('map', { zoomControl: true }).setView(KOREA_CENTER, KOREA_ZOOM);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const layers = {
    provinces: L.geoJSON(null, { style: () => ({ weight: 1, color: '#475569', fillOpacity: 0.05 }) }).addTo(map),
    earthquakes: L.layerGroup().addTo(map),
    shelters: L.layerGroup().addTo(map),
    recommended: L.layerGroup().addTo(map),
    reports: L.layerGroup().addTo(map),
    user: L.layerGroup().addTo(map),
  };

  const state = {
    byProvince: {},
    earthquakes: [],
    shelters: new Map(),
    recommended: [],
    reports: new Map(),
    user: null,
    pickMode: null,
    layerControl: null,
  };

  // ---------- 레이어 켜고 끄기 (이름은 언어에 따라 다시 만든다) ----------
  function buildLayerControl() {
    if (state.layerControl) state.layerControl.remove();
    state.layerControl = L.control
      .layers(null, {
        [t('map.layerProvinces')]: layers.provinces,
        [t('map.layerShelters')]: layers.shelters,
        [t('map.layerReports')]: layers.reports,
        [t('map.layerEarthquakes')]: layers.earthquakes,
      }, { collapsed: true })
      .addTo(map);
  }

  function renderLegend() {
    const legend = document.getElementById('map-legend');
    legend.replaceChildren();
    for (const [color, key] of [[COLORS.warning, 'map.legendWarning'], [COLORS.advisory, 'map.legendAdvisory'], [COLORS.none, 'map.legendNone']]) {
      const row = el('div');
      const swatch = el('i');
      swatch.style.background = color;
      row.append(swatch, el('span', null, t(key)));
      legend.append(row);
    }
    const shelterRow = el('div');
    const s = el('i');
    s.style.background = COLORS.recommended;
    s.style.borderRadius = '50%';
    shelterRow.append(s, el('span', null, t('map.recommended')));
    legend.append(shelterRow);
  }

  // ---------- 시·도 특보 폴리곤 ----------
  function provinceStyle(feature) {
    const top = state.byProvince[feature.properties.id]?.[0];
    const color = top ? COLORS[top.level] : COLORS.none;
    return { color: top ? color : '#64748b', weight: top ? 2 : 1, fillColor: color, fillOpacity: top ? 0.35 : 0.04 };
  }

  function provincePopup(feature) {
    const box = el('div', 'popup');
    box.append(el('h4', null, t(`province.${feature.properties.id}`)));
    const list = state.byProvince[feature.properties.id] ?? [];
    if (list.length === 0) box.append(el('p', null, t('map.provinceNone')));
    for (const w of list) {
      box.append(el('p', null, w.partial ? `${hazardLabel(w)} · ${w.detail}` : hazardLabel(w)));
    }
    return box;
  }

  function setProvinces(geojson) {
    layers.provinces.clearLayers();
    layers.provinces.addData(geojson);
    layers.provinces.eachLayer((layer) => layer.bindPopup(() => provincePopup(layer.feature)));
    restyleProvinces();
  }

  function restyleProvinces() {
    layers.provinces.setStyle(provinceStyle);
  }

  // ---------- 지진 ----------
  function renderEarthquakes() {
    layers.earthquakes.clearLayers();
    for (const q of state.earthquakes) {
      const marker = L.circleMarker([q.lat, q.lng], {
        radius: 4 + q.magnitude * 3,
        color: COLORS.quake,
        fillColor: COLORS.quake,
        fillOpacity: 0.35,
        weight: 2,
      });
      marker.bindPopup(() => {
        const box = el('div', 'popup');
        box.append(el('h4', null, t('quake.title', { magnitude: q.magnitude })));
        box.append(el('p', null, formatTime(q.time)));
        if (q.location) box.append(el('p', null, q.location));
        if (q.depthKm) box.append(el('p', null, t('quake.depth', { depth: q.depthKm })));
        if (q.intensity) box.append(el('p', null, t('quake.intensity', { intensity: q.intensity })));
        return box;
      });
      layers.earthquakes.addLayer(marker);
    }
  }

  function setOverview(overview) {
    state.byProvince = overview.warnings.byProvince;
    state.earthquakes = overview.earthquakes.earthquakes;
    restyleProvinces();
    renderEarthquakes();
  }

  // ---------- 대피소 ----------
  function shelterPopup(s) {
    const box = el('div', 'popup');
    const title = el('h4', null, s.name);
    if (s.sample) title.append(el('span', 'badge sample', t('shelter.sample')));
    box.append(title);
    const meta = [t(`shelter.type.${s.type}`)];
    if (s.underground) meta.push(t('shelter.underground'));
    if (s.capacity) meta.push(t('shelter.capacity', { count: s.capacity }));
    box.append(el('p', null, meta.join(' · ')));
    if (s.address) box.append(el('p', null, s.address));
    if (state.user) {
      const d = L.latLng(state.user.lat, state.user.lng).distanceTo([s.lat, s.lng]);
      box.append(el('p', null, formatDistance(d)));
    }
    return box;
  }

  function renderShelters() {
    layers.shelters.clearLayers();
    const recommendedIds = new Set(state.recommended.map((s) => s.id));
    for (const s of state.shelters.values()) {
      if (recommendedIds.has(s.id)) continue;
      layers.shelters.addLayer(
        L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: COLORS.shelter, fillOpacity: 0.9 })
          .bindPopup(() => shelterPopup(s)),
      );
    }
    layers.recommended.clearLayers();
    state.recommended.forEach((s, i) => {
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${COLORS.recommended};color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 2px 6px rgb(0 0 0 / 35%)">${i + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 500,
      }).bindPopup(() => shelterPopup(s));
      s.marker = marker;
      layers.recommended.addLayer(marker);
    });
  }

  async function loadSheltersInView() {
    if (map.getZoom() < SHELTER_MIN_ZOOM) {
      state.shelters.clear();
      renderShelters();
      return;
    }
    const b = map.getBounds();
    try {
      const { shelters } = await api.shelters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      state.shelters = new Map(shelters.map((s) => [s.id, s]));
      renderShelters();
    } catch (err) {
      console.warn('shelters load failed', err);
    }
  }

  function setRecommended(shelters) {
    state.recommended = shelters;
    renderShelters();
  }

  // ---------- 시민 제보 ----------
  function reportPopup(r) {
    const cfg = getConfig();
    const box = el('div', 'popup');
    box.append(el('h4', null, t(`report.category.${r.category}`)));
    if (r.description) box.append(el('p', null, r.description));
    box.append(el('p', 'muted small', formatAgo(r.createdAt)));
    box.append(el('p', 'muted small', t('report.resolveVotes', { votes: r.resolveVotes, threshold: cfg.reportResolveThreshold })));
    const btn = el('button', 'btn small', t('report.resolve'));
    btn.type = 'button';
    btn.addEventListener('click', () => onResolveReport(r.id));
    box.append(btn);
    return box;
  }

  function reportIcon() {
    return L.divIcon({ className: '', html: '<div class="report-marker"><span>!</span></div>', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
  }

  function upsertReport(r) {
    const existing = state.reports.get(r.id);
    if (existing) {
      existing.data = r;
      return;
    }
    const marker = L.marker([r.lat, r.lng], { icon: reportIcon() });
    const entry = { data: r, marker };
    marker.bindPopup(() => reportPopup(entry.data));
    state.reports.set(r.id, entry);
    layers.reports.addLayer(marker);
  }

  function removeReport(id) {
    const entry = state.reports.get(id);
    if (!entry) return;
    layers.reports.removeLayer(entry.marker);
    state.reports.delete(id);
  }

  function setReports(reports) {
    layers.reports.clearLayers();
    state.reports.clear();
    reports.forEach(upsertReport);
  }

  // ---------- 내 위치 ----------
  function setUser(location) {
    state.user = location;
    layers.user.clearLayers();
    if (!location) return;
    L.marker([location.lat, location.lng], {
      icon: L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000,
      title: t('map.you'),
    }).addTo(layers.user);
    if (location.accuracy) {
      L.circle([location.lat, location.lng], { radius: location.accuracy, weight: 1, color: COLORS.recommended, fillOpacity: 0.08 }).addTo(layers.user);
    }
  }

  // ---------- 지도에서 위치 고르기 (제보 / 내 위치) ----------
  const hint = document.getElementById('map-hint');
  const hintText = document.getElementById('map-hint-text');
  const view = document.getElementById('view-map');

  function startPick(mode) {
    state.pickMode = mode;
    hintText.textContent = t(mode === 'report' ? 'map.pickReportHint' : 'map.pickLocationHint');
    hint.hidden = false;
    view.classList.add('picking');
  }

  function stopPick() {
    state.pickMode = null;
    hint.hidden = true;
    view.classList.remove('picking');
  }

  map.on('click', (e) => {
    if (!state.pickMode) return;
    const mode = state.pickMode;
    stopPick();
    onPick(mode, { lat: e.latlng.lat, lng: e.latlng.lng });
  });
  document.getElementById('btn-hint-cancel').addEventListener('click', stopPick);
  map.on('moveend', loadSheltersInView);

  document.getElementById('btn-nationwide').addEventListener('click', () => map.setView(KOREA_CENTER, KOREA_ZOOM));
  document.getElementById('btn-mylocation').addEventListener('click', () => {
    if (state.user) map.setView([state.user.lat, state.user.lng], 15);
    else startPick('location');
  });

  function focus(lat, lng, zoom = 16, marker) {
    map.setView([lat, lng], zoom);
    if (marker) setTimeout(() => marker.openPopup(), 300);
  }

  function focusShelter(id) {
    const s = state.recommended.find((x) => x.id === id);
    if (s) focus(s.lat, s.lng, 16, s.marker);
  }

  /** 언어가 바뀌면 이름이 들어간 컨트롤·안내를 다시 만든다 (팝업은 열 때마다 새로 생성됨) */
  function relocalize() {
    buildLayerControl();
    renderLegend();
    if (state.pickMode) startPick(state.pickMode);
    map.closePopup();
  }

  buildLayerControl();
  renderLegend();

  return {
    setProvinces,
    setOverview,
    setRecommended,
    setReports,
    upsertReport,
    removeReport,
    setUser,
    startPick,
    stopPick,
    focus,
    focusShelter,
    relocalize,
    invalidate: () => map.invalidateSize(),
    showUserArea: () => state.user && map.setView([state.user.lat, state.user.lng], 14),
  };
}
