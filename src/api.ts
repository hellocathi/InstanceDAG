export type Direction = 'parents' | 'children';
export type Depth = number | 'all';
export interface DependencyQuery { instanceId: string; nodeId: string; direction: Direction; depth: Depth }
export interface TaskNode {
  id: string;
  type: 'task';
  label: string;
  width: number;
  height: number;
  status: 'success' | 'running' | 'queued' | 'failed';
  category: string;
}
export interface TaskEdge { id: string; source: string; target: string; relationType: string }
export interface DependencyResponse { graphVersion?: string; nodes: TaskNode[]; edges: TaskEdge[] }
export interface DependencyApi {
  getInitialNeighborhood(instanceId: string, centerId: string, signal?: AbortSignal): Promise<DependencyResponse>;
  getDependencies(query: DependencyQuery, signal?: AbortSignal): Promise<DependencyResponse>;
}

export function createHttpApi(base: string): DependencyApi {
  async function get(path: string, values: Record<string, string>, signal?: AbortSignal): Promise<DependencyResponse> {
    const response = await fetch(`${base.replace(/\/$/, '')}/${path}?${new URLSearchParams(values)}`,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`依赖接口返回 HTTP ${response.status}`);
    return response.json();
  }
  return {
    getInitialNeighborhood: (instanceId, centerId, signal) => get('neighborhood', { instanceId, centerId }, signal),
    getDependencies: ({ instanceId, nodeId, direction, depth }, signal) =>
      get('dependencies', { instanceId, nodeId, direction, depth: String(depth) }, signal),
  };
}

const fixture = [
  ['raw', 'ODS 原始流水', '数据接入', 'success'],
  ['users', '用户维表同步', '数据接入', 'success'],
  ['orders', '订单明细清洗', '数据加工', 'success'],
  ['products', '商品维表构建', '数据加工', 'success'],
  ['center', '交易宽表汇总', '当前实例', 'running'],
  ['metrics', '核心指标聚合', '数据服务', 'queued'],
  ['audit', '交易质量校验', '质量监控', 'queued'],
  ['report', '经营日报产出', '报表发布', 'queued'],
  ['sink', '指标数据归档', '数据归档', 'queued'],
] as const;

export function createMockGraph(instanceId: string): DependencyResponse {
  const nodes = fixture.map(([id, label, category, status]): TaskNode => ({
    id, type: 'task', label: instanceId === 'daily-b' && id === 'center' ? '渠道宽表汇总' : label,
    category, status, width: 184, height: 78,
  }));
  const pairs = [
    ['raw', 'orders'], ['users', 'products'], ['orders', 'center'], ['products', 'center'],
    ['center', 'metrics'], ['center', 'audit'], ['metrics', 'report'], ['audit', 'report'], ['report', 'sink'],
  ];
  return { graphVersion: 'mock-v1', nodes, edges: pairs.map(([source, target]) =>
    ({ id: `${source}:${target}`, source, target, relationType: 'dependency' })) };
}

export interface MockOptions {
  delay?: (query: DependencyQuery | null) => number;
  fail?: (query: DependencyQuery | null) => boolean;
  onRequest?: (query: DependencyQuery | null) => void;
}
export function createMockApi(options: MockOptions = {}): DependencyApi {
  async function wait(query: DependencyQuery | null, signal?: AbortSignal) {
    signal?.throwIfAborted();
    options.onRequest?.(query);
    const delay = options.delay?.(query) ?? 220;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
      function abort() { clearTimeout(timer); reject(signal?.reason); }
      signal?.addEventListener('abort', abort, { once: true });
    });
    if (options.fail?.(query)) throw new Error('模拟接口暂时不可用，请重试');
  }
  function range(graph: DependencyResponse, id: string, direction: Direction, depth: Depth) {
    const nodes = new Set([id]);
    const edges = new Set<string>();
    let frontier = [id];
    for (let level = 0; frontier.length && (depth === 'all' || level < depth); level++) {
      const next: string[] = [];
      const current = new Set(frontier);
      for (const edge of graph.edges) {
        const [from, to] = direction === 'children' ? [edge.source, edge.target] : [edge.target, edge.source];
        if (!current.has(from)) continue;
        edges.add(edge.id);
        if (!nodes.has(to)) { nodes.add(to); next.push(to); }
      }
      frontier = next;
    }
    return { nodes, edges };
  }
  function select(graph: DependencyResponse, ranges: ReturnType<typeof range>[]): DependencyResponse {
    return {
      graphVersion: graph.graphVersion,
      nodes: graph.nodes.filter(n => ranges.some(r => r.nodes.has(n.id))),
      edges: graph.edges.filter(e => ranges.some(r => r.edges.has(e.id))),
    };
  }
  return {
    async getInitialNeighborhood(instanceId, centerId, signal) {
      await wait(null, signal);
      const graph = createMockGraph(instanceId);
      if (!graph.nodes.some(n => n.id === centerId)) throw new Error('找不到当前实例节点');
      return select(graph, [range(graph, centerId, 'parents', 1), range(graph, centerId, 'children', 1)]);
    },
    async getDependencies(query, signal) {
      await wait(query, signal);
      const graph = createMockGraph(query.instanceId);
      if (!graph.nodes.some(n => n.id === query.nodeId)) throw new Error('找不到展开节点');
      if (query.depth !== 'all' && (!Number.isSafeInteger(query.depth) || query.depth < 1)) throw new Error('展开深度必须为正整数');
      return select(graph, [range(graph, query.nodeId, query.direction, query.depth)]);
    },
  };
}
