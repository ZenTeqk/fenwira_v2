ALTER TABLE tenants ADD COLUMN business_hours jsonb;
-- Existing tenants RLS policies apply to this workspace setting; no new tenant table.
CREATE INDEX automation_steps_message_id ON automation_execution_steps ((output->>'messageId')) WHERE output ? 'messageId';
