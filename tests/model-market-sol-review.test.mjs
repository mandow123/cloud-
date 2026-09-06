import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { modelRegistry, USD_CNY_FALLBACK } from '../data/model-market-registry.mjs';
import { buildPendingSnapshot, createPromotedSnapshot } from '../scripts/model-market/pipeline.mjs';

test('reviewed Sol standard rates clear the actual discrepancy while old rates still fail closed', async () => {
  const ecb = await readFile(new URL('../scripts/model-market/fixtures/ecb-daily.xml', import.meta.url), 'utf8');
  const options = {
    usdCnyFallback: USD_CNY_FALLBACK, now: '2026-09-06T15:00:00Z',
    fetchImpl: async url => new Response(String(url).includes('ecb') ? ecb : JSON.stringify({ 'gpt-5.6-sol': {
      input_cost_per_token: 0.000004, cache_read_input_token_cost: 0.0000004, output_cost_per_token: 0.00002,
    } }), { status: 200 }),
  };
  const old = await buildPendingSnapshot({ ...options, modelRegistry: modelRegistry.map(row => row.id === 'openai-gpt-56-sol-standard' ? {...row, inputPerMillion:5,cachedInputPerMillion:0.5,outputPerMillion:30} : row) });
  assert.equal(old.quotes.find(row => row.id === 'openai-gpt-56-sol-standard').freshness.state, 'review_required');
  assert.throws(() => createPromotedSnapshot(old, { now: '2026-09-06T15:01:00Z' }), error => error.code === 'REVIEW_REQUIRED');
  const fresh = await buildPendingSnapshot({ ...options, modelRegistry });
  const row = fresh.quotes.find(row => row.id === 'openai-gpt-56-sol-standard');
  assert.equal(row.freshness.state, 'current');
  assert.deepEqual([row.originalInputPerMillion,row.originalCachedInputPerMillion,row.originalOutputPerMillion],[4,0.4,20]);
  const promoted = createPromotedSnapshot(fresh, { now: '2026-09-06T15:01:00Z' });
  assert.equal(promoted.quotes.length, modelRegistry.length);
});
