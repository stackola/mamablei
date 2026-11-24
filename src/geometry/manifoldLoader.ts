import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let promise: Promise<ManifoldToplevel> | null = null;

/** Loads the Manifold WASM module once (works in the page and in workers). */
export function loadManifold(): Promise<ManifoldToplevel> {
  if (!promise) {
    promise = Module({ locateFile: () => wasmUrl }).then((m) => {
      m.setup();
      return m;
    });
  }
  return promise;
}
