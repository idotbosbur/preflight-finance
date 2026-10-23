/** Prefer persistent IndexedDB; fall back to a clearly labelled this-tab-only memory store. */
import { openIdbStore } from "./idbStore.ts";
import { createMemoryStore } from "./memoryStore.ts";
import type { ReviewStore } from "./store.ts";

export async function openBestStore(): Promise<{ store: ReviewStore; fallbackReason: string | null }> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return { store: createMemoryStore(), fallbackReason: "This browser has no IndexedDB." };
  try {
    // A connection that opens after the timeout is closed, never leaked.
    const store = await withTimeout(openIdbStore(factory), 4000, (late) => late.close());
    await store.getResetGeneration(); // proves a transaction can actually run (private modes may refuse)
    return { store, fallbackReason: null };
  } catch (err) {
    return { store: createMemoryStore(), fallbackReason: err instanceof Error ? err.message : "Browser storage unavailable." };
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, onLate: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; reject(new Error("Browser storage did not respond.")); }, ms);
    p.then(
      (v) => { if (timedOut) onLate(v); else { clearTimeout(t); resolve(v); } },
      (e) => { if (!timedOut) { clearTimeout(t); reject(e); } },
    );
  });
}
