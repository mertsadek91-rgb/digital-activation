/**
 * Nitro PDF and the CorelDRAW suites.
 *
 * Nine products, two clusters, and in both the catalog row hides the choice.
 *
 * The four Nitro products are the same application twice over, split by
 * version and by how the key activates — and "Manual" versus "Activate
 * Online" is a real difference at the moment of use, not a warehouse label.
 * The five CorelDRAW products differ by year, by platform, and by whether they
 * are the Graphics Suite or the Technical Suite, which are aimed at completely
 * different work.
 */
import type { Block } from '../body.js';

export const PDF_AND_DESIGN: Record<string, Block[]> = {
  // --- Nitro -----------------------------------------------------------------

  'nitro-pdf-pro-14-activate-online': [
    {
      type: 'answerFirst',
      text: 'Nitro PDF Pro 14 is a full PDF editor for Windows bought once rather than rented: edit text and images in a finished PDF, OCR a scan into searchable text, combine and split documents, fill and build forms, and sign electronically.',
    },
    { type: 'heading', level: 2, text: 'The case for Nitro over a subscription' },
    {
      type: 'richText',
      html: '<p>It does the work most people open Acrobat for — editing, OCR, conversion to and from Word and Excel, redaction, page assembly, form filling and signatures — as a <strong>one-time purchase</strong>. For an office that needs PDF editing on a few machines and has no interest in a per-seat monthly bill, that is the whole argument.</p><p>The interface is a Microsoft Office ribbon rather than Acrobat’s panels, which usually means less explaining on a Windows desk.</p>',
    },
    { type: 'heading', level: 2, text: 'This is the online-activation version' },
    {
      type: 'richText',
      html: '<p>The key activates over the internet — enter it and the application verifies itself with Nitro directly, taking seconds. That is the right choice for an ordinary connected machine.</p><p>If the machine is offline or behind a network that blocks the check, the <a href="/en/store/nitro-pdf-pro-14-manual">manual activation edition</a> exists for exactly that and costs less. The software is identical; only the activation path differs.</p>',
    },
  ],

  'nitro-pdf-pro-14-manual': [
    {
      type: 'answerFirst',
      text: 'Nitro PDF Pro 14 with manual activation: the same PDF editor as the online edition, licensed through an offline activation exchange instead of an internet check — for machines that cannot reach the licensing server.',
    },
    { type: 'heading', level: 2, text: 'What "manual activation" means in practice' },
    {
      type: 'richText',
      html: '<p>The application produces a request code; that code is exchanged for an activation response, which you enter to license the copy. A few extra minutes, once, and no outbound connection required at the moment of activation.</p><p>It is the correct edition for an air-gapped workstation, a machine on a network that blocks licensing traffic, or a locked-down corporate environment where outbound checks are refused. On an ordinary connected PC the <a href="/en/store/nitro-pdf-pro-14-activate-online">online edition</a> is simpler.</p>',
    },
    { type: 'heading', level: 2, text: 'The software is the full Nitro PDF Pro 14' },
    {
      type: 'richText',
      html: '<p>Text and image editing inside existing PDFs, OCR that turns a scan into searchable and selectable text, conversion to and from Word, Excel and PowerPoint, combining and splitting, redaction, form creation and filling, password protection, and electronic signatures. Nothing is withheld from this edition.</p>',
    },
  ],

  'nitro-pdf-pro-13-activate-online': [
    {
      type: 'answerFirst',
      text: 'Nitro PDF Pro 13 with online activation: the previous major release of the Windows PDF editor, bought once, activated over the internet in seconds. Chosen mainly to match an existing deployment.',
    },
    { type: 'heading', level: 2, text: 'Why buy 13 rather than 14' },
    {
      type: 'richText',
      html: '<p>Consistency, almost always. An office already running Nitro 13 on a dozen machines has one set of instructions, one interface its staff know, and often one integration configured against it — adding a thirteenth machine at the same version is the cheaper decision even when a newer one exists.</p><p>The other reason is hardware: 13 runs comfortably on older Windows machines that 14 asks more of.</p>',
    },
    { type: 'heading', level: 2, text: 'What it does' },
    {
      type: 'richText',
      html: '<p>Full PDF editing — text and images inside a finished document — plus OCR for scans, conversion to and from Office formats, combining and splitting, redaction, forms and electronic signatures. For a new deployment with no existing estate to match, <a href="/en/store/nitro-pdf-pro-14-activate-online">Nitro PDF Pro 14</a> is the current release.</p>',
    },
  ],

  'nitro-pdf-pro-13-12-11-10-9': [
    {
      type: 'answerFirst',
      text: 'A Nitro PDF Pro licence for the older releases — versions 9 through 13 — activated manually rather than over the internet. It exists for estates standardised on a specific older version and for machines that cannot reach a licensing server.',
    },
    { type: 'heading', level: 2, text: 'A licence for a version you already run' },
    {
      type: 'richText',
      html: '<p>Nobody chooses Nitro 9 for a new machine. This is bought when an office is standardised on an older release — because a document workflow was built against it, because staff were trained on that interface, or because the machines themselves are old enough that a current version would not run well.</p><p>Covering versions 9 to 13 in one licence means a mixed estate does not need a different purchase per machine.</p>',
    },
    { type: 'heading', level: 2, text: 'Manual activation, and what to expect' },
    {
      type: 'richText',
      html: '<p>Activation is an offline exchange: the application produces a request code, and the response you enter licenses it. No outbound connection is needed at that moment, which is why this edition suits isolated and locked-down machines.</p><p>Older releases receive no updates from Nitro. On a machine that opens documents from outside the business, <a href="/en/store/nitro-pdf-pro-14-activate-online">version 14</a> is the safer licence.</p>',
    },
  ],

  // --- CorelDRAW -------------------------------------------------------------

  'coreldraw-graphics-suite-2025-for-mac': [
    {
      type: 'answerFirst',
      text: 'CorelDRAW Graphics Suite 2025 for Mac is a perpetual licence for the vector design suite: CorelDRAW for illustration and layout, Corel PHOTO-PAINT for images, Font Manager and Corel CAPTURE — bought once, with no subscription.',
    },
    { type: 'heading', level: 2, text: 'Vector design without a monthly bill' },
    {
      type: 'richText',
      html: '<p>CorelDRAW is the tool for work that ends up cut, printed or engraved — signage, vehicle wraps, garment prints, packaging, laser and vinyl cutting. Its strength against Illustrator has always been the same two things: a <strong>multi-page document</strong> model that suits a catalogue or a set of signs, and export that print and cutting shops accept without argument.</p><p><strong>PHOTO-PAINT</strong> handles the raster half in the same suite, so an image can be edited without leaving for another application.</p>',
    },
    { type: 'heading', level: 2, text: 'Perpetual, and what 2025 adds' },
    {
      type: 'richText',
      html: '<p>A perpetual licence keeps working with no renewal — the reason most small studios choose Corel over a subscription. 2025 continues the same line with performance work on large files and refinements to the export and asset tools.</p><p>If budget matters more than being current, <a href="/en/store/coreldraw-graphics-suite-2024-for-mac">the 2024 suite</a> is the same applications a year older and costs less; files move between them without trouble.</p>',
    },
  ],

  'coreldraw-graphics-suite-2024-for-mac': [
    {
      type: 'answerFirst',
      text: 'CorelDRAW Graphics Suite 2024 for Mac is the previous year’s perpetual release of the vector design suite — CorelDRAW, PHOTO-PAINT, Font Manager and CAPTURE — at a lower price than the current one, with the same no-renewal licence.',
    },
    { type: 'heading', level: 2, text: 'A year behind, and usually indistinguishable' },
    {
      type: 'richText',
      html: '<p>The gap between consecutive CorelDRAW releases is refinement rather than reinvention: performance, a few tools, file-format updates. For illustration, signage, garment and packaging work, 2024 does what 2025 does.</p><p>Where it matters is exchange. If a print shop or a client sends you 2025 files, opening them here can mean a version prompt. Working alone or sending files out rather than receiving them, that never arises.</p>',
    },
    { type: 'heading', level: 2, text: 'What is in the suite' },
    {
      type: 'richText',
      html: '<p><strong>CorelDRAW</strong> for vector illustration, layout and multi-page documents. <strong>Corel PHOTO-PAINT</strong> for raster editing and retouching. <strong>Font Manager</strong> for organising and activating typefaces without installing every one. <strong>Corel CAPTURE</strong> for screen capture. Bought once, kept indefinitely.</p>',
    },
  ],

  'corelddraw-graphics-suit-2026': [
    {
      type: 'answerFirst',
      text: 'CorelDRAW Graphics Suite 2026 is the current perpetual release of the vector design suite for Mac: CorelDRAW, Corel PHOTO-PAINT, Font Manager and CAPTURE, bought once with no subscription and no renewal date.',
    },
    { type: 'heading', level: 2, text: 'The current release' },
    {
      type: 'richText',
      html: '<p>This is the newest suite, which matters in one specific way: it opens files from every earlier version, and earlier versions do not reliably open its files. If you exchange artwork with clients or print shops, being on the current release is the position that never blocks a job.</p><p>The applications are the ones CorelDRAW has always been bought for — vector illustration and layout aimed at work that gets printed, cut, engraved or embroidered, with raster editing in the same suite rather than in a second subscription.</p>',
    },
    { type: 'heading', level: 2, text: 'Perpetual, against the alternative' },
    {
      type: 'richText',
      html: '<p>The competing suite is rented monthly and stops when payment does. This is bought once and keeps running, which over three years is the cheaper arrangement for a studio whose tools do not need to change every quarter. For a lower price on an older release, <a href="/en/store/coreldraw-graphics-suite-2025-for-mac">the 2025 suite</a> is the same applications a year back.</p>',
    },
  ],

  'coreldraw-technical-suite-2025-for-windows': [
    {
      type: 'answerFirst',
      text: 'CorelDRAW Technical Suite 2025 is the technical-illustration edition, not the graphics one: authoring for manuals, parts catalogues and assembly instructions, with 3D CAD import, isometric drawing and callouts that stay attached to the parts they label.',
    },
    { type: 'heading', level: 2, text: 'A different job from the Graphics Suite' },
    {
      type: 'richText',
      html: '<p>This is the suite for documentation rather than design. <strong>Corel DESIGNER</strong> imports 3D CAD assemblies and turns them into 2D technical views — exploded diagrams, section views, assembly steps — while keeping the geometry accurate rather than merely drawn.</p><p>The tooling follows from that. <strong>Dynamic callouts</strong> stay connected to the component they point at when the drawing changes. <strong>Projected drawing</strong> modes keep isometric and axonometric views true. Output includes the formats technical publishing expects, including WebCGM and SVG for interactive parts catalogues.</p>',
    },
    { type: 'heading', level: 2, text: 'Who buys it' },
    {
      type: 'richText',
      html: '<p>Manufacturers producing service manuals, engineering firms drawing parts catalogues, technical authors documenting assembly and maintenance. If the work is a logo, a sign or a garment print, <a href="/en/store/coreldraw-graphics-suite-2025-for-mac">the Graphics Suite</a> is the correct product and costs less.</p><p>For a lower price on a release a year older, <a href="/en/store/coreldraw-technical-suite-2024-for-windows">the 2024 Technical Suite</a> covers the same ground.</p>',
    },
  ],

  'coreldraw-technical-suite-2024-for-windows': [
    {
      type: 'answerFirst',
      text: 'CorelDRAW Technical Suite 2024 is the previous perpetual release of the technical-illustration suite for Windows: Corel DESIGNER with 3D CAD import, isometric projection and dynamic callouts, for manuals, parts catalogues and assembly documentation.',
    },
    { type: 'heading', level: 2, text: 'Technical illustration, one release back' },
    {
      type: 'richText',
      html: '<p>The same discipline as the current suite: importing CAD geometry and producing accurate 2D technical views from it — exploded assemblies, section drawings, numbered step sequences — rather than drawing them by eye.</p><p><strong>Corel DESIGNER</strong> is the application that distinguishes this from any general design tool, and it is complete here. Callouts stay bound to their components through revisions; projection modes keep isometric views geometrically true; output covers the technical publishing formats including WebCGM.</p>',
    },
    { type: 'heading', level: 2, text: 'When the older release is the right buy' },
    {
      type: 'richText',
      html: '<p>Technical documentation changes slowly, and a manual authored in 2024 does not benefit from a newer file format. Unless you are receiving source files from someone on the current release, this does the same work for less. If you are, <a href="/en/store/coreldraw-technical-suite-2025-for-windows">the 2025 suite</a> avoids the version prompt.</p>',
    },
  ],
};
