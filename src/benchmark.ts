import type { LayoutInput } from '@your-scope/graphkit/layout';
import type { GraphSnapshot } from './model.js';

export function benchmarkGraph(size: 100 | 1000 | 5000): LayoutInput {
  const nodes = Array.from({ length: size }, (_, i) => ({ id: String(i), width: 184, height: 78 }));
  // Independent 10-node pipelines with a shared downstream inside each pipeline.
  const edges = nodes.flatMap((n, i) => {
    const slot = i % 10;
    const targets = slot < 8 ? [i + 1, ...(slot % 2 === 0 ? [i + 2] : [])] : slot === 8 ? [i + 1] : [];
    return targets.map(target => ({ id: `${n.id}:${target}`, source: n.id, target: String(target) }));
  });
  return { nodes, edges, options: { direction: 'LR', nodeSep: 30, rankSep: 90 } };
}

export function benchmarkSnapshot(size: 100 | 1000 | 5000, version: number): GraphSnapshot {
  const graph = benchmarkGraph(size);
  return {
    session: -1, revision: version, started: performance.now(), requestMs: 0,
    deltaNodes: graph.nodes.length, deltaEdges: graph.edges.length,
    nodes: graph.nodes.map(n => ({ ...n, label: `任务 ${Number(n.id) + 1}`, type: 'task', status: 'success', category: '性能样本' })),
    edges: graph.edges.map(e => ({ ...e, relationType: 'dependency' })),
  };
}
