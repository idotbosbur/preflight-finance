import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText, delimitedToCsv, ofxToCsv, rowsToCsv } from "../../src/domain/own/convert.ts";

test("semicolon files become comma CSV, with decimal commas fixed", () => {
  const csv = delimitedToCsv("Lieferant;Rechnung;Datum;Betrag\r\nMüller GmbH;R-1;03.04.2026;1.234,56\r\n\"A; B\";R-2;05.04.2026;12,5\r\n");
  assert.equal(csv, "Lieferant,Rechnung,Datum,Betrag\r\nMüller GmbH,R-1,03.04.2026,1234.56\r\nA; B,R-2,05.04.2026,12.5\r\n");
});

test("tab-separated files become comma CSV; comma files are left alone", () => {
  assert.equal(delimitedToCsv("Date\tDescription\tAmount\n2026-01-05\tCOMCAST, INC\t-99.00\n"), 'Date,Description,Amount\r\n2026-01-05,"COMCAST, INC",-99.00\r\n');
  assert.equal(delimitedToCsv("Vendor,Invoice,Total\nA,1,2.00\n"), null);
});

test("OFX / QFX bank downloads become Date, Description, Amount", () => {
  const sgml = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000[-5:EST]<TRNAMT>-119.00<FITID>1<NAME>COMCAST BUSINESS<MEMO>INTERNET
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260322<TRNAMT>900.00<FITID>2<NAME>DEPOSIT
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.equal(ofxToCsv(sgml), "Date,Description,Amount\r\n2026-03-05,COMCAST BUSINESS INTERNET,-119.00\r\n2026-03-22,DEPOSIT,900.00\r\n");
  const xml = "<OFX><STMTTRN><DTPOSTED>20260110</DTPOSTED><TRNAMT>-59.99</TRNAMT><NAME>ADOBE</NAME></STMTTRN></OFX>";
  assert.equal(ofxToCsv(xml), "Date,Description,Amount\r\n2026-01-10,ADOBE,-59.99\r\n");
  assert.equal(ofxToCsv("Vendor,Total\n"), null);
});

test("spreadsheet cells: dates, float tails and blanks", () => {
  assert.equal(cellText(new Date(Date.UTC(2026, 2, 1))), "2026-03-01");
  assert.equal(cellText("1299.0100000000002"), "1299.01");
  assert.equal(cellText(1850), "1850");
  assert.equal(cellText(null), "");
  assert.equal(rowsToCsv([["a", "b,c"]]), 'a,"b,c"\r\n');
});
