---
"@vintra/web": patch
---

Fix: Komplit activation respects existing module subscriptions (period rollover).

**Bug**: When admin activated Komplit on a tenant with an existing module subscription (e.g., Absensi Monthly active through May 15), the server blindly overwrote `inventory_settings.subscriptionExpiresAt` and `attendance_settings.subscriptionExpiresAt` with the Komplit period start (today). The tenant **lost paid time** — in the worst case (existing Inventory Annual through Dec 2027), they'd lose ~7 months of service.

**Fix**: For Komplit plans, the server now reads `posSettings`, `inventorySettings`, AND `attendanceSettings` and uses `MAX(now, posExpiry, inventoryExpiry, attendanceExpiry)` as the Komplit period start. Tenant gets uninterrupted service across all 3 modules; existing paid time is preserved by extending the Komplit period further into the future.

Example (corrected behavior): Tenant has Absensi Monthly through May 15 2026. Admin activates Komplit Annual on May 5 2026 → Komplit period = **May 15 2026 → May 15 2027** (not May 5 → May 5). Tenant pays Rp 660k and gets continuous service.

For pure POS plans (Toko monthly/annual), only `posSettings.subscriptionExpiresAt` matters — unchanged behavior.

**Admin UI**: `KomplitBundleBanner` now reads all 3 module subscriptions and shows an amber period-rollover warning before activation:

> ⚠️ Tenant ini punya langganan Absensi aktif sampai 15 Mei 2026.
> Periode Komplit otomatis dimulai dari tanggal tersebut — sisa waktu yang sudah dibayar tidak hangus.

So admin sees the rollover before paying, no surprises.

**Note on financial side**: this fix doesn't auto-refund the unused portion of the existing module subscription (the tenant still paid Rp 25k for May Absensi separately, then Rp 660k Komplit). If admin wants to issue a goodwill credit for the overlap, they can use the existing refund flow. Auto-refunding would be risky — we don't know if admin already discounted the Komplit price to compensate.