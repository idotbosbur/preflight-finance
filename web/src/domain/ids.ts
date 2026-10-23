/**
 * Identity finalization (lead-owned): native async Web Crypto SHA-256, run after the pure
 * synchronous parse/rules step and BEFORE any IndexedDB transaction opens.
 * Parity with Python `make_finding_id` / `batch_id_for`.
 */
import type { CandidateFinding, Finding, Invoice, PreparedBatch } from "./contracts.ts";
import { RULESET_VERSION } from "./contracts.ts";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("Web Crypto is unavailable (open the demo over HTTPS or localhost).");
  return s;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  let out = "";
  for (const b of digest) out += HEX[b];
  return out;
}

const encoder = new TextEncoder();

export async function makeFindingId(ruleId: string, ruleVersion: string, memberIds: readonly string[]): Promise<string> {
  return (await sha256Hex(encoder.encode([ruleId, ruleVersion, ...memberIds].join("|")))).slice(0, 16);
}

export async function makeBatchId(fileSha256: string, ruleset: string = RULESET_VERSION): Promise<string> {
  return (await sha256Hex(encoder.encode(`${fileSha256}|${ruleset}`))).slice(0, 16);
}

export async function finalizeBatch(
  originalBytes: Uint8Array,
  invoices: readonly Invoice[],
  candidates: readonly CandidateFinding[],
): Promise<PreparedBatch> {
  const fileSha256 = await sha256Hex(originalBytes);
  const batchId = await makeBatchId(fileSha256);
  const findings: Finding[] = [];
  for (const c of candidates) {
    findings.push({ ...c, findingId: await makeFindingId(c.ruleId, c.ruleVersion, c.memberIds) });
  }
  return { fileSha256, batchId, invoices, findings };
}
