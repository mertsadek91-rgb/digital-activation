/**
 * The Office 2024 line — six standalone apps and two bundles.
 *
 * These held every remaining 99% pair after the first batch, and the reason is
 * worth stating: from the catalog's point of view they are one product. One
 * perpetual licence, one device, bound to a Microsoft account, same publisher,
 * same delivery. A generator working from those columns has nothing to tell
 * them apart, so it wrote the same page six times.
 *
 * What separates them is the only thing a buyer is actually choosing between:
 * which application arrives, and what that application is for. That is not in
 * any column, which is why it had to be written.
 */
import type { Block } from '../body.js';

export const OFFICE_2024: Record<string, Block[]> = {
  'office-2024-word-bind-mac': [
    {
      type: 'answerFirst',
      text: 'Word 2024 on its own, bought once and kept: the full desktop word processor for Windows or Mac, without the rest of Office and without a subscription. It is the right purchase when writing is the only thing you need a licence for.',
    },
    { type: 'heading', level: 2, text: 'Just Word, permanently' },
    {
      type: 'richText',
      html: '<p>The whole application, not a cut-down version: styles and templates, tracked changes and comments for documents that go back and forth, mail merge, tables of contents and captions that renumber themselves, footnotes and citations, and export to PDF without a converter.</p><p>2024 brings the newer drawing tools, better performance on long documents, and the accessibility checker that tells you what a screen reader will struggle with before you send the file.</p>',
    },
    { type: 'heading', level: 2, text: 'When one app beats the suite' },
    {
      type: 'richText',
      html: '<p>Buy the single application when the others would go unopened — a writer, a translator, a student on a dissertation, an office that lives in documents and keeps its numbers somewhere else. If you will open Excel more than occasionally, the Home and Student bundle costs less than two applications bought separately.</p>',
    },
  ],

  'office-2024-excel-bind-mac': [
    {
      type: 'answerFirst',
      text: 'Excel 2024 on its own, bought once and kept: the full desktop spreadsheet for Windows or Mac, with the modern function set — XLOOKUP, dynamic arrays, LAMBDA — and no subscription attached.',
    },
    { type: 'heading', level: 2, text: 'The functions that changed how sheets are built' },
    {
      type: 'richText',
      html: '<p><strong>Dynamic arrays</strong> are the difference between this and any Excel before 2021. One formula spills across the range it needs, so FILTER, SORT, UNIQUE and SEQUENCE replace whole columns of copied helpers. <strong>XLOOKUP</strong> retires VLOOKUP and its brittle column numbers. <strong>LAMBDA</strong> lets you name a calculation once and call it like any built-in function, which is how a complicated sheet stops being unmaintainable.</p><p>2024 adds TEXTSPLIT, TEXTBEFORE and TEXTAFTER for pulling apart imported data, and the regular-expression functions that make cleaning a messy export a formula rather than a macro.</p>',
    },
    { type: 'heading', level: 2, text: 'Perpetual, and what that costs you' },
    {
      type: 'richText',
      html: '<p>No renewal and no expiry — but also no new functions after release. A workbook somebody sends you that was built on a function added later will show a name error rather than a result. For most spreadsheets that never happens; for a team sharing files with subscription users, it is worth knowing before you choose.</p>',
    },
  ],

  'office-2024-powerpoint-bind-mac': [
    {
      type: 'answerFirst',
      text: 'PowerPoint 2024 on its own, bought once and kept: the full desktop presentation app for Windows or Mac, including Morph and Zoom, the slide recording tools and Presenter Coach — without a subscription and without the rest of the suite.',
    },
    { type: 'heading', level: 2, text: 'What makes a deck look made rather than assembled' },
    {
      type: 'richText',
      html: '<p><strong>Morph</strong> animates between two slides by matching the shapes on both, which produces movement that would take an animation timeline anywhere else. <strong>Zoom</strong> turns a deck into something you can navigate out of order — useful when the room asks a question three sections ahead.</p><p>The recording tools export a narrated presentation as a video with your camera in the corner, timings and ink preserved, which is how most internal training decks now get made. Presenter Coach listens to a rehearsal and reports on pace, filler words and reading off the slide.</p>',
    },
    { type: 'heading', level: 2, text: 'One device, one account' },
    {
      type: 'richText',
      html: '<p>This licence binds to the Microsoft account you name at checkout and installs on one machine — Windows or Mac, your choice, though not both at once. Give the account you actually sign in with: the licence stays with it rather than with the computer.</p>',
    },
  ],

  'office-2024-outlook-bind-mac': [
    {
      type: 'answerFirst',
      text: 'Outlook 2024 on its own, bought once and kept: the desktop mail, calendar and contacts client for Windows or Mac, with your mail stored locally, rules that run on the machine, and no monthly charge.',
    },
    { type: 'heading', level: 2, text: 'Why a desktop client at all' },
    {
      type: 'richText',
      html: '<p>Three reasons people come back to it from webmail. <strong>Your mail is on your disk</strong>, searchable and readable when the connection is not. <strong>Rules run locally</strong> and can do things a web interface will not — move, categorise, forward, and act across several accounts at once. And <strong>several accounts in one window</strong>: a work Exchange mailbox, a personal IMAP address and a shared mailbox side by side rather than in three browser tabs.</p><p>The calendar is the other half of the argument — scheduling assistant, meeting rooms, shared calendars and delegate access, which is what makes it the client offices standardise on.</p>',
    },
    { type: 'heading', level: 2, text: 'Check your mail provider first' },
    {
      type: 'richText',
      html: '<p>Outlook 2024 connects to Microsoft 365 and Exchange, and to ordinary IMAP and POP accounts. What it cannot do is add a mailbox your provider does not expose — a few webmail services offer no IMAP at all. If you are not on Exchange, confirm your provider supports IMAP before ordering.</p>',
    },
  ],

  'office-2024-home-and-student-bind-mac': [
    {
      type: 'answerFirst',
      text: 'Office 2024 Home and Student is the one-time purchase for home and coursework: Word, Excel, PowerPoint and OneNote installed on one Windows PC or Mac, permanently, with no subscription and no renewal date.',
    },
    { type: 'heading', level: 2, text: 'What is in it, and what is not' },
    {
      type: 'richText',
      html: '<p><strong>Word, Excel, PowerPoint and OneNote</strong> — the four applications that cover essays, budgets, presentations and notes, which is the set nearly every student and household actually opens.</p><p>What it does not include is <strong>Outlook</strong>. If you want desktop mail and calendar, the Home and Business edition is these four plus Outlook, and buying Outlook separately afterwards costs more than the difference between them. There is also no Access and no Publisher; both are Windows-only and aimed at business use.</p>',
    },
    { type: 'heading', level: 2, text: 'Bought once, and where that leaves you in five years' },
    {
      type: 'richText',
      html: '<p>Perpetual Office releases carry a five-year support life, so 2024 receives security updates into October 2029 — longer than any other perpetual edition currently sold. After that the applications still run and still open your files; the monthly patch is what stops. For a degree or a household, that horizon is far enough away to ignore.</p>',
    },
  ],

  'office-2024-home-and-business-bind-mac': [
    {
      type: 'answerFirst',
      text: 'Office 2024 Home and Business is the one-time purchase that includes Outlook: Word, Excel, PowerPoint, OneNote and Outlook on one Windows PC or Mac, permanently, and licensed for commercial use.',
    },
    { type: 'heading', level: 2, text: 'The edition that includes Outlook' },
    {
      type: 'richText',
      html: '<p>That is the whole difference from Home and Student, and for a business it is usually the deciding one. Desktop <strong>Outlook</strong> means mail stored locally, rules that run on the machine, several accounts in one window, and the calendar with scheduling assistant, shared calendars and delegate access that a webmail tab does not offer.</p><p>Word, Excel, PowerPoint and OneNote are the full applications, identical to every other 2024 edition.</p>',
    },
    { type: 'heading', level: 2, text: 'Licensed for commercial use' },
    {
      type: 'richText',
      html: '<p>Home and Student is licensed for personal and household use. This edition permits business use — a licensing distinction rather than a technical one: the software is the same, the permission is not. For a freelancer, a consultancy, or any machine that issues invoices, this is the correct licence to hold.</p>',
    },
  ],

  'office-ltsc-professional-plus-2024-mak': [
    {
      type: 'answerFirst',
      text: 'Office LTSC Professional Plus 2024 is the long-term servicing build: the complete suite — Word, Excel, PowerPoint, Outlook, Access, Publisher and OneNote — that deliberately never changes, activated with a MAK volume key.',
    },
    { type: 'heading', level: 2, text: 'Built to stay exactly as it is' },
    {
      type: 'richText',
      html: '<p>LTSC exists for machines where a changing interface is a problem rather than a benefit: a workstation running a validated process, a terminal on a factory floor, a desk whose users were trained once on one layout. It receives security fixes and nothing else — no feature updates, no moved menus, no new ribbon.</p><p>It is also the most complete perpetual suite Microsoft ships, including <strong>Access</strong> and <strong>Publisher</strong>, which the Home editions leave out.</p>',
    },
    { type: 'heading', level: 2, text: 'A MAK key, and how it activates' },
    {
      type: 'richText',
      html: '<p>This is a <strong>Multiple Activation Key</strong> from the volume licensing line rather than a retail key. It activates against Microsoft over the internet or, if that is declined, by phone — a few minutes, and the steps we send cover it.</p><p>The installation media is the Office Deployment Tool rather than a consumer installer. If you have not deployed Office that way before, the retail <a href="/en/store/office-2021-pro-plus">Office 2021 Pro Plus</a> is the simpler choice for a single machine.</p>',
    },
  ],
};
