import { useCallback, useEffect, useRef, useState } from 'react';
import type { Design } from './types';

const STORAGE_KEY = 'bleiglas.design.v1';
const MAX_HISTORY = 200;

interface H {
  past: Design[];
  present: Design;
  future: Design[];
}

export function loadStoredDesign(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Design;
    return d && d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export type Updater = Design | ((d: Design) => Design);

/** Design state with undo/redo. Transient updates (dragging) are folded into
 * one history step by `commit()`. */
export function useDesignHistory(initial: () => Design) {
  const [h, setH] = useState<H>(() => ({ past: [], present: initial(), future: [] }));
  const pendingBase = useRef<Design | null>(null);

  const update = useCallback((u: Updater, transient = false) => {
    setH((s) => {
      const next = typeof u === 'function' ? u(s.present) : u;
      if (next === s.present) return s;
      if (transient) {
        if (!pendingBase.current) pendingBase.current = s.present;
        return { ...s, present: next };
      }
      const base = pendingBase.current ?? s.present;
      pendingBase.current = null;
      return { past: [...s.past, base].slice(-MAX_HISTORY), present: next, future: [] };
    });
  }, []);

  const commit = useCallback(() => {
    setH((s) => {
      const base = pendingBase.current;
      pendingBase.current = null;
      if (!base || base === s.present) return s;
      return { past: [...s.past, base].slice(-MAX_HISTORY), present: s.present, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setH((s) => {
      if (pendingBase.current) {
        const base = pendingBase.current;
        pendingBase.current = null;
        return { past: s.past, present: base, future: [s.present, ...s.future] };
      }
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setH((s) => {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return { past: [...s.past, s.present], present: next, future: rest };
    });
  }, []);

  /** Replace everything (new / open file) – starts a fresh history. */
  const reset = useCallback((d: Design) => {
    pendingBase.current = null;
    setH({ past: [], present: d, future: [] });
  }, []);

  // Autosave.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(h.present));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [h.present]);

  return {
    design: h.present,
    update,
    commit,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0 || pendingBase.current !== null,
    canRedo: h.future.length > 0,
  };
}
