import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockApi, createHttpApi } from '../.test-dist/api.js';
import { createGraphModel } from '../.test-dist/model.js';
import { acceptsLayout } from '../.test-dist/layout-protocol.js';

const loading = (nodeId, direction, depth) => ({ nodeId, direction, depth });
const ids = ({ nodes }) => nodes.map(n => n.id).sort();
const session = () => {
  const calls = [];
  const graphs = [];
  const api = createMockApi({ delay: q => q?.nodeId === 'metrics' ? 45 : 1, onRequest: q => calls.push(q) });
  return { calls, graphs, model: createGraphModel(api, g => graphs.push(g)), api };
};

test('initial neighborhood and exact one-call depths in both directions', async () => {
  const { calls, graphs, model } = session();
  await model.load('daily-a', 'center');
  assert.deepEqual(ids(graphs[0]), ['audit', 'center', 'metrics', 'orders', 'products']);
  for (const direction of ['parents', 'children']) for (const depth of [1, 2, 'all']) {
    const query = loading('center', direction, depth);
    await model.expand(query);
    assert.deepEqual(calls.at(-1), { ...query, instanceId: 'daily-a' });
  }
  assert.equal(calls.length, 7);
  assert.equal(graphs.at(-1).nodes.length, 9);
  assert.equal(graphs.at(-1).edges.length, 9);
});

test('inflight/cache dedupe and out-of-order responses both merge with latest intent', async () => {
  const { calls, graphs, model } = session();
  await model.load('daily-a', 'center');
  const first = loading('metrics', 'children', 'all');
  const second = loading('audit', 'children', 1);
  await Promise.all([model.expand(first), model.expand(first), model.expand(second)]);
  await model.expand(first);
  assert.equal(calls.length, 3);
  const result = graphs.at(-1);
  assert.equal(result.anchorId, 'audit');
  assert.equal(result.nodes.filter(n => n.id === 'report').length, 1);
  assert.ok(result.edges.some(e => e.id === 'metrics:report'));
  assert.ok(result.edges.some(e => e.id === 'audit:report'));
  assert.ok(result.nodes.some(n => n.id === 'sink'));
});

test('switch discards old responses even if adapter ignores cancellation', async () => {
  const { api } = session();
  const graphs = [];
  const model = createGraphModel({
    ...api, getDependencies: query => api.getDependencies(query),
  }, graph => graphs.push(graph));
  await model.load('daily-a', 'center');
  const request = model.expand(loading('metrics', 'children', 'all'));
  await model.load('daily-b', 'center');
  assert.equal(await request, false);
  assert.equal(graphs.length, 2);
  assert.equal(graphs.at(-1).nodes.find(n => n.id === 'center').label, '渠道宽表汇总');
});

test('failure can retry and malformed merges are atomic', async () => {
  const { api } = session();
  let attempts = 0;
  const graphs = [];
  const model = createGraphModel({
    ...api, async getDependencies(query) {
      attempts++;
      if (attempts === 1) throw Error('network');
      const result = await api.getDependencies(query);
      if (attempts === 2) result.edges.push({ id: 'bad', source: 'missing', target: 'center', relationType: 'dependency' });
      return result;
    },
  }, graph => graphs.push(graph));
  await model.load('daily-a', 'center');
  const query = loading('center', 'children', 'all');
  await assert.rejects(model.expand(query), /network/);
  await assert.rejects(model.expand(query), /端点缺失/);
  assert.equal(graphs.length, 1);
  await model.expand(query);
  assert.equal(graphs.at(-1).deltaNodes, 2);
  assert.equal(attempts, 3);
});

test('HTTP adapter encodes expansion in a single request', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    calls.push(new URL(input));
    return Response.json({ nodes: [], edges: [] });
  };
  try {
    await createHttpApi('https://example.com/api/').getDependencies({ instanceId: 'a/b', ...loading('a#b', 'parents', 'all') });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/api/dependencies');
    assert.deepEqual(Object.fromEntries(calls[0].searchParams), { instanceId: 'a/b', nodeId: 'a#b', direction: 'parents', depth: 'all' });
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('worker results must match both layout version and graph session', () => {
  const latest = { version: 9, session: 4 };
  assert.ok(acceptsLayout(latest, { ...latest, error: 'test' }));
  assert.equal(acceptsLayout(latest, { ...latest, version: 8 }), false);
  assert.equal(acceptsLayout(latest, { ...latest, session: 3 }), false);
  assert.equal(acceptsLayout(undefined, latest), false);
});
