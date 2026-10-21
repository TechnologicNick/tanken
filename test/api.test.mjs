import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationQuery } from '../lib.mjs';

test('ANWB query uses latitude first and uppercase fuel identifiers', () => {
  const query = stationQuery(new URLSearchParams({ bounds: '52.3,4.8,52.4,4.95', fuel: 'DIESEL' }));
  assert.equal(query.get('bounding-box-filter'), '52.3,4.8,52.4,4.95');
  assert.equal(query.get('type-filter'), 'FUEL_STATION');
  assert.equal(query.get('fuel-types-filter'), 'DIESEL');
});
test('rejects malformed, reversed, and excessive bounding boxes before contacting upstream', () => {
  for (const bounds of ['', 'NaN,4,53,5', ',4,53,5', '54,4,53,5', '52,5,53,4', '-90,4,53,5', '52,4,54,5', '52,4,53,8']) {
    assert.throws(() => stationQuery(new URLSearchParams({ bounds })));
  }
  assert.throws(() => stationQuery(new URLSearchParams({ bounds: '52,4,53,5', fuel: 'invalid' })));
});
