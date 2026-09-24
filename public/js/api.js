// 서버 API 호출. 실패하면 ApiError(code) — 문구는 화면에서 error.<code> 로 번역

export class ApiError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
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
  reports: () => request('/api/reports'),
  createReport: (report) => request('/api/reports', { method: 'POST', body: JSON.stringify(report) }),
  resolveReport: (id) => request(`/api/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST' }),
};
