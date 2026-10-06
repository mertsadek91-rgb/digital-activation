# Product card fonts

The product card renderer (`apps/api/src/supplier/card/card.ts`, CR-0004)
draws its text with sharp's Pango renderer from a font **file** in this
folder, so Arabic is shaped correctly whatever fonts the server image has.

Expected files (the storefront's typeface, SIL Open Font License 1.1):

- `Tajawal-Bold.ttf`
- `Tajawal-ExtraBold.ttf`
- `OFL.txt` (the licence, which travels with the font)

Source: the Google Fonts repository, `ofl/tajawal/`.

Without them the card still renders, with the server's default font, and
the panel says so. `CARD_FONT_DIR` and `CARD_FONT_FAMILY` override the folder
and family name.
