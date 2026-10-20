-- Durable pending work recovery; existing delivery state is unchanged.
CREATE INDEX webhook_deliveries_pending_due_idx ON webhook_deliveries (next_attempt_at, id) WHERE status = 'PENDING';
