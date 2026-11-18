import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphCanvas } from '@your-scope/graphkit/react';
import type { GraphCanvasRef, GraphNode, PositionedGraphNode } from '@your-scope/graphkit/react';
import '@your-scope/graphkit/styles.css';

const initial = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: 110 + (i % 2) * 150, y: 100 + Math.floor(i / 2) * 170, width: 60, height: 35, type: id === 'a' ? 'custom' : undefined }));
const edges = [
  { id: 'ab', source: 'a', target: 'b', points: [{ x: 140, y: 100 }, { x: 185, y: 72 }, { x: 230, y: 100 }] },
  { id: 'cd', source: 'c', target: 'd', points: [{ x: 140, y: 270 }, { x: 185, y: 242 }, { x: 230, y: 270 }] },
];
function Custom({ node }: { node: GraphNode }) {
  const [clicks, setClicks] = useState(0);
  return <button data-no-drag onClick={() => setClicks(clicks + 1)}>{node.id}:{clicks}</button>;
}
const nodeTypes = { custom: Custom };

function Example() {
  const ref = useRef<GraphCanvasRef>(null);
  const [nodes, setNodes] = useState<PositionedGraphNode[]>(initial);
  const [connections, setConnections] = useState('');
  return <>
    <div>{[0.5, 1, 2].map(zoom => <button key={zoom} onClick={() => {
      setNodes(initial);
      ref.current?.setViewport({ x: 30, y: 30, zoom });
    }}>{zoom}x</button>)}<output>{connections}</output></div>
    <GraphCanvas ref={ref} nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectable
      interactiveEdgeRouting="orthogonal"
      onNodeDragEnd={(id, point) => setNodes(current => current.map(n => n.id === id ? { ...n, ...point } : n))}
      canConnect={({ source, target }) => source !== target}
      onConnect={({ source, target }) => setConnections(source + ':' + target)} />
  </>;
}
createRoot(document.querySelector('#root')!).render(<Example />);
