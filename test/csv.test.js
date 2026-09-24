import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, parseCsv, parseCsvObjects, toCsv } from '../src/lib/csv.js';

test('parseCsv handles quotes, escaped quotes, CRLF and newlines in cells', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2']]);
});

test('parseCsvObjects maps headers and skips blank lines', () => {
  assert.deepEqual(parseCsvObjects('name, lat\nA,1\n\n'), [{ name: 'A', lat: '1' }]);
});

test('decodeText handles UTF-8 BOM and EUC-KR', () => {
  assert.equal(decodeText(Buffer.from('﻿시설명', 'utf8')), '시설명');
  assert.equal(decodeText(Buffer.from([0xbd, 0xc3, 0xbc, 0xb3])), '시설'); // EUC-KR
});

test('toCsv escapes special characters and round-trips', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'q"' }]);
  assert.deepEqual(parseCsvObjects(csv), [{ a: 'x,y', b: 'q"' }]);
});
