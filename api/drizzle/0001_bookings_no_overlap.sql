-- Hand-written (drizzle-kit can't express EXCLUDE constraints). IDEMPOTENT:
-- runs on every container start.
--
-- Double booking is prevented HERE, not by app code alone: no two bookings of
-- the same listing may overlap in time while in an item-occupying state. Keep
-- the state list in sync with OCCUPYING_STATES in src/booking/states.ts.
--
-- btree_gist is a trusted extension (PG13+), so the database owner
-- (borrowvault_app) can create it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
   "listing_id" WITH =,
   tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("state" IN ('ACCEPTED', 'DEPOSIT_HELD', 'HANDOVER_PENDING', 'ACTIVE', 'OVERDUE', 'RETURN_PENDING'));
 END IF;
END $$;
