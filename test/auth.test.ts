import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesApiKey } from '../src/auth';

const key = 'local-simulation-only';

test('API key accepts only an exact match', () => {
  assert.equal(matchesApiKey(key, key), true);
  assert.equal(matchesApiKey('Local-simulation-only', key), false);
  assert.equal(matchesApiKey(`${key} `, key), false);
  assert.equal(matchesApiKey('incorrect', key), false);
});

test('API key rejects missing, empty and repeated headers', () => {
  for (const value of [undefined, null, '', [key], 123, {}]) {
    assert.equal(matchesApiKey(value, key), false);
  }
  assert.equal(matchesApiKey('', ''), false);
});

test('API key safely handles different UTF-8 byte lengths', () => {
  assert.equal(matchesApiKey('é', 'a'), false);
  assert.equal(matchesApiKey('é', 'é'), true);
});
