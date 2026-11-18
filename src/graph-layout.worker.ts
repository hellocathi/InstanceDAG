import { calculateDagreLayout } from '@your-scope/graphkit/layout';
import type { LayoutJob, LayoutReply } from './layout-protocol.js';

self.onmessage = ({ data }: MessageEvent<LayoutJob>) => {
  const { session, version, graph } = data;
  const start = performance.now();
  let reply: LayoutReply;
  try {
    const result = calculateDagreLayout(graph);
    reply = { session, version, result, workerComputeMs: performance.now() - start };
  } catch (error) {
    reply = { session, version, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
};
