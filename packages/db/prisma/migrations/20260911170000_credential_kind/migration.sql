-- The vault holds two different things, and until now it pretended they were
-- one.
--
-- Most lines are a single string the customer types into the product. A real
-- minority are an account: the Office 365 and Canva subscriptions, the Adobe
-- panels — for those, what the supplier hands back is a username and a
-- password. Sealing that pair as one opaque blob and hoping each reader splits
-- it the same way is how a password ends up printed under the heading
-- "activation key" in a customer's inbox.
--
-- So the shape is recorded rather than inferred: on the variant, because that
-- is where the owner chooses it, and on the sealed row itself, because the
-- vault schema holds no foreign keys into `public` and a row that cannot say
-- what it contains cannot be rendered safely.
CREATE TYPE "public"."CredentialKind" AS ENUM ('ACTIVATION_KEY', 'ACCOUNT_CREDENTIALS');

ALTER TABLE "public"."Variant"
  ADD COLUMN "credentialKind" "public"."CredentialKind" NOT NULL DEFAULT 'ACTIVATION_KEY';

ALTER TABLE "vault"."LicenseKey"
  ADD COLUMN "kind" "public"."CredentialKind" NOT NULL DEFAULT 'ACTIVATION_KEY';

-- The legacy data already knows the answer for the lines that are accounts:
-- WooCommerce recorded their activation method as ready-made credentials, and
-- the import mapped it to ACCOUNT_CREDENTIALS. A panel invitation is a person
-- adding an address to a seat list, not a pair handed over, so it stays a key.
UPDATE "public"."Variant"
  SET "credentialKind" = 'ACCOUNT_CREDENTIALS'
  WHERE "activationMethod" = 'ACCOUNT_CREDENTIALS';
