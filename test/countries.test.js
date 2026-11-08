import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, isCountry, countryLabel, countryOptions } from '../public/countries.js';

test('country list has unique two-letter codes', () => {
  const codes = COUNTRIES.map(([c]) => c);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[A-Z]{2}$/);
});
test('codes are checked and labelled', () => {
  assert.equal(isCountry('KE'), true);
  assert.equal(isCountry('XX'), false);
  assert.equal(isCountry(undefined), false);
  assert.equal(countryLabel('KE'), '🇰🇪 Kenya');
});
test('the chosen country is selected once in the dropdown', () => {
  assert.equal(countryOptions('KE').match(/selected/g).length, 1);
  assert.equal(countryOptions('FR').match(/selected/g).length, 1);
});
