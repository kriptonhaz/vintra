-- Free-text job title / position for staff. Distinct from the RBAC
-- role on tenant_members — owners use this to record what each staff
-- actually does ("Kasir", "Cleaning Service", "Sekretaris", etc).
ALTER TABLE "staff_profiles"
  ADD COLUMN "position" text;
