-- Unwind the inventory Realtime setup created in 0137.
--
-- 0137 put `inventory_stock_balances` and `inventory_movements` into the
-- `supabase_realtime` publication with REPLICA IDENTITY FULL so a client-side
-- websocket could stream `postgres_changes` to every signed-in tab. That is
-- expensive twice over: REPLICA IDENTITY FULL makes every UPDATE write the
-- entire old row into the WAL, and every subscribed tab then receives every
-- row for its tenant. `inventory_movements` is written on every POS sale via
-- BOM deduction, so the volume is proportional to sales, not to how many
-- people are actually looking at a stock screen.
--
-- The app now polls a ~50-byte watermark (`getStockWatermark`) instead, so
-- none of this is needed. Teardown order matters: the policies reference
-- `auth_tenant_ids()`, so they must go first.

--> statement-breakpoint
-- 1. Leave the realtime publication. Guarded because a database that never
--    ran 0137 (or had it partially applied) would otherwise error here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'inventory_stock_balances'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE "inventory_stock_balances";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'inventory_movements'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE "inventory_movements";
  END IF;
END
$$;--> statement-breakpoint

-- 2. Stop writing full old rows into the WAL on every UPDATE.
ALTER TABLE "inventory_stock_balances" REPLICA IDENTITY DEFAULT;--> statement-breakpoint
ALTER TABLE "inventory_movements" REPLICA IDENTITY DEFAULT;--> statement-breakpoint

-- 3. Drop the read policies. They existed only to gate realtime delivery —
--    all application reads go through server functions on the service role.
DROP POLICY IF EXISTS "tenant members read stock balances" ON "inventory_stock_balances";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant members read movements" ON "inventory_movements";--> statement-breakpoint

-- 4. Revoke the direct table grants the websocket needed. RLS stays ENABLED
--    on both tables, so with no policy and no grant the `authenticated` role
--    now reads nothing directly — which is the correct posture.
REVOKE SELECT ON "inventory_stock_balances" FROM authenticated;--> statement-breakpoint
REVOKE SELECT ON "inventory_movements" FROM authenticated;--> statement-breakpoint

-- 5. The SECURITY DEFINER helper is now unreferenced (0137 was its only user).
DROP FUNCTION IF EXISTS public.auth_tenant_ids();
