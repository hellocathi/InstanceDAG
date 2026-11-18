import type { DependencyApi, DependencyQuery, DependencyResponse, TaskEdge, TaskNode } from './api.js';

interface Session {
  id: number;
  instanceId: string;
  abort: AbortController;
  graphVersion?: string;
  nodesById: Map<string, TaskNode>;
  edgesById: Map<string, TaskEdge>;
  visibleNodeIds: Set<string>;
  visibleEdgeIds: Set<string>;
  cache: Map<string, DependencyResponse>;
  inflight: Map<string, Promise<boolean>>;
}
export interface GraphSnapshot {
  session: number;
  revision: number;
  nodes: TaskNode[];
  edges: TaskEdge[];
  anchorId?: string;
  requestMs: number;
  deltaNodes: number;
  deltaEdges: number;
  query?: DependencyQuery;
  started: number;
}
export function createGraphModel(api: DependencyApi, onGraph: (graph: GraphSnapshot) => void) {
  let session: Session | undefined;
  let sessionId = 0;
  let revision = 0;
  let lastIntent: string | undefined;
  function merge(active: Session, response: DependencyResponse, started: number, query?: DependencyQuery): boolean {
    if (active !== session) return false;
    if (active.graphVersion && response.graphVersion && active.graphVersion !== response.graphVersion) {
      throw new Error('图版本已变化，请重新加载实例');
    }
    const nodes = new Map<string, TaskNode>();
    const edges = new Map<string, TaskEdge>();
    for (const n of response.nodes) {
      if (typeof n.id !== 'string' || !n.id || nodes.has(n.id) || ![n.width, n.height].every(d => Number.isFinite(d) && d > 0)) {
        throw new Error(`无效或重复节点 ${n.id}`);
      }
      nodes.set(n.id, n);
    }
    for (const e of response.edges) {
      const previous = active.edgesById.get(e.id);
      if (typeof e.id !== 'string' || !e.id || edges.has(e.id) || (previous && (previous.source !== e.source || previous.target !== e.target))) {
        throw new Error(`无效或冲突的边 ID ${e.id}`);
      }
      if (![e.source, e.target].every(id => nodes.has(id) || active.visibleNodeIds.has(id))) throw new Error(`边 ${e.id} 的端点缺失`);
      edges.set(e.id, e);
    }
    const oldNodes = active.visibleNodeIds.size;
    const oldEdges = active.visibleEdgeIds.size;
    active.graphVersion ??= response.graphVersion;
    let changed = false;
    for (const [id, n] of nodes) {
      const old = active.nodesById.get(id);
      if (!old || old.label !== n.label || old.status !== n.status || old.width !== n.width ||
        old.height !== n.height || old.type !== n.type || old.category !== n.category) changed = true;
      active.nodesById.set(id, n);
      active.visibleNodeIds.add(id);
    }
    for (const [id, e] of edges) {
      if (active.edgesById.get(id)?.relationType !== e.relationType || !active.edgesById.has(id)) changed = true;
      active.edgesById.set(id, e);
      active.visibleEdgeIds.add(id);
    }
    if (changed || !query) onGraph({
      session: active.id, revision: ++revision, anchorId: query ? lastIntent : undefined, requestMs: performance.now() - started,
      nodes: [...active.visibleNodeIds].map(id => active.nodesById.get(id)!),
      edges: [...active.visibleEdgeIds].map(id => active.edgesById.get(id)!),
      deltaNodes: active.visibleNodeIds.size - oldNodes, deltaEdges: active.visibleEdgeIds.size - oldEdges, query, started,
    });
    return true;
  }
  return {
    async load(instanceId: string, centerId: string) {
      session?.abort.abort();
      lastIntent = undefined;
      const active: Session = {
        id: ++sessionId, instanceId, abort: new AbortController(), nodesById: new Map(), edgesById: new Map(),
        visibleNodeIds: new Set(), visibleEdgeIds: new Set(), cache: new Map(), inflight: new Map(),
      };
      session = active;
      const started = performance.now();
      try {
        const response = await api.getInitialNeighborhood(instanceId, centerId, active.abort.signal);
        if (!response.nodes.some(node => node.id === centerId)) throw new Error('初始数据缺少当前实例节点');
        return merge(active, response, started);
      } catch (error) {
        if (session === active) throw error;
        return false;
      }
    },
    async expand(query: Omit<DependencyQuery, 'instanceId'>) {
      const active = session;
      if (!active || !active.visibleNodeIds.has(query.nodeId)) return false;
      lastIntent = query.nodeId;
      const request = { ...query, instanceId: active.instanceId };
      const key = JSON.stringify([active.instanceId, active.graphVersion ?? null, query.nodeId, query.direction, query.depth]);
      if (active.cache.has(key)) return true;
      const existing = active.inflight.get(key);
      if (existing) return existing;
      const started = performance.now();
      const pending = Promise.resolve().then(() => api.getDependencies(request, active.abort.signal))
        .then(response => {
          const accepted = merge(active, response, started, request);
          if (accepted) active.cache.set(JSON.stringify([active.instanceId, active.graphVersion ?? null,
            query.nodeId, query.direction, query.depth]), response);
          return accepted;
        }).catch(error => {
          if (session === active) throw error;
          return false;
        }).finally(() => active.inflight.delete(key));
      active.inflight.set(key, pending);
      return pending;
    },
    dispose() { const active = session; session = undefined; active?.abort.abort(); },
  };
}
