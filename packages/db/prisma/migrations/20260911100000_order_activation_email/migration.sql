-- Twenty-six of the 101 variants bind the licence to an address the customer
-- supplies: their own email, or a Microsoft or Canva account. That address is
-- not always the one they ordered from, and a key issued against the wrong one
-- is a licence nobody can use plus a supplier order that cannot be reversed.
--
-- Kept separate from `email`, which is where the receipt and the account go.
ALTER TABLE "public"."Order" ADD COLUMN "activationEmail" TEXT;
