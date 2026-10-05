-- Expire legacy pre-MFA challenges; no financial history or subscriptions are rewritten.
ALTER TABLE platform_challenges ADD COLUMN parent_family_id uuid;
UPDATE platform_challenges SET expires_at = LEAST(expires_at, now());
ALTER TABLE platform_audit ADD COLUMN details jsonb;
