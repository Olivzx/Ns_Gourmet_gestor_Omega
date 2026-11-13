-- Hardening migration for the public order endpoint.
-- Reasserts the current idempotent function definitions and access restrictions.
-- The complete, replayable definitions are maintained in 20261113000753_ns_gourmet_public_order_api.sql.
-- This migration is intentionally a no-op because the hardened definition was applied in the database
-- as migration 20261113000811 before this repository mirror was added.
SELECT 1;
