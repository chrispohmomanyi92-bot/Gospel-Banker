import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localModerate } from '../server/moderation.js';

test('clean text passes untouched', () => {
  const r = localModerate('Happy Sabbath! See you at vespers.');
  assert.equal(r.allowed, true); assert.equal(r.flagged, false);
  assert.equal(r.text, 'Happy Sabbath! See you at vespers.');
});
test('profanity is masked, including leetspeak, stars and spacing', () => {
  for (const t of ['you idiot', 'sh1t', 'f*ck', 's h i t']) {
    const r = localModerate(t);
    assert.equal(r.flagged, true, t); assert.equal(r.allowed, true, t); assert.notEqual(r.text, t);
  }
});
test('threats are blocked', () => {
  for (const t of ['I will kill you', 'go die', 'kys']) assert.equal(localModerate(t).allowed, false, t);
});
test('theological words and lookalikes are not flagged', () => {
  for (const t of ['Hell is described in Revelation 20', 'Glasses class assess', 'Scrap the plan']) assert.equal(localModerate(t).flagged, false, t);
});
