import { useState, useCallback } from 'react';

export function useUndoRedo<T>(initial: T, maxHistory = 40) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);

  const push = useCallback((next: T) => {
    setPast(p => [...p.slice(-(maxHistory - 1)), present]);
    setPresent(next);
    setFuture([]);
  }, [present, maxHistory]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(p => p.slice(0, -1));
    setFuture(f => [present, ...f]);
    setPresent(prev);
  }, [past, present]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(f => f.slice(1));
    setPast(p => [...p, present]);
    setPresent(next);
  }, [future, present]);

  const reset = useCallback((val: T) => {
    setPast([]);
    setPresent(val);
    setFuture([]);
  }, []);

  return {
    state: present,
    push,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    reset,
  };
}
