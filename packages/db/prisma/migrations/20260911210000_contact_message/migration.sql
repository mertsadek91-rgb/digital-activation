-- The contact form has somewhere to land.
--
-- The row is written before the mail is sent, deliberately. A store whose only
-- inbox is an SMTP connection loses every message it fails to receive and never
-- learns that it did — and the legacy support page, which emailed everything to
-- one address and kept nothing, is exactly that store.
--
-- `topic` survives from that page's "choose the right section" field, which
-- previously changed nothing. It is the one value that lets an inbox be worked
-- in the right order: a dead activation on a paid order is not the same thing
-- as a question from somebody who has not bought anything yet.
CREATE TYPE "public"."ContactTopic" AS ENUM ('ORDER', 'ACTIVATION', 'PRESALE', 'BUSINESS', 'OTHER');
CREATE TYPE "public"."ContactStatus" AS ENUM ('NEW', 'HANDLED');

CREATE TABLE "public"."ContactMessage" (
  "id"          TEXT NOT NULL,
  "topic"       "public"."ContactTopic" NOT NULL DEFAULT 'OTHER',
  "status"      "public"."ContactStatus" NOT NULL DEFAULT 'NEW',
  "name"        TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "phone"       TEXT,
  "orderNumber" TEXT,
  "message"     TEXT NOT NULL,
  "locale"      "public"."Locale" NOT NULL DEFAULT 'AR',
  "customerId"  TEXT,
  "handledAt"   TIMESTAMP(3),
  "handledById" TEXT,
  "ip"          TEXT,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- The two ways an inbox is read: oldest unhandled first, and everything from
-- one address when somebody writes twice.
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "public"."ContactMessage" ("status", "createdAt");
CREATE INDEX "ContactMessage_email_createdAt_idx" ON "public"."ContactMessage" ("email", "createdAt");

-- Both links are SET NULL rather than CASCADE: a message is evidence of what a
-- customer asked and when, and deleting the customer must not delete the record
-- that they wrote in.
ALTER TABLE "public"."ContactMessage"
  ADD CONSTRAINT "ContactMessage_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."ContactMessage"
  ADD CONSTRAINT "ContactMessage_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "public"."StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
