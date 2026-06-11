---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Route the transaction-detail Cetak button through the thermal printer.

The thermal-printer Cetak path was only wired into the post-sale success modal — the transaction-history detail page (`/pos/sales/:id`) still opened a PDF blob. The full thermal pipeline (fetch payload → dither logo → render ESC/POS → write) is now extracted into `useThermalPrinter().printReceipt`, shared by both screens. When a printer is paired the detail page's Cetak prints straight to it; otherwise it falls back to the PDF preview as before.
