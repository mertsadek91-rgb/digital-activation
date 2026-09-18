/**
 * English product copy, written per product rather than assembled.
 *
 * `body.ts` builds a description from columns, and that was the right thing to
 * do when 73 of 73 English translations had no body at all — a generated page
 * that states true facts beats a page the gate refuses to publish. But the
 * audit compared the results against each other: 1,837 of 2,556 English pairs
 * share 60% or more of their five-word runs, eleven of them at 99%. One page,
 * seventy-two times, with the name swapped.
 *
 * So this file exists, and the shape of it is the fix.
 *
 *   Prose is unique or it is not here. Every sentence below says something
 *   true of this product and false of its neighbour — what the edition
 *   actually includes, what it does not, who it suits, and when its support
 *   window closes. Two products that genuinely share a sentence share it
 *   through the spec table instead.
 *
 *   Shared facts go in `specTable`, not in paragraphs. Delivery, activation
 *   method, device count and term are the same sentence for half the catalog
 *   however they are phrased, and prose is where that duplication becomes
 *   invisible. A table is structured, is quoted by answer engines, and cannot
 *   quietly become boilerplate — it is already admitting it is a form.
 *
 *   Facts come from the database, claims come from the publisher. Terms,
 *   device counts, platforms and delivery windows are read out of the catalog
 *   at apply time, never typed here, so this file cannot drift from what the
 *   order will honour. What each product *is* comes from what the publisher
 *   documents about it.
 *
 * End-of-support dates are stated plainly on the products that have passed
 * them. Windows 10 and Office 2016/2019 stopped receiving security updates on
 * 14 October 2025, and a shop selling those licences to somebody who does not
 * know that is selling them a surprise. The licence is still a licence and the
 * software still runs — which is the sentence that belongs on the page, rather
 * than silence.
 */
import type { Block } from '../body.js';

import { ANTIVIRUS } from './antivirus.js';
import { DEV_AND_TOOLS } from './dev-and-tools.js';
import { OFFICE_2024 } from './office-2024.js';
import { PDF_AND_DESIGN } from './pdf-and-design.js';
import { SECURITY_AND_ACCOUNTS } from './security-and-accounts.js';
import { WINDOWS_SERVER } from './windows-server.js';

