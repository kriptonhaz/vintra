-- Add branches.requires_schedule — drives attendance "simple mode".
--
-- A branch with requires_schedule = false runs attendance without a
-- fixed work schedule: staff clock in/out freely and records are saved
-- with a neutral 'present' status (no late/absent scoring). A branch
-- with requires_schedule = true keeps the existing schedule-backed
-- behavior with on-time/late classification.
--
-- DEFAULT true so every pre-existing branch keeps its current behavior
-- with zero data change — only branches created after this migration
-- start in simple mode (createBranch inserts false explicitly). The
-- NOT NULL + constant default is filled in instantly by Postgres.
--
-- Rollback:
--   ALTER TABLE "branches" DROP COLUMN "requires_schedule";

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "requires_schedule" boolean NOT NULL DEFAULT true;
