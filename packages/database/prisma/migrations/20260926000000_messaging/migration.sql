-- CreateEnum
CREATE TYPE "contact_source" AS ENUM ('INBOUND', 'MANUAL', 'IMPORT', 'API', 'CAMPAIGN', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('OPEN', 'PENDING', 'SNOOZED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "automation_state" AS ENUM ('AUTOMATION_ACTIVE', 'AGENT_TAKEOVER', 'AUTOMATION_PAUSED');

-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "message_type" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER', 'LOCATION', 'CONTACTS', 'TEMPLATE', 'INTERACTIVE', 'REACTION', 'SYSTEM_EVENT', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('RECEIVED', 'CREATED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "message_source" AS ENUM ('CUSTOMER', 'INBOX', 'CAMPAIGN', 'AUTOMATION', 'SYSTEM', 'API');

-- CreateEnum
CREATE TYPE "webhook_event_kind" AS ENUM ('MESSAGE', 'STATUS', 'TEMPLATE_STATUS', 'TEMPLATE_QUALITY', 'TEMPLATE_CATEGORY', 'PHONE_QUALITY', 'ACCOUNT_UPDATE');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('MESSAGE_MEDIA', 'IMPORT', 'EXPORT', 'AVATAR', 'TEMPLATE_SAMPLE');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('PENDING_UPLOAD', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "name" TEXT,
    "email" CITEXT,
    "language" TEXT,
    "country" CHAR(2),
    "source" "contact_source" NOT NULL,
    "status" "contact_status" NOT NULL DEFAULT 'ACTIVE',
    "wa_profile_name" TEXT,
    "last_inbound_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "phone_number_id" UUID NOT NULL,
    "status" "conversation_status" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "automation_state" "automation_state" NOT NULL DEFAULT 'AUTOMATION_ACTIVE',
    "automation_state_changed_at" TIMESTAMPTZ(3),
    "automation_state_changed_by" UUID,
    "last_message_id" UUID,
    "last_message_at" TIMESTAMPTZ(3),
    "last_message_preview" TEXT,
    "last_customer_message_at" TIMESTAMPTZ(3),
    "service_window_expires_at" TIMESTAMPTZ(3),
    "first_response_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "snoozed_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "direction" "message_direction" NOT NULL,
    "type" "message_type" NOT NULL,
    "status" "message_status" NOT NULL,
    "source" "message_source" NOT NULL,
    "content" JSONB NOT NULL,
    "file_id" UUID,
    "provider_message_id" TEXT,
    "reply_to_message_id" UUID,
    "idempotency_key" TEXT,
    "sent_by_user_id" UUID,
    "campaign_id" UUID,
    "automation_execution_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_detail" TEXT,
    "queued_at" TIMESTAMPTZ(3),
    "sending_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "provider_timestamp" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "kind" "webhook_event_kind" NOT NULL,
    "phone_number_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "webhook_event_status" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "filename" TEXT,
    "sha256" BYTEA,
    "purpose" "file_purpose" NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_created_at_idx" ON "contacts"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_last_message_at_idx" ON "conversations"("tenant_id", "status", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_assignee_id_status_idx" ON "conversations"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_contact_id_phone_number_id_key" ON "conversations"("tenant_id", "contact_id", "phone_number_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_tenant_id_received_at_idx" ON "webhook_events"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_tenant_id_dedupe_key_key" ON "webhook_events"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "files_bucket_object_key_key" ON "files"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_scope_key_key" ON "idempotency_keys"("tenant_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_phone_number_id_fkey" FOREIGN KEY ("phone_number_id") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

