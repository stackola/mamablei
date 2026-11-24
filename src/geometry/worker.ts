/// <reference lib="webworker" />
// Builds the 3D parts off the main thread.
import type { Design } from '../model/types';
import { loadManifold } from './manifoldLoader';
import { buildAll, type BuildOutput } from './pipeline';

export interface BuildRequest {
  id: number;
  design: Design;
}

export type BuildResponse =
  | { id: number; ok: true; out: BuildOutput }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pending: BuildRequest | null = null;
let busy = false;

async function run() {
  if (busy || !pending) return;
  busy = true;
  const req = pending;
  pending = null;
  try {
    const M = await loadManifold();
    const out = buildAll(M, req.design, true);
    const transfer: Transferable[] = [];
    for (const p of out.pieces) transfer.push(p.mesh.positions.buffer, p.mesh.indices.buffer);
    for (const p of out.panes) transfer.push(p.mesh.positions.buffer, p.mesh.indices.buffer);
    ctx.postMessage({ id: req.id, ok: true, out } satisfies BuildResponse, transfer);
  } catch (e) {
    ctx.postMessage({ id: req.id, ok: false, error: String((e as Error)?.message ?? e) } satisfies BuildResponse);
  } finally {
    busy = false;
    if (pending) void run();
  }
}

ctx.onmessage = (ev: MessageEvent<BuildRequest>) => {
  // Only the newest request matters.
  pending = ev.data;
  void run();
};
