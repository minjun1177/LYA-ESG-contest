import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertShelterRows, findColumn } from '../src/lib/shelterImport.js';
import { downloadDataGoFile, DataGoFileError } from '../src/services/dataGoFile.js';

test('findColumn prefers exact names, then partial matches', () => {
  assert.equal(findColumn(['쉼터명', '위도'], ['시설명', '쉼터명']), '쉼터명');
  assert.equal(findColumn(['이용가능인원수'], ['수용인원', '이용가능인원']), '이용가능인원수');
  assert.equal(findColumn(['x'], ['y']), null);
});

test('converts real-world headers (Seoul Jung-gu cooling centers)', () => {
  const rows = [{
    쉼터명: '중구청', 소재지주소: '서울특별시 중구 창경궁로 17', 시설유형: '공공', 이용가능인원수: '50명',
    위도: '37.5638', 경도: '126.9976',
  }];
  const { shelters, columns } = convertShelterRows(rows, { type: 'heat' });
  assert.equal(columns.address, '소재지주소');
  assert.deepEqual(shelters[0], {
    name: '중구청', type: 'heat', lat: 37.5638, lng: 126.9976, address: '서울특별시 중구 창경궁로 17',
    capacity: '50', underground: 0, sample: 0,
  });
});

test('fixes swapped latitude/longitude columns (Daejeon Seo-gu data)', () => {
  const rows = [{ 쉼터명: '경로당', 위도: '127.3724047', 경도: '36.3069448' }, { 쉼터명: 'bad', 위도: '0', 경도: '0' }];
  const { shelters, swapped, skipped } = convertShelterRows(rows, { type: 'heat' });
  assert.equal(swapped, 1);
  assert.equal(skipped, 1);
  assert.equal(shelters[0].lat, 36.3069448);
  assert.equal(shelters[0].lng, 127.3724047);
});

test('underground detection and required columns', () => {
  const rows = [{ 시설명: 'A', '시설위치(지상/지하)': '지하 1층', 위도: '37.5', 경도: '127' }];
  assert.equal(convertShelterRows(rows, { type: 'civil_defense' }).shelters[0].underground, 1);
  assert.equal(convertShelterRows(rows, { type: 'civil_defense', underground: 'no' }).shelters[0].underground, 0);
  assert.throws(() => convertShelterRows([{ 시설명: 'A', 주소: 'x' }], { type: 'heat' }), /"lat" column/);
  assert.throws(() => convertShelterRows([], { type: 'heat' }), /no data rows/);
});

function fakeFetch(routes) {
  return async (url) => {
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return { ok: false, status: 404, headers: new Headers() };
    return hit[1](url);
  };
}

test('downloadDataGoFile follows the dataset page to the CSV file', async () => {
  const csv = Buffer.from('쉼터명,위도,경도\nA,37.5,127\n');
  const fetchImpl = fakeFetch([
    [/\/data\/123\/fileData\.do$/, async () => ({ ok: true, status: 200, text: async () => '<a onclick="x(\'atchFileId=FILE_000000001&amp;fileDetailSn=2\')">' })],
    [/fileDownload\.do\?atchFileId=FILE_000000001&fileDetailSn=2/, async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-disposition': `attachment; filename="${Buffer.from('쉼터.csv').toString('latin1')}"` }),
      arrayBuffer: async () => csv,
    })],
  ]);
  const file = await downloadDataGoFile('123', fetchImpl);
  assert.equal(file.filename, '쉼터.csv');
  assert.equal(file.buffer.toString(), csv.toString());
});

test('downloadDataGoFile reports datasets without a direct file', async () => {
  const fetchImpl = fakeFetch([[/fileData\.do$/, async () => ({ ok: true, status: 200, text: async () => '<html>external link</html>' })]]);
  await assert.rejects(downloadDataGoFile('456', fetchImpl), (e) => e instanceof DataGoFileError && /no direct download/.test(e.message));
  await assert.rejects(downloadDataGoFile('../x', fetchImpl), /invalid dataset id/);
});
