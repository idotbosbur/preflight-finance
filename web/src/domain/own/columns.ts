/** Guess which CSV column holds which invoice field, from header names. */
export type OwnField =
  | "vendor" | "invoiceNumber" | "date" | "total" | "subtotal" | "tax" | "shipping" | "discount" | "currency";
export const REQUIRED_FIELDS: readonly OwnField[] = ["vendor", "invoiceNumber", "total"];
export type ColumnMapping = Partial<Record<OwnField, number>>;

// Ordered by priority: the best-ranked synonym present in the headers wins.
const SYNONYMS: Readonly<Record<OwnField, readonly string[]>> = {
  vendor: ["Vendor", "Vendor Name", "Supplier", "Supplier Name", "Vendor/Supplier Name", "Payee", "ContactName", "Contact", "Name"],
  invoiceNumber: ["Invoice Number", "InvoiceNumber", "Invoice No", "Invoice #", "Inv No", "Inv #", "Bill Number", "Bill No", "Bill #", "Doc Number", "Ref No", "Num", "Invoice", "Reference"],
  date: ["Invoice Date", "InvoiceDate", "Bill Date", "Txn Date", "Transaction Date", "Date"],
  total: ["Total", "Total Amount", "Grand Total", "Bill Total", "Amount Due", "Amount", "Open Balance"],
  subtotal: ["Subtotal", "Sub Total", "Net Amount"],
  tax: ["Tax", "TaxTotal", "Tax Amount", "Sales Tax", "VAT"],
  shipping: ["Shipping", "Freight", "Delivery"],
  discount: ["Discount", "Discount Amount"],
  currency: ["Currency", "Currency Code"],
};
export const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const FIELDS = Object.keys(SYNONYMS) as OwnField[];

/** Per field, the best-ranked synonym wins (ties: leftmost column); a column is never used twice. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const keys = headers.map(key);
  for (const field of FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const k = key(syn);
      const i = keys.findIndex((h, idx) => !used.has(idx) && h === k);
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}
