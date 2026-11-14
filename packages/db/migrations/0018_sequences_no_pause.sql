-- Sequences can no longer be paused. Any that were paused keep running.
UPDATE "sequences" SET "status" = 'active' WHERE "status" = 'paused';
