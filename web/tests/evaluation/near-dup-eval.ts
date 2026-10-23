/** Measure nearDuplicates against the hand-written labels in tests/fixtures/own/near-dup-v1.labels.json. */
import { readFileSync } from "node:fs";
import { NEAR_DUP_WINDOW_DAYS } from "../../src/domain/contracts.ts";
import { guessMapping } from "../../src/domain/own/columns.ts";
import { buildOwnRows } from "../../src/domain/own/rows.ts";
import type { OwnInvoice } from "../../src/domain/own/rows.ts";
import { nearDuplicates } from "../../src/domain/rules.ts";

interface LabelPair { readonly rows: readonly [number, number]; readonly genuine?: boolean; readonly scenario: string }
export interface NearDupLabels { readonly pairs: readonly LabelPair[]; readonly exactDuplicatePairs: readonly LabelPair[] }

const fixture = (name: string) => new URL(`../fixtures/own/${name}`, import.meta.url);
export const idForRow = (row: number) => `R${String(row).padStart(3, "0")}`;
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export function loadNearDupFixture(): { invoices: OwnInvoice[]; labels: NearDupLabels } {
  const bytes = new Uint8Array(readFileSync(fixture("near-dup-v1.csv")));
  const headers = new TextDecoder().decode(bytes).split("\n")[0]!.trim().split(",");
  const r = buildOwnRows(bytes, guessMapping(headers), { dateOrder: null, fileLabel: "near-dup-v1.csv" });
  if (!("invoices" in r) || r.skipped.length || r.warnings.length) throw new Error(`near-dup fixture did not load cleanly: ${JSON.stringify(r)}`);
  const invoices = r.invoices.map((inv) => ({ ...inv, recordId: idForRow(inv.rowNumber) }));
  const labels = JSON.parse(readFileSync(fixture("near-dup-v1.labels.json"), "utf-8")) as NearDupLabels;
  return { invoices, labels };
}

/** Raw counts from an actual run: tp/fp over every flagged pair, fn over genuine labelled pairs. */
export function measureNearDuplicates() {
  const { invoices, labels } = loadNearDupFixture();
  const flagged = new Set(nearDuplicates(invoices, NEAR_DUP_WINDOW_DAYS).map((f) => pairKey(f.memberIds[0]!, f.memberIds[1]!)));
  const genuine = new Set(labels.pairs.filter((p) => p.genuine).map((p) => pairKey(idForRow(p.rows[0]), idForRow(p.rows[1]))));
  const labelled = new Set(labels.pairs.map((p) => pairKey(idForRow(p.rows[0]), idForRow(p.rows[1]))));
  const tp = [...flagged].filter((k) => genuine.has(k)).length;
  return {
    pairsLabelled: labels.pairs.length,
    tp,
    fp: flagged.size - tp,
    fn: genuine.size - tp,
    unlabelledFlagged: [...flagged].filter((k) => !labelled.has(k)),
  };
}
