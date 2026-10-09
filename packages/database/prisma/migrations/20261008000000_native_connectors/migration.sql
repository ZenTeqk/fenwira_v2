-- CreateTable
CREATE TABLE "native_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "site" TEXT,
    "region" TEXT NOT NULL DEFAULT 'com',
    "secret_ciphertext" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "native_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "native_oauth_challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "state_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "site" TEXT,
    "region" TEXT NOT NULL,
    "verifier_ciphertext" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "native_oauth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "native_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "request" JSONB NOT NULL,
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "snapshot_ciphertext" BYTEA,
    "import_job_id" UUID,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "native_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "native_connections_tenant_id_created_at_idx" ON "native_connections"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "native_connections_tenant_id_id_key" ON "native_connections"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "native_oauth_challenges_state_hash_key" ON "native_oauth_challenges"("state_hash");

-- CreateIndex
CREATE INDEX "native_oauth_challenges_tenant_id_expires_at_idx" ON "native_oauth_challenges"("tenant_id", "expires_at");

-- CreateIndex
CREATE INDEX "native_transfers_tenant_id_connection_id_created_at_idx" ON "native_transfers"("tenant_id", "connection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "native_transfers_tenant_id_idempotency_key_key" ON "native_transfers"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "native_connections" ADD CONSTRAINT "native_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_oauth_challenges" ADD CONSTRAINT "native_oauth_challenges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_transfers" ADD CONSTRAINT "native_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_transfers" ADD CONSTRAINT "native_transfers_tenant_id_connection_id_fkey" FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "native_connections"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE native_connections ADD CONSTRAINT native_provider_check CHECK(provider IN ('ERPNEXT','GOOGLE_SHEETS','ZOHO_CRM','SHOPIFY'));
ALTER TABLE native_connections ADD CONSTRAINT native_status_check CHECK(status IN ('ACTIVE','DISCONNECTED'));
ALTER TABLE native_transfers ADD CONSTRAINT native_transfer_status_check CHECK(status IN ('PENDING','SUCCEEDED','FAILED'));
CREATE UNIQUE INDEX native_pending_transfer ON native_transfers(connection_id) WHERE status='PENDING';
ALTER TABLE native_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON native_connections USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
ALTER TABLE native_oauth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_oauth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON native_oauth_challenges USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
ALTER TABLE native_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON native_transfers USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
