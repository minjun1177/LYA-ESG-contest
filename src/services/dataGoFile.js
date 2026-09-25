// 공공데이터포털(data.go.kr) '파일데이터'를 데이터셋 번호로 내려받는다 (로그인·인증키 불필요)
//   https://www.data.go.kr/data/<번호>/fileData.do 페이지에서 최신 파일 ID를 찾아 다운로드
// 파일이 외부 사이트(서울 열린데이터광장 등)로만 연결된 데이터셋은 지원하지 않는다.

const BASE = 'https://www.data.go.kr';
const TIMEOUT_MS = 30000;
const USER_AGENT = 'Mozilla/5.0 (compatible; climate-safety-dashboard shelter importer)';

export class DataGoFileError extends Error {}

export async function downloadDataGoFile(datasetId, fetchImpl = globalThis.fetch) {
  if (!/^\d+$/.test(String(datasetId))) throw new DataGoFileError(`invalid dataset id: ${datasetId}`);
  const pageUrl = `${BASE}/data/${datasetId}/fileData.do`;

  const page = await fetchImpl(pageUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!page.ok) throw new DataGoFileError(`dataset page HTTP ${page.status}: ${pageUrl}`);
  const html = await page.text();
  const m = html.match(/atchFileId=(FILE_\d+)&(?:amp;)?fileDetailSn=(\d+)/);
  if (!m) {
    throw new DataGoFileError(`no direct download on ${pageUrl} (the file may only be offered on an external site)`);
  }

  const fileUrl = `${BASE}/cmm/cmm/fileDownload.do?atchFileId=${m[1]}&fileDetailSn=${m[2]}&insertDataPrcus=N`;
  const res = await fetchImpl(fileUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new DataGoFileError(`download HTTP ${res.status}: ${fileUrl}`);
  const disposition = res.headers.get('content-disposition') ?? '';
  // 헤더 값은 latin1 로 해석되어 오므로 한글 파일명을 UTF-8 로 되돌린다
  const rawName = disposition.match(/filename="?([^";]+)"?/)?.[1];
  const filename = rawName ? Buffer.from(rawName, 'latin1').toString('utf8') : `${datasetId}.csv`;
  if (!/\.csv$/i.test(filename)) throw new DataGoFileError(`not a CSV file: ${filename}`);
  return { filename, buffer: Buffer.from(await res.arrayBuffer()), sourceUrl: pageUrl };
}
