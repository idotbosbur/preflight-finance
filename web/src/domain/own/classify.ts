/** Tell a bills export from a bank or card statement by its header row, so one drop zone takes both. */
import { REQUIRED_FIELDS, guessMapping, key } from "./columns.ts";
import { guessBankMapping } from "./bank.ts";

export type FileKind = "bills" | "statement";

const BANK_WORDS = new Set(["balance", "runningbalance", "debit", "credit", "postingdate", "posteddate", "postdate", "transactiondate",
  "withdrawal", "withdrawals", "deposit", "deposits", "moneyout", "moneyin"]);

/** null when neither layout is recognised (the person then chooses). */
export function classifyHeaders(headers: readonly string[]): FileKind | null {
  const bills = guessMapping(headers);
  const billsOk = REQUIRED_FIELDS.every((f) => bills[f] !== undefined);
  const invoiceWord = bills.invoiceNumber !== undefined && /invoice|bill/.test(key(headers[bills.invoiceNumber] ?? ""));
  const bank = guessBankMapping(headers);
  const bankOk = bank.date !== undefined && bank.description !== undefined && (bank.amount !== undefined || bank.moneyOut !== undefined);
  const bankWord = headers.some((h) => BANK_WORDS.has(key(h)));
  if (billsOk && invoiceWord) return "bills";
  if (bankOk && (bankWord || !billsOk)) return "statement";
  if (billsOk) return "bills";
  return bankOk ? "statement" : null;
}
