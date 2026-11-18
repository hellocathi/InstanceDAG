import type { LayoutInput, LayoutResult } from '@your-scope/graphkit/layout';

export interface LayoutJob { session: number; version: number; graph: LayoutInput }
export type LayoutReply = Pick<LayoutJob, 'session' | 'version'> & (
  { result: LayoutResult; workerComputeMs: number } | { error: string }
);

export function acceptsLayout(job: LayoutJob | undefined, reply: LayoutReply): boolean {
  return !!job && job.session === reply.session && job.version === reply.version;
}