export const EN_WRITTEN: Record<string, Block[]> = {
  ...ANTIVIRUS,
  ...DEV_AND_TOOLS,
  ...OFFICE_2024,
  ...PDF_AND_DESIGN,
  ...SECURITY_AND_ACCOUNTS,
  ...WINDOWS_SERVER,

  // --- Windows ---------------------------------------------------------------

  'windows-11-pro': [
    {
      type: 'answerFirst',
      text: 'Windows 11 Pro is the edition for people who need the machine to do more than run applications: full-disk BitLocker encryption, Hyper-V virtual machines, Remote Desktop as the host you connect to, Group Policy, Windows Sandbox, and the ability to join a company domain or Microsoft Entra ID. Home has none of those.',
    },
    { type: 'heading', level: 2, text: 'What Pro adds over Home' },
    {
      type: 'richText',
      html: '<p>Four of the differences change how a machine can be used rather than how it looks. <strong>BitLocker</strong> encrypts the whole drive, so a stolen laptop is a lost laptop and not a lost client list. <strong>Hyper-V</strong> runs virtual machines natively, which is how most developers keep a test environment off their working system. <strong>Remote Desktop</strong> is the half people get wrong: every edition can connect <em>out</em>, only Pro can be connected <em>to</em>. And <strong>Group Policy</strong> plus domain join are what let a machine be managed as part of a company rather than configured by hand.</p><p>Windows Sandbox is the quiet favourite — a disposable clean Windows in a window, thrown away when you close it, which is the safest way to open something you are not sure about.</p>',
    },
    { type: 'heading', level: 2, text: 'Before you buy: the hardware check' },
    {
      type: 'richText',
      html: "<p>Windows 11 refuses to install on hardware it does not approve of, and this is the single most common reason a licence sits unused. It requires <strong>TPM 2.0</strong>, <strong>Secure Boot</strong>, a 64-bit processor on Microsoft's supported list, 4 GB of RAM and 64 GB of storage. Most machines built from 2018 onward qualify; many from 2016 and 2017 have a TPM that is switched off in firmware rather than absent, which is a setting and not a purchase.</p><p>Run <em>PC Health Check</em> before ordering. If the machine fails, Windows 10 Pro is the same feature set on hardware that will accept it.</p>",
    },
  ],

  'windows-10-pro': [
    {
      type: 'answerFirst',
      text: 'Windows 10 Pro carries the same professional feature set as Windows 11 Pro — BitLocker, Hyper-V, Remote Desktop hosting, Group Policy, domain join — on hardware that Windows 11 will not accept. Its free security updates ended on 14 October 2025, which is the fact that should decide whether it is right for you.',
    },
    { type: 'heading', level: 2, text: 'Support ended in October 2025. What that means' },
    {
      type: 'richText',
      html: '<p>Microsoft stopped issuing free security updates for every edition of Windows 10 on <strong>14 October 2025</strong>. Nothing switched off: the system boots, activates, and runs every application it ran the day before, and this licence activates it permanently. What stopped is the monthly patch for newly discovered vulnerabilities.</p><p>That is a real risk on a machine that browses the web or holds customer data, and close to none on a machine that runs one offline application on an isolated network — which is exactly why plenty of workshop and point-of-sale systems are still on it. Microsoft sells Extended Security Updates for organisations that need more time.</p>',
    },
    { type: 'heading', level: 2, text: 'Why people still choose it' },
    {
      type: 'richText',
      html: '<p>Almost always hardware. A 2015 workstation with no TPM 2.0 cannot run Windows 11 at all, and replacing it to chase an operating system is the more expensive answer. The rest is software: industrial control, laboratory instruments and older accounting suites are certified against Windows 10 and not against 11, and a certification is not something a user can override.</p><p>If your machine passes <em>PC Health Check</em>, buy Windows 11 Pro instead — same features, and it is still receiving updates.</p>',
    },
  ],

  'windows-11-home': [
    {
      type: 'answerFirst',
      text: 'Windows 11 Home is the full Windows 11 for a personal machine: Snap Layouts, virtual desktops, the Microsoft Store, Windows Hello sign-in and Defender. It leaves out the four things built for managed and business use — BitLocker, Hyper-V, Remote Desktop hosting and Group Policy.',
    },
    { type: 'heading', level: 2, text: 'What you get, and the four things you do not' },
    {
      type: 'richText',
      html: '<p>Everything most people touch daily is here and identical to Pro: the redesigned taskbar and Start, Snap Layouts for arranging windows, multiple desktops, Microsoft Defender, Windows Hello face and fingerprint sign-in, and the Store.</p><p>What Home leaves out is a short and specific list. There is no <strong>BitLocker</strong> full-drive encryption (Home offers device encryption on some hardware, which is not the same control). No <strong>Hyper-V</strong>, so no virtual machines without third-party software. No <strong>Remote Desktop host</strong> — you can connect out from Home, but nothing can connect in. No <strong>Group Policy</strong>, no domain join, no Windows Sandbox.</p><p>If none of those four sentences describes something you need, Home is the edition you want and Pro is money spent on features that will sit idle.</p>',
    },
    { type: 'heading', level: 2, text: 'Two things to know before setup' },
    {
      type: 'richText',
      html: '<p>Windows 11 Home requires an <strong>internet connection and a Microsoft account</strong> to complete first-time setup; Pro still allows a local account. And the same hardware rules apply to both: TPM 2.0, Secure Boot, and a supported 64-bit processor. Check with <em>PC Health Check</em> before ordering.</p>',
    },
  ],

  'windows-10-home': [
    {
      type: 'answerFirst',
      text: "Windows 10 Home is the personal edition of Windows 10, for a machine that cannot meet Windows 11's TPM 2.0 and Secure Boot requirements. Free security updates ended on 14 October 2025; the system still runs and this licence still activates it permanently.",
    },
    { type: 'heading', level: 2, text: 'A licence for hardware Windows 11 rejects' },
    {
      type: 'richText',
      html: '<p>This is the edition for a working laptop or desktop that Windows 11 will not install on — no TPM 2.0, an unsupported processor, or a machine whose manufacturer never shipped the firmware update. The Start menu, taskbar and Settings are the layout most people have used for a decade, which on a shared or family machine is a feature rather than a compromise.</p>',
    },
    { type: 'heading', level: 2, text: 'Updates stopped in October 2025' },
    {
      type: 'richText',
      html: '<p>Microsoft issued the last free security update for Windows 10 on <strong>14 October 2025</strong>. The system did not change that day and does not stop working — but newly discovered vulnerabilities are no longer patched for free.</p><p>Weigh that against use. A machine that reads email and banks online carries real exposure; one that drives a sewing machine, a till, or a camera on a network with no internet carries almost none. Keep a current browser and third-party antivirus, both of which continue to update on their own schedules.</p>',
    },
  ],

  // --- Office, perpetual -----------------------------------------------------

  'office-2021-pro-plus': [
    {
      type: 'answerFirst',
      text: 'Office 2021 Professional Plus is a one-time purchase that does not expire: Word, Excel, PowerPoint, Outlook, Access, Publisher and OneNote installed locally on one Windows PC. It is the newest perpetual Office edition still in support — Microsoft patches it until 13 October 2026.',
    },
    { type: 'heading', level: 2, text: 'Bought once, not rented' },
    {
      type: 'richText',
      html: '<p>The whole argument for this edition is that it has no renewal date. Buy it, install it, and it keeps working on that PC — no monthly charge, no account that can lapse, no documents locked behind a subscription that stopped renewing. For anyone who writes documents and spreadsheets and has no use for cloud storage or shared editing, that is usually the cheaper answer over three years.</p><p>What it does not do is change. Office 2021 receives security fixes, not new features: the version you install in 2026 is the version released in 2021.</p>',
    },
    { type: 'heading', level: 2, text: 'What 2021 added over 2019' },
    {
      type: 'richText',
      html: '<p>Excel gained the functions that make older formulas unnecessary — <strong>XLOOKUP</strong> in place of VLOOKUP, and dynamic arrays with <strong>LET</strong> and <strong>XMATCH</strong>, where one formula fills the range it needs instead of being copied down a column. Excel also added <em>Sheet View</em>, so two people sorting the same shared sheet stop moving rows under each other.</p><p>Across the suite: dark mode that actually darkens the page, a faster search box, improved inking, and the Draw tab available everywhere. PowerPoint gained the Record Slide Show tools with presenter video and ink.</p>',
    },
    { type: 'heading', level: 2, text: 'Its support window closes in October 2026' },
    {
      type: 'richText',
      html: "<p>Perpetual Office editions carry a five-year support life, and 2021's ends on <strong>13 October 2026</strong>. After that the applications keep running and keep opening your files; what stops is the monthly security patch. Worth knowing before you choose between this and a subscription, and worth saying out loud rather than leaving you to find out.</p>",
    },
  ],

  'office-2019-pro-plus': [
    {
      type: 'answerFirst',
      text: 'Office 2019 Professional Plus is a permanent one-PC licence for Word, Excel, PowerPoint, Outlook, Access and Publisher. Microsoft ended its support on 14 October 2025, so it no longer receives security updates — the applications themselves continue to run and open every file they always did.',
    },
    { type: 'heading', level: 2, text: 'Support ended in October 2025' },
    {
      type: 'richText',
      html: '<p>Office 2019 reached the end of its lifecycle on <strong>14 October 2025</strong> and no longer receives monthly security fixes. That matters most in Outlook and in any workflow where documents arrive from outside the business, because an Office document is a common way for something unwanted to arrive.</p><p>If email lives on this machine, <a href="/en/store/office-2021-pro-plus">Office 2021 Pro Plus</a> is the same kind of licence — bought once, no renewal — and is patched until October 2026.</p>',
    },
    { type: 'heading', level: 2, text: 'What it still does well' },
    {
      type: 'richText',
      html: '<p>2019 was the edition that brought the modern chart types to the perpetual line: funnel charts, 2D maps, and the scalable vector graphics support that makes diagrams stay sharp when a slide is projected. PowerPoint gained Morph and Zoom, which remain the two transitions worth using. Excel added IFS, TEXTJOIN, CONCAT and MAXIFS.</p><p>It does not have XLOOKUP or dynamic arrays — those arrived with 2021. If you have inherited spreadsheets that use them, they will not calculate here.</p>',
    },
  ],

  'office-2016-pro-plus': [
    {
      type: 'answerFirst',
      text: 'Office 2016 Professional Plus is a permanent licence for the 2016 release of Word, Excel, PowerPoint, Outlook, Access and Publisher on one Windows PC. Microsoft ended its support on 14 October 2025. It is bought today almost entirely to match software that will not run on anything newer.',
    },
    { type: 'heading', level: 2, text: 'Who still buys 2016 on purpose' },
    {
      type: 'richText',
      html: '<p>Compatibility, in nearly every case. Older Access databases and Excel workbooks built around a specific add-in or VBA reference can break on a newer release, and a business with a working macro-driven workbook is choosing the version that runs it rather than the version that is current. Some accounting and ERP packages certify their Office integration against 2016 and nothing later.</p><p>It also runs on older and lighter hardware than 2021 expects, which keeps a serviceable machine in use.</p>',
    },
    { type: 'heading', level: 2, text: 'Support ended — buy it deliberately' },
    {
      type: 'richText',
      html: '<p>Security updates for Office 2016 stopped on <strong>14 October 2025</strong>. The applications run and your files open; nothing new is patched. If you are choosing an Office version for general work rather than to match a specific dependency, <a href="/en/store/office-2021-pro-plus">Office 2021 Pro Plus</a> is the current perpetual edition and costs about the same.</p>',
    },
  ],

  'office-365-pro-plus': [
    {
      type: 'answerFirst',
      text: 'Office 365 Pro Plus is the subscription line rather than the one-time purchase: a ready account that installs the full desktop Office suite on up to five devices and keeps receiving new features and security updates for as long as the term runs.',
    },
    { type: 'heading', level: 2, text: 'An account, not a key' },
    {
      type: 'richText',
      html: '<p>This is the difference that matters at delivery. A perpetual Office licence is a key you type into an installation. This is a <strong>set of account credentials</strong>: you sign in to Office with them, and the subscription attached to the account is what licenses the applications.</p><p>Signing in on a sixth device signs the oldest one out rather than refusing — the five-device limit is a rotation, not a wall, which is what makes it workable across a desk, a laptop and a phone.</p>',
    },
    { type: 'heading', level: 2, text: 'Always current, for as long as the term runs' },
    {
      type: 'richText',
      html: '<p>Unlike the perpetual editions, this line keeps changing: features arrive through the year and the version number moves with them, so there is no support cut-off date to plan around. The trade is the opposite of Office 2021 — nothing expires there and nothing improves; here the reverse.</p><p>Choose it if you work across several machines, want Outlook on a phone as well as a PC, or would rather not think about which Office version opens a file somebody sent you.</p>',
    },
  ],

  // --- Adobe -----------------------------------------------------------------

  'adobe-acrobat-pro-dc': [
    {
      type: 'answerFirst',
      text: 'Adobe Acrobat Pro is the full PDF tool rather than a reader: edit text and images inside an existing PDF, run OCR over a scan to make it searchable, redact information so it is genuinely removed, compare two versions, and collect legally recognised electronic signatures.',
    },
    { type: 'heading', level: 2, text: 'What it does that a PDF reader cannot' },
    {
      type: 'richText',
      html: '<p>Four jobs justify it on their own. <strong>Editing</strong> — change a price, a date or a paragraph inside a finished PDF with no original file to go back to. <strong>OCR</strong> — turn a scanned contract into text you can search, select and copy. <strong>Redaction</strong> — remove information rather than draw a black box over it, which is the distinction behind most accidental disclosures. <strong>Compare</strong> — put two revisions side by side and have the differences listed instead of hunted.</p><p>Then the everyday ones: combining files into one document, splitting and reordering pages, exporting to Word or Excel with the layout intact, filling and creating forms, protecting a file with a password, and sending a document for signature with a tracked audit trail.</p>',
    },
    { type: 'heading', level: 2, text: 'How the licence reaches you' },
    {
      type: 'richText',
      html: '<p>This is supplied as a <strong>redeem code</strong> tied to an Adobe account, which is why checkout asks for the email address you want it on. Give the address you already use with Adobe, or the one you intend to — the licence lives on that account and travels with it, so the code cannot simply be moved to another person later.</p><p>Once redeemed, it covers Acrobat on desktop, on the web and on the mobile apps, and your files stay in step across them.</p>',
    },
  ],

  'adobe-creative-cloud': [
    {
      type: 'answerFirst',
      text: "Creative Cloud All Apps is Adobe's complete set in one subscription — Photoshop, Illustrator, InDesign, Premiere Pro, After Effects, Lightroom, Audition, Animate and the rest — installed on desktop and available on tablet, with fonts and cloud storage included.",
    },
    { type: 'heading', level: 2, text: 'The whole set, not a bundle to assemble' },
    {
      type: 'richText',
      html: '<p>The applications most subscriptions are bought for: <strong>Photoshop</strong> for images, <strong>Illustrator</strong> for vector and logo work, <strong>InDesign</strong> for anything paginated, <strong>Premiere Pro</strong> and <strong>After Effects</strong> for video and motion, <strong>Lightroom</strong> and <strong>Lightroom Classic</strong> for photography at volume, <strong>Audition</strong> for audio, <strong>Animate</strong> and <strong>Dreamweaver</strong> for interactive and web work.</p><p>What makes it a set rather than a pile is what runs between them: Adobe Fonts activates a library of typefaces in every application at once, Creative Cloud Libraries carry colours, logos and components from one app to the next, and a Photoshop file placed in InDesign stays linked to the original.</p>',
    },
    { type: 'heading', level: 2, text: 'Choosing a term' },
    {
      type: 'richText',
      html: '<p>Terms here run from one month to a year. A month suits a single delivery — a brand identity, one video, a catalogue — where paying for a year would be paying for eleven months of nothing. A year is the choice for continuous work, and the per-month cost falls accordingly.</p><p>Like Acrobat, this arrives as a <strong>redeem code against an Adobe account</strong>, so checkout asks which email address it belongs on. Your files, settings and fonts follow that account to any machine you sign in on.</p>',
    },
  ],
};
