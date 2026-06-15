-- Realtime stock sync: enable RLS + Supabase Realtime on the inventory
-- tables the browser needs to watch, so a stock change made on one device
-- (sale, opname, PO receipt) streams to every other device live.
--
-- Server functions connect as the `postgres` role, which OWNS these tables
-- and therefore BYPASSES RLS (no FORCE ROW LEVEL SECURITY is set), so the
-- Drizzle data layer is completely unaffected. Only the browser's
-- `authenticated` role — which talks to Realtime directly with the user's
-- JWT — is gated by the SELECT policies below.

-- The `authenticated` role cannot necessarily read `tenant_members` directly,
-- so an inline `SELECT ... FROM tenant_members` inside a policy is fragile.
-- This SECURITY DEFINER helper runs as its owner (postgres), and only ever
-- returns the tenant ids of the CURRENT user, so it leaks nothing.
-- search_path is pinned per Supabase's security guidance.
CREATE OR REPLACE FUNCTION public.auth_tenant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = (SELECT auth.uid())
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_tenant_ids() TO authenticated;
--> statement-breakpoint

-- No-ops if already enabled; kept for a clean re-create on a fresh database.
ALTER TABLE "inventory_stock_balances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A signed-in user may read inventory rows for any tenant they belong to.
CREATE POLICY "tenant members read stock balances"
  ON "inventory_stock_balances"
  FOR SELECT
  TO authenticated
  USING ("tenant_id" IN (SELECT public.auth_tenant_ids()));
--> statement-breakpoint
CREATE POLICY "tenant members read movements"
  ON "inventory_movements"
  FOR SELECT
  TO authenticated
  USING ("tenant_id" IN (SELECT public.auth_tenant_ids()));
--> statement-breakpoint

-- Supabase grants these by default, but make the read grant explicit so the
-- policies above actually have something to gate.
GRANT SELECT ON "inventory_stock_balances" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "inventory_movements" TO authenticated;
--> statement-breakpoint

-- Realtime needs the full old row to evaluate RLS on UPDATE/DELETE events;
-- the default (primary-key only) replica identity is not enough.
ALTER TABLE "inventory_stock_balances" REPLICA IDENTITY FULL;
--> statement-breakpoint
ALTER TABLE "inventory_movements" REPLICA IDENTITY FULL;
--> statement-breakpoint

-- Publish the tables to the Realtime stream.
ALTER PUBLICATION supabase_realtime ADD TABLE "inventory_stock_balances";
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE "inventory_movements";
