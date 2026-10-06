# Product card fonts

The product card renderer (`apps/api/src/supplier/card/card.ts`, CR-0004)
draws its text with sharp's Pango renderer from the font **files** in this
folder, so Arabic is shaped correctly whatever fonts the server image has.

| File                    | What                                         |
| ----------------------- | -------------------------------------------- |
| `Tajawal-Bold.ttf`      | Chip labels and the corner ribbon            |
| `Tajawal-ExtraBold.ttf` | The product name and a logo-less brand name  |
| `OFL.txt`               | SIL Open Font License 1.1, travels with them |

Tajawal is the storefront's typeface (Boutros International, OFL 1.1). The
files come from the Google Fonts repository, `ofl/tajawal/`, added with the
owner's approval on 2026-10-06.

The API build runs from the repository, so this folder ships with it; the
renderer resolves it from both `src/` and `dist/`. Without the files the card
still renders, with the server's default font, and the panel says so.
`CARD_FONT_DIR` and `CARD_FONT_FAMILY` override the folder and family name.
