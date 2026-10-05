ALTER TYPE actor_type ADD VALUE 'PLATFORM_OPERATOR';
CREATE TABLE platform_grants (user_id uuid PRIMARY KEY REFERENCES users(id), role text NOT NULL DEFAULT 'PLATFORM_OPERATOR' CHECK(role = 'PLATFORM_OPERATOR'), version integer NOT NULL DEFAULT 1, revoked_at timestamptz(3), reason text NOT NULL, granted_by text NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now());
CREATE TABLE platform_audit (id uuid PRIMARY KEY, operator_id uuid, workspace_id uuid, action text NOT NULL, outcome text NOT NULL, correlation_id text, created_at timestamptz(3) NOT NULL DEFAULT now());
CREATE INDEX platform_audit_created_at_id_idx ON platform_audit (created_at DESC, id);
