import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphCanvas } from '@your-scope/graphkit/react';
import type { GraphCanvasRef, GraphEdge, GraphNode, LayoutAnchor, PositionedGraphNode } from '@your-scope/graphkit/react';
import '@your-scope/graphkit/styles.css';
import { createHttpApi, createMockApi } from './api.js';
import type { Depth, Direction, TaskEdge, TaskNode } from './api.js';
import { benchmarkSnapshot } from './benchmark.js';
import { acceptsLayout } from './layout-protocol.js';
import type { LayoutJob, LayoutReply } from './layout-protocol.js';
import { createGraphModel } from './model.js';
import type { GraphSnapshot } from './model.js';
import './styles.css';

const statuses = { success: '成功', running: '运行中', queued: '待调度', failed: '失败' };
const search = new URLSearchParams(location.search);
let failedOnce = false;
const api = import.meta.env.VITE_DEPENDENCY_API ? createHttpApi(import.meta.env.VITE_DEPENDENCY_API) : createMockApi({
  fail: query => {
    if (!query || !search.has('failOnce') || failedOnce) return false;
    failedOnce = true;
    return true;
  },
});
const centerId = 'center';

function TaskCard({ node }: { node: GraphNode<TaskNode> }) {
  const task = node.data!;
  return <div className={`task-card ${task.id === centerId ? 'task-center' : ''}`}>
    <div className="task-icon" aria-hidden="true">◇</div>
    <div className="task-copy"><strong>{task.label}</strong><span>{task.category}</span></div>
    <span title={statuses[task.status]} aria-label={statuses[task.status]} className={`status-dot ${task.status}`} />
  </div>;
}
const nodeTypes = { task: TaskCard };

