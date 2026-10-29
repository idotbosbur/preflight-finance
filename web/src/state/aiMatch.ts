/**
 * The AI part of bank-vs-bills matching: a small sentence-embedding model (all-MiniLM-L6-v2, 8-bit,
 * about 23 MB) running in this browser through @huggingface/transformers. It scores how alike a bank
 * line and a supplier name are. Only the model files are downloaded (from huggingface.co, then
 * cached by the browser); no invoice or bank text leaves the device. The runtime's WebAssembly is
 * served from this site, not a CDN.
 *
 * If the model cannot load (offline, old browser), matching falls back to word overlap alone.
 */
import type { NameScorer } from "../domain/reconcile.ts";
import { tokenScore } from "../domain/reconcile.ts";
// ponytail: one runtime build (asyncify); Safari below 26 without WebGPU may fail to load it and falls back to word overlap.
import ortMjs from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

type Embed = (texts: string[]) => Promise<number[][]>;
let loading: Promise<Embed> | null = null;

function loadModel(onProgress?: (percent: number) => void): Promise<Embed> {
  loading ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
    if (onnx.wasm) onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, location.href).href, wasm: new URL(ortWasm, location.href).href };
    const extractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === "progress" && typeof p.progress === "number") onProgress?.(Math.round(p.progress));
      },
    });
    return async (texts: string[]) => (await extractor(texts, { pooling: "mean", normalize: true })).tolist() as number[][];
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** Bank lines carry card-processor prefixes and store numbers; keep the words a person would read. */
const clean = (s: string) => s.replace(/\b(?:SQ|TST|POS|ACH|DEBIT|PURCHASE|PAYMENT|CARD|PPD|WEB|ID)\b|\*|#?\d+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Builds a scorer for these exact strings: word overlap, or the model's cosine similarity when higher.
 * `ai` is false when the model could not be used.
 */
export async function buildScorer(descriptions: readonly string[], vendors: readonly string[], onProgress?: (percent: number) => void): Promise<{ scorer: NameScorer; ai: boolean }> {
  const words: NameScorer = (d, v) => ({ score: tokenScore(d, v), how: "name words" });
  if (descriptions.length === 0 || vendors.length === 0) return { scorer: words, ai: false };
  let vectors: Map<string, number[]>;
  try {
    const embed = await loadModel(onProgress);
    const texts = [...new Set([...descriptions, ...vendors].map(clean).filter(Boolean))];
    vectors = new Map();
    for (let i = 0; i < texts.length; i += 64) {
      const chunk = texts.slice(i, i + 64);
      (await embed(chunk)).forEach((v, j) => vectors.set(chunk[j]!, v));
    }
  } catch {
    return { scorer: words, ai: false };
  }
  const scorer: NameScorer = (d, v) => {
    const t = tokenScore(d, v);
    const a = vectors.get(clean(d)), b = vectors.get(clean(v));
    let cos = 0;
    if (a && b) for (let i = 0; i < a.length; i++) cos += a[i]! * b[i]!;
    return cos > t ? { score: cos, how: `AI similarity ${cos.toFixed(2)}` } : { score: t, how: "name words" };
  };
  return { scorer, ai: true };
}
