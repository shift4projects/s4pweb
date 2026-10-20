import { useState, type DragEvent } from "react";

export const move = <T,>(arr: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= arr.length || from === to) return arr;
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
};

/** Desktop drag-to-reorder (phones use the arrow buttons). Spread the returned props onto each item. */
export function useDragSort<T>(items: T[], key: (t: T) => string, onDrop: (next: T[]) => void) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (item: T) => {
    const k = key(item);
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => { setDrag(k); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); },
      onDragOver: (e: DragEvent) => { if (!drag) return; e.preventDefault(); if (over !== k) setOver(k); },
      onDragEnd: () => { setDrag(null); setOver(null); },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (drag && drag !== k) onDrop(move(items, items.findIndex((i) => key(i) === drag), items.findIndex((i) => key(i) === k)));
        setDrag(null); setOver(null);
      },
      "data-dragging": drag === k || undefined,
      "data-over": (over === k && drag !== k) || undefined,
    };
  };
}
