---
"@vintra/web": minor
---

See who's collecting stamps, and how fast.

Two surfaces that share the same data, answering different questions:

- **`/pos/loyalty` → Aktivitas Stempel**: pick a program, pick a period (Hari ini / Minggu ini / Bulan ini / Tahun ini), and see four summary cards (stempel diberikan, stempel ditukar, hadiah dibagikan, pelanggan aktif) plus a top-20 leaderboard with each member's name + phone, stempel periode ini, kartu saat ini (`3/5`), total seumur hidup, and hadiah diklaim seumur hidup. Period boundaries are Asia/Jakarta wall-clock — "Hari ini" means today in WIB, not today in UTC.
- **`/master/customers` → stamp badge per row**: each customer card now shows a small "N kartu · M stempel" pill (only when N > 0) so you can spot the high-engagement customers without drilling in.

New server fn `getStampActivity({ programId, period })` powers the loyalty side; the customer list reuses the existing `listCustomers` batch path with a single grouped aggregate over `customer_stamp_cards` joined to active programs.

Both views are gated behind the existing `loyalty_points` POS feature (Komplit). Toko/Free tenants who never see stamp programs naturally get zeros on the customer-list aggregate and don't see the loyalty section at all.
