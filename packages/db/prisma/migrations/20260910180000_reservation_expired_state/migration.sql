-- A lapsed stock hold and a hold the shopper released are not the same event.
-- Only the first one means "walked away", which is what the abandoned-cart
-- ladder is measuring, so it gets its own state rather than being folded into
-- RELEASED where the distinction would be lost.
ALTER TYPE "public"."StockReservationState" ADD VALUE 'EXPIRED' AFTER 'RELEASED';
