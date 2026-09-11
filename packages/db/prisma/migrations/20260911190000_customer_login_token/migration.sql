-- Sign-in links for the customer's own licences page.
--
-- No password. Every order in this store is a guest order, the 218 customers
-- migrated from WordPress arrived without a hash, and the licence was
-- delivered to this mailbox in the first place — so control of the mailbox is
-- exactly the bar that already handed the key over, and a password would only
-- add a secret to steal without raising it.
--
-- Only the hash of the link is stored, so a read of this table cannot mint one.
-- The row survives its use: it is the record that the link was redeemed, and
-- "when did somebody last sign in as this customer" is a question a refund
-- argument turns on.
CREATE TABLE "public"."CustomerLoginToken" (
  "id"         TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tokenHash"  TEXT NOT NULL,
  "ip"         TEXT,
  "userAgent"  TEXT,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "usedAt"     TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerLoginToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerLoginToken_tokenHash_key" ON "public"."CustomerLoginToken" ("tokenHash");
CREATE INDEX "CustomerLoginToken_customerId_createdAt_idx" ON "public"."CustomerLoginToken" ("customerId", "createdAt");
-- Expiry is swept, so it is indexed.
CREATE INDEX "CustomerLoginToken_expiresAt_idx" ON "public"."CustomerLoginToken" ("expiresAt");

ALTER TABLE "public"."CustomerLoginToken"
  ADD CONSTRAINT "CustomerLoginToken_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