function Icon({ name }: { name: 'graph' | 'fit' | 'target' | 'download' | 'chevron' | 'minus' | 'plus' | 'close' }) {
  const paths = {
    graph: 'M6 6L18 12 6 18M4 4h4v4H4zM16 10h4v4h-4zM4 16h4v4H4z',
    fit: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
    target: 'M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
    chevron: 'm9 10 3 3 3-3', minus: 'M5 12h14', plus: 'M5 12h14m-7-7v14', close: 'm6 6 12 12M18 6 6 18',
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

interface Metrics {
  phase: string;
  visible_nodes: number;
  visible_edges: number;
  delta_nodes: number;
  delta_edges: number;
  request_ms: number;
  worker_compute_ms: number;
  roundtrip_ms: number;
  svg_update_ms?: number;
  dom_node_count?: number;
  interactive_ms?: number;
}
interface RenderGraph {
  nodes: PositionedGraphNode<TaskNode>[];
  edges: GraphEdge<TaskEdge>[];
  anchor?: LayoutAnchor;
  metric?: Metrics;
  renderedAt?: number;
  started?: number;
}
interface Pending {
  job: LayoutJob;
  snapshot: GraphSnapshot;
  sent: number;
  oldPosition?: { x: number; y: number };
}

const empty: RenderGraph = { nodes: [], edges: [] };

function App() {
  const [instance, setInstance] = useState('daily-a');
  const [graph, setGraph] = useState<RenderGraph>(empty);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [detail, setDetail] = useState<TaskNode>();
  const [error, setError] = useState<{ message: string; retry: () => void }>();
  const [fetching, setFetching] = useState(0);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [lastMetric, setLastMetric] = useState<Metrics>();
  const [dataMode, setDataMode] = useState('demo');
  const ref = useRef<GraphCanvasRef>(null);
  const panel = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = useRef<RenderGraph>(empty);
  const metrics = useRef<Metrics[]>([]);
  const generation = useRef(0);
  const nextVersion = useRef(0);
  const pending = useRef<Pending | undefined>(undefined);
  const worker = useRef<Worker | undefined>(undefined);
  const model = useRef<ReturnType<typeof createGraphModel> | undefined>(undefined);
  const latestSnapshot = useRef<GraphSnapshot | undefined>(undefined);

  function schedule(snapshot: GraphSnapshot) {
    latestSnapshot.current = snapshot;
    const retry = () => { if (latestSnapshot.current === snapshot) schedule(snapshot); };
    const job: LayoutJob = { session: snapshot.session, version: ++nextVersion.current, graph: {
      nodes: snapshot.nodes.map(({ id, width, height }) => ({ id, width, height })),
      edges: snapshot.edges.map(({ id, source, target }) => ({ id, source, target })),
      options: { direction: 'LR', nodeSep: 45, rankSep: 102, marginX: 16, marginY: 16 },
    } };
    const anchor = shown.current.nodes.find(node => node.id === snapshot.anchorId);
    pending.current = { job, snapshot, sent: performance.now(), oldPosition: anchor && { x: anchor.x, y: anchor.y } };
    setLayoutBusy(true);
    try {
      if (!worker.current) {
        const w = new Worker(new URL('./graph-layout.worker.ts', import.meta.url), { type: 'module' });
        worker.current = w;
        w.onmessage = ({ data }: MessageEvent<LayoutReply>) => {
          const task = pending.current;
          if (worker.current !== w || !task || !acceptsLayout(task.job, data)) return;
          pending.current = undefined;
          setLayoutBusy(false);
          if ('error' in data) {
            setError({ message: data.error, retry: () => { if (latestSnapshot.current === task.snapshot) schedule(task.snapshot); } });
            return;
          }
          const { snapshot, oldPosition } = task;
          const nodes = new Map(snapshot.nodes.map(n => [n.id, n]));
          const edges = new Map(snapshot.edges.map(e => [e.id, e]));
          setGraph({
            nodes: data.result.nodes.map(n => { const task = nodes.get(n.id)!; return { ...n, type: task.type, label: task.label, data: task }; }),
            edges: data.result.edges.map(e => ({ ...e, data: edges.get(e.id)! })),
            anchor: oldPosition && snapshot.anchorId ? { revision: data.version, nodeId: snapshot.anchorId, oldPosition } : undefined,
            metric: {
              phase: snapshot.query ? `${snapshot.query.direction}:${snapshot.query.depth}` : task.job.session === -1 ? 'benchmark' : 'initial',
              visible_nodes: nodes.size, visible_edges: edges.size, delta_nodes: snapshot.deltaNodes, delta_edges: snapshot.deltaEdges,
              request_ms: snapshot.requestMs, worker_compute_ms: data.workerComputeMs, roundtrip_ms: performance.now() - task.sent,
            },
            renderedAt: performance.now(),
            started: snapshot.started,
          });
        };
        w.onerror = event => {
          if (worker.current !== w) return;
          w.terminate();
          worker.current = undefined;
          const task = pending.current;
          pending.current = undefined;
          setLayoutBusy(false);
          if (task) setError({ message: event.message || '布局 Worker 异常退出', retry: () => { if (latestSnapshot.current === task.snapshot) schedule(task.snapshot); } });
        };
      }
      worker.current.postMessage(job);
    } catch (cause) {
      pending.current = undefined;
      setLayoutBusy(false);
      setError({ message: String(cause), retry });
    }
  }

  function reset() {
    generation.current++;
    latestSnapshot.current = undefined;
    model.current?.dispose();
    worker.current?.terminate();
    worker.current = undefined;
    pending.current = undefined;
    setGraph(empty);
    shown.current = empty;
    setMenu(undefined);
    setDetail(undefined);
    setError(undefined);
    setFetching(0);
    setLayoutBusy(false);
  }

  function runRequest(run: () => Promise<boolean>) {
    const current = generation.current;
    setError(undefined);
    setFetching(n => n + 1);
    void run().catch(cause => {
      if (generation.current === current) setError({ message: cause instanceof Error ? cause.message : String(cause), retry: () => runRequest(run) });
    }).finally(() => {
      if (generation.current === current) setFetching(n => n - 1);
    });
  }

  function openInstance(id: string) {
    reset();
    setInstance(id);
    setDataMode('demo');
    const next = createGraphModel(api, snapshot => schedule(snapshot));
    model.current = next;
    runRequest(() => next.load(id, centerId));
  }

  useEffect(() => {
    openInstance('daily-a');
    return () => {
      generation.current++;
      model.current?.dispose();
      worker.current?.terminate();
    };
  }, []);

  useLayoutEffect(() => {
    shown.current = graph;
    if (!graph.metric || graph.renderedAt === undefined || graph.started === undefined) return;
    if (!graph.anchor) ref.current?.fitView();
    const { metric, renderedAt, started } = graph;
    let frame = requestAnimationFrame(() => {
      const svgUpdateMs = performance.now() - renderedAt;
      // Sample after the frame that mounted the foreignObject portal contents.
      frame = requestAnimationFrame(() => {
        const entry = {
          ...metric, svg_update_ms: svgUpdateMs,
          dom_node_count: panel.current?.querySelectorAll('svg[aria-label="Graph"] *').length ?? 0,
          interactive_ms: performance.now() - started,
        };
        metrics.current.push(entry);
        setLastMetric(entry);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [graph]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    function close(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(undefined);
    }
    function escape(e: KeyboardEvent) { if (e.key === 'Escape') setMenu(undefined); }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);

  function expand(direction: Direction, depth: Depth) {
    if (!menu || !model.current) return;
    const nodeId = menu.id;
    setMenu(undefined);
    if (depth === 'all' && !window.confirm('展开全部依赖可能增加布局时间。继续展开？')) return;
    const current = model.current;
    runRequest(() => current.expand({ nodeId, direction, depth }));
  }

  function resizeZoom(multiplier: number) {
    const canvas = ref.current;
    const rect = panel.current?.getBoundingClientRect();
    if (!canvas || !rect) return;
    const view = canvas.getViewport();
    const next = Math.min(4, Math.max(0.15, view.zoom * multiplier));
    const ratio = next / view.zoom;
    canvas.setViewport({ x: rect.width / 2 * (1 - ratio) + view.x * ratio, y: rect.height / 2 * (1 - ratio) + view.y * ratio, zoom: next });
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(metrics.current, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'instance-dag-metrics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Icon name="graph" /></span> OneGraph <span className="brand-divider" /><span className="product">实例依赖</span></div>
      <label className="instance-select"><span>调度实例</span><select value={instance} onChange={e => openInstance(e.target.value)} aria-label="调度实例"><option value="daily-a">交易日调度 · A</option><option value="daily-b">渠道日调度 · B</option></select><Icon name="chevron" /></label>
    </header>
    <main className="workspace">
      <div className="heading">
        <div><div className="crumb">调度运维 <span>›</span> 依赖分析</div><h1>实例依赖图</h1><p>查看任务上下游关系，按层展开依赖链路。</p></div>
        <div className="header-actions">
          <label><span className="sr-only">性能样本</span><select aria-label="性能样本" value={dataMode} onChange={e => {
            const value = e.target.value;
            if (value === 'demo') { openInstance(instance); return; }
            reset(); setDataMode(value);
            schedule(benchmarkSnapshot(Number(value) as 100 | 1000 | 5000, nextVersion.current + 1));
          }}><option value="demo">业务示例</option><option value="100">100 节点</option><option value="1000">1,000 节点</option><option value="5000">5,000 节点</option></select></label>
          <button onClick={download} disabled={!lastMetric}><Icon name="download" />导出耗时</button>
        </div>
      </div>
      <section className="graph-shell" aria-label="实例依赖画布">
        <div className="graph-bar">
          <div className="graph-title"><span className="graph-title-icon"><Icon name="graph" /></span><strong>任务依赖关系</strong><span className="count">{graph.nodes.length} 个节点 · {graph.edges.length} 条依赖</span></div>
          <div className="tools"><button onClick={() => ref.current?.focusNode(centerId)} disabled={dataMode !== 'demo'}><Icon name="target" />当前任务</button><button onClick={() => ref.current?.fitView()}><Icon name="fit" />适应画布</button></div>
        </div>
        <section className="graph-panel" ref={panel}>
          <GraphCanvas ref={ref} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} draggable={dataMode !== 'demo'}
            onNodeDragEnd={dataMode === 'demo' ? undefined : (id, point) => setGraph(current => ({
              nodes: current.nodes.map(node => node.id === id ? { ...node, ...point } : node),
              edges: current.edges,
            }))}
            layoutAnchor={graph.anchor} onViewportChange={v => setZoom(v.zoom)}
            onNodeClick={id => setDetail(graph.nodes.find(n => n.id === id)?.data)}
            onNodeContextMenu={dataMode === 'demo' ? ({ nodeId, clientX, clientY }) => setMenu({
              id: nodeId, x: Math.max(8, Math.min(clientX, window.innerWidth - 236)), y: Math.max(8, Math.min(clientY, window.innerHeight - 294)),
            }) : undefined} />
          <div className="canvas-tip">{dataMode === 'demo' ? '滚轮缩放 · 拖动画布 · 右键节点展开' : '滚轮缩放 · 拖动画布或节点'}</div>
          {(fetching > 0 || layoutBusy) && <div className="loading" role="status"><span />{layoutBusy ? '正在计算布局…' : '正在获取依赖…'}</div>}
          {error && <div className="error" role="alert"><span>{error.message}</span><button onClick={() => { setError(undefined); error.retry(); }}>重试</button><button aria-label="关闭错误提示" onClick={() => setError(undefined)}><Icon name="close" /></button></div>}
          <div className="zoom"><button aria-label="缩小" onClick={() => resizeZoom(1 / 1.25)}><Icon name="minus" /></button><output aria-label="缩放比例">{Math.round(zoom * 100)}%</output><button aria-label="放大" onClick={() => resizeZoom(1.25)}><Icon name="plus" /></button></div>
          {detail && <aside className="detail"><button aria-label="关闭详情" onClick={() => setDetail(undefined)}><Icon name="close" /></button><h2>{detail.label}</h2><p>{detail.category} · {statuses[detail.status]}</p><small>{detail.id}</small></aside>}
        </section>
        <footer className="graph-footer"><div className="legend">{Object.entries(statuses).map(([key, label]) => <span key={key}><i className={`status-dot ${key}`} />{label}</span>)}</div><span>{lastMetric ? `上次布局 ${lastMetric.worker_compute_ms.toFixed(1)} ms` : 'Dagre 布局'}</span></footer>
      </section>
    </main>
    {menu && <div className="context-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} aria-label="展开依赖">
      {(['parents', 'children'] as const).map(direction => <div key={direction}><strong>{direction === 'parents' ? '上游依赖' : '下游依赖'}</strong>
        {([1, 2, 'all'] as const).map(depth => <button key={depth} onClick={() => expand(direction, depth)}>
          展开{direction === 'parents' ? '上游' : '下游'}{depth === 'all' ? '全部' : ` ${depth} 级`}
        </button>)}</div>)}
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
