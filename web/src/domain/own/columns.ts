/** Guess which CSV column holds which invoice field, from header names. */
export type OwnField =
  | "vendor" | "invoiceNumber" | "date" | "total" | "subtotal" | "tax" | "shipping" | "discount" | "currency";
export const REQUIRED_FIELDS: readonly OwnField[] = ["vendor", "invoiceNumber", "total"];
export type ColumnMapping = Partial<Record<OwnField, number>>;

const SYNONYMS: Readonly<Record<OwnField, readonly string[]>> = {
  vendor: ["Vendor", "Vendor Name", "Supplier", "Payee", "Contact", "ContactName", "Name"],
  invoiceNumber: ["Invoice No", "Invoice Number", "Bill No", "Bill Number", "Ref No", "Reference", "InvoiceNumber", "Num", "Doc Number"],
  date: ["Date", "Bill Date", "Invoice Date", "InvoiceDate", "Txn Date", "Transaction Date"],
  total: ["Total", "Amount", "Total Amount", "Open Balance", "Amount Due", "Bill Total", "Grand Total"],
  subtotal: ["Subtotal", "Sub Total", "Net Amount"],
  tax: ["Tax", "Tax Amount", "TaxTotal", "Sales Tax", "VAT"],
  shipping: ["Shipping", "Freight", "Delivery"],
  discount: ["Discount", "Discount Amount"],
  currency: ["Currency", "Currency Code"],
};
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const SETS = (Object.keys(SYNONYMS) as OwnField[]).map((f) => [f, new Set(SYNONYMS[f].map(key))] as const);

/** First matching header (left to right) wins; a column is never used twice. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const [field, names] of SETS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && names.has(key(h)));
    if (i >= 0) {
      mapping[field] = i;
      used.add(i);
    }
  }
  return mapping;
}
