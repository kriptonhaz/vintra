---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": minor
---

Add Web Bluetooth thermal printer support for POS (JUR-12).

When a Bluetooth thermal printer is paired in POS Settings → Printer Thermal, the Cetak button on the cashier success modal streams ESC/POS bytes straight to it via BLE GATT instead of opening the browser print dialog. Tested against a 58mm RPP02N. Supports 58mm and 80mm paper widths, dithered tenant logo (Floyd-Steinberg), multi-tax breakdown, loyalty footer, and partial cut. Falls back to the existing PDF receipt flow on unpaired devices and on browsers without Web Bluetooth (iOS Safari, Firefox).

- New `thermal_printer` POS feature flag, included in Toko + Komplit tiers. Free tier keeps PDF-only.
- Per-device pairing (localStorage `jq_pos_thermal_printer`) — different cashier tablets can pair different printers.
- Server function `getSaleDataForPrinter` returns the same sale payload the PDF renderer uses, as JSON, with the tenant logo as a base64 data URL for client-side dithering.
- ESC/POS lib at `apps/web/src/lib/escpos/` (commands, dither, render-receipt) — no external dependency.
- Web Bluetooth driver at `apps/web/src/lib/printer/bluetooth.ts` covers RPP02N's primary service plus three fallback services (ISSC UART, legacy 0xff00, generic 0x18f0) so other common ESC/POS BLE printers should pair without code changes.
- Bluetooth Classic SPP printers are out of scope (Web Bluetooth speaks BLE GATT only).
