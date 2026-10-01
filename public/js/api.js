// 서버 API 호출. 실패하면 ApiError(code) — 문구는 화면에서 error.<code> 로 번역

export class ApiError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

// 기기 ID: 브라우저마다 한 번 만든 무작위 값(UUID v4). 같은 와이파이·터널 뒤의 사람들을 구분해
// 제보 확인 투표를 '서로 다른 기기'로 세는 데 쓴다. (저장소를 지우면 새로 만들어진다)
const DEVICE_KEY = 'deviceId';
let deviceId = null;

function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID(); // HTTPS·localhost
  const b = crypto.getRandomValues(new Uint8Array(16)); // HTTP 에서도 동작
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getDeviceId() {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId ?? '')) {
      deviceId = newUuid();
      localStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    deviceId ??= newUuid(); // 저장소를 못 쓰면 이번 접속 동안만 유지
  }
  return deviceId;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError('network');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 본문이 JSON이 아닌 경우 (터널 오류 페이지 등)
  }
  if (!res.ok) {
    const { error, ...details } = data ?? {};
    throw new ApiError(error || (res.status >= 500 ? 'internal' : 'network'), details);
  }
  return data;
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

export const api = {
  config: () => request('/api/config'),
  provinces: () => request('/api/provinces'),
  overview: () => request('/api/overview'),
  situation: ({ lat, lng, simulate }) => request(`/api/situation?${qs({ lat, lng, simulate })}`),
  shelters: (bbox) => request(`/api/shelters?${qs({ bbox: bbox.join(',') })}`),
  search: ({ q, lang }) => request(`/api/search?${qs({ q, lang })}`),
  reports: () => request('/api/reports'),
  createReport: (report) => request('/api/reports', { method: 'POST', body: JSON.stringify(report) }),
  voteReport: (id, kind, gps) => request(`/api/reports/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    body: JSON.stringify({ kind, gps }),
  }),
};
