-- Template snapshot (docs/MESSAGING_ENGINE.md → Template snapshot): what a template message looked
-- like when it was sent. Older template messages get theirs from the `template:snapshot-backfill`
-- worker CLI (idempotent, batched).
ALTER TABLE "messages" ADD COLUMN "template_snapshot" JSONB;

-- `text_search` is a generated column owned by post-migrate.sql. Drop it here so post-migrate
-- re-adds it with the rendered template text included (a generated column can't be altered).
DROP INDEX IF EXISTS "messages_text_search_idx";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "text_search";
