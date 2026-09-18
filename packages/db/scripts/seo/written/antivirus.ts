/**
 * The antivirus shelf — Norton, McAfee, CCleaner and the ESET panel line.
 *
 * Nine products the generator could not tell apart, because from the catalog's
 * side they are one row: a one-year key for a Windows machine, delivered by
 * email. The differences a buyer cares about are all inside the software —
 * what each suite actually watches, and which of them include the extras
 * (VPN, password manager, cloud backup, file recovery) that account for most
 * of the price gap between them.
 *
 * Device counts are deliberately absent from the prose here. They differ from
 * the publishers' own retail packaging on several of these lines, and the spec
 * table reads them from the variant on every page load — so the page cannot
 * promise a number the order will not honour.
 */
import type { Block } from '../body.js';

export const ANTIVIRUS: Record<string, Block[]> = {
  'norton-360-deluxe': [
    {
      type: 'answerFirst',
      text: 'Norton 360 Deluxe is the mid-tier of the 360 line: antivirus and ransomware protection plus the extras that make it a suite rather than a scanner — Secure VPN, a password manager, cloud backup for Windows, dark web monitoring and parental controls.',
    },
    { type: 'heading', level: 2, text: 'What is bundled, and what each part is for' },
    {
      type: 'richText',
      html: '<p><strong>Secure VPN</strong> is the piece most people are really buying — no separate subscription, no data cap, and it covers the case that antivirus cannot: a hotel or airport network where the connection itself is the risk. <strong>Password Manager</strong> generates and syncs credentials across the devices on the licence. <strong>Cloud Backup</strong> copies chosen folders off the machine, which is the only defence against ransomware that works after the encryption has already happened.</p><p><strong>Dark Web Monitoring</strong> watches for your email address appearing in a breach dump and tells you which service leaked it. <strong>Parental controls</strong> cover screen time and site filtering per child.</p>',
    },
    { type: 'heading', level: 2, text: 'Deluxe or Premium' },
    {
      type: 'richText',
      html: '<p>The engine is identical. <a href="/en/store/norton-360-premium">Premium</a> raises the cloud backup allowance and the device coverage; Deluxe is the edition that fits a household rather than an extended family, and the one most people should buy.</p>',
    },
  ],

  'norton-360-premium': [
    {
      type: 'answerFirst',
      text: 'Norton 360 Premium is the top of the 360 line: the same protection engine as Deluxe with a larger cloud backup allowance and broader device coverage, plus VPN, password manager, dark web monitoring and parental controls.',
    },
    { type: 'heading', level: 2, text: 'What the step up actually buys' },
    {
      type: 'richText',
      html: '<p>Not detection — that is the same engine across the whole 360 range, and a threat blocked on Premium is blocked on Deluxe. What Premium raises is capacity: more <strong>cloud backup</strong> storage and more devices under one subscription.</p><p>Cloud backup is the part worth weighing, because it is the one feature here that helps <em>after</em> something has gone wrong. Ransomware that encrypts a documents folder is undone by a copy that was never on the machine, and by nothing else on the list.</p>',
    },
    { type: 'heading', level: 2, text: 'Everything else in the suite' },
    {
      type: 'richText',
      html: '<p>Secure VPN with no data cap, Password Manager synced across devices, dark web monitoring for your addresses, a firewall on top of Windows’ own, and SafeCam, which blocks an application from switching the webcam on without being asked. If the backup allowance is not what you need, <a href="/en/store/norton-360-deluxe">Deluxe</a> is the same protection for less.</p>',
    },
  ],

  'norton-360-deluxe-panel': [
    {
      type: 'answerFirst',
      text: 'Norton 360 Deluxe supplied as ready account credentials rather than a key: you sign in to an account that already carries the subscription, and install from there. The protection is identical to the retail edition — the difference is entirely in how it is delivered.',
    },
    { type: 'heading', level: 2, text: 'Credentials instead of a key' },
    {
      type: 'richText',
      html: '<p>A retail licence is a code you type into your own Norton account. This is the account itself, already subscribed: sign in at Norton, download the installer, and the devices you add appear on that account.</p><p>The practical difference is setup time and the fact that there is nothing to redeem — useful for someone setting up several machines, or for anyone who would rather not create an account first. The practical cost is that the subscription lives on the supplied account rather than on one you own, so change the password immediately and treat those credentials as the licence itself.</p>',
    },
    { type: 'heading', level: 2, text: 'The protection is Deluxe' },
    {
      type: 'richText',
      html: '<p>Everything in <a href="/en/store/norton-360-deluxe">Norton 360 Deluxe</a>: the antivirus and ransomware engine, Secure VPN without a data cap, Password Manager, cloud backup, dark web monitoring, SafeCam and parental controls.</p>',
    },
  ],

  'norton-360-premium-panel': [
    {
      type: 'answerFirst',
      text: 'Norton 360 Premium supplied as ready account credentials: an account already carrying the Premium subscription, with its larger cloud backup allowance and broader device coverage. Sign in and install — there is no code to redeem.',
    },
    { type: 'heading', level: 2, text: 'How this differs from the retail licence' },
    {
      type: 'richText',
      html: '<p>Only in delivery. A retail purchase gives you a code to enter into your own Norton account; this gives you an account with the subscription already on it. Sign in, download, add devices.</p><p>Change the password on first sign-in. The credentials are the licence: whoever holds them holds the subscription, which is exactly why they should stop being the ones that arrived by email.</p>',
    },
    { type: 'heading', level: 2, text: 'What Premium includes' },
    {
      type: 'richText',
      html: '<p>The full 360 suite — antivirus and ransomware protection, Secure VPN, Password Manager, dark web monitoring, SafeCam, parental controls — with Premium’s larger <strong>cloud backup</strong> allowance, which is the single feature that recovers a machine after an attack rather than preventing one.</p>',
    },
  ],

  'norton-security-premium': [
    {
      type: 'answerFirst',
      text: 'Norton Security Premium is the generation before Norton 360: antivirus, firewall, parental controls, password manager and cloud backup for Windows. It is bought today mostly to renew an existing installation rather than to start a new one.',
    },
    { type: 'heading', level: 2, text: 'What it is, and what it is not' },
    {
      type: 'richText',
      html: '<p>Norton Security Premium covers the core well — real-time malware and ransomware protection, a two-way firewall, a password manager, parental controls and PC cloud backup. It was the top edition of Norton’s previous range and is a complete product.</p><p>What it does not have is the <strong>Secure VPN</strong> and <strong>dark web monitoring</strong> that arrived with Norton 360. On a laptop that connects to public Wi-Fi, the VPN is the difference that matters.</p>',
    },
    { type: 'heading', level: 2, text: 'Choose it deliberately' },
    {
      type: 'richText',
      html: '<p>The sound reason to pick this line is continuity — an existing Norton Security installation you would rather extend than migrate. For a new machine, <a href="/en/store/norton-360-deluxe">Norton 360 Deluxe</a> is the current range and includes the VPN.</p>',
    },
  ],

  'mcafee-internet-security-10-deivce': [
    {
      type: 'answerFirst',
      text: 'McAfee Internet Security is a multi-device household suite: antivirus and ransomware protection, a two-way firewall, web and download safety ratings, a password manager, and a file shredder — across Windows, Mac, Android and iOS on one subscription.',
    },
    { type: 'heading', level: 2, text: 'Built around covering every device in a house' },
    {
      type: 'richText',
      html: '<p>The design assumption is a family with more screens than people. One subscription covers laptops, phones and tablets, and the protection follows each platform’s own rules — full scanning on Windows, app and web protection on Android, web and Wi-Fi checks on iOS.</p><p><strong>WebAdvisor</strong> colours search results and blocks known malicious pages and downloads before they open, which stops more household infections than any scan does. <strong>True Key</strong> stores and fills passwords across devices. <strong>Shredder</strong> overwrites deleted files so they cannot be recovered, which matters when a machine is sold or handed on.</p>',
    },
    { type: 'heading', level: 2, text: 'One account, one place to look' },
    {
      type: 'richText',
      html: '<p>Everything is managed from a single McAfee account: add a device, send an installer by email, see which machines are protected and which have fallen behind. For a household where one person maintains everyone’s computers, that page is most of the value.</p>',
    },
  ],

  'ccleaner-professional': [
    {
      type: 'answerFirst',
      text: 'CCleaner Professional is the paid edition of the cleanup tool: it adds real-time monitoring, scheduled automatic cleaning, a driver updater and a software updater to the manual cleaning the free version does.',
    },
    { type: 'heading', level: 2, text: 'What "Professional" adds to the free tool' },
    {
      type: 'richText',
      html: '<p>The cleaning itself is the same. What you are paying for is that it happens without you.</p><p><strong>Scheduled cleaning</strong> runs on its own, which is the difference between a machine that stays tidy and one that gets cleaned when somebody remembers. <strong>Real-time monitoring</strong> watches junk accumulate and prompts when it is worth clearing. <strong>Driver Updater</strong> finds outdated graphics, audio and chipset drivers — the commonest cause of a machine that has become unstable for no obvious reason. <strong>Software Updater</strong> keeps installed applications current, which is a security measure more than a convenience: most drive-by attacks target an old browser or PDF reader.</p>',
    },
    { type: 'heading', level: 2, text: 'A note on what it will not do' },
    {
      type: 'richText',
      html: '<p>CCleaner clears caches, temporary files, logs and browser data, and tidies the registry. It will not make a failing disk healthy or add memory to a machine that needs it — on an old laptop, an SSD does more than any cleaner can. Used for what it is, it recovers real disk space and shortens boot time by managing what starts with Windows.</p>',
    },
  ],

  'ccleaner-professional-plus': [
    {
      type: 'answerFirst',
      text: 'CCleaner Professional Plus bundles four tools rather than one: CCleaner Professional, Recuva for recovering deleted files, Defraggler for disk defragmentation, and Speccy for reading the machine’s hardware and temperatures.',
    },
    { type: 'heading', level: 2, text: 'The three tools that come with it' },
    {
      type: 'richText',
      html: '<p><strong>Recuva</strong> recovers deleted files — from a disk, a memory card or a camera — and is the one people end up needing at three in the morning. It works best when nothing has been written to the drive since, which is worth knowing before the emergency rather than during it.</p><p><strong>Defraggler</strong> defragments individual files or whole drives on mechanical disks. On an SSD it is unnecessary and should be left alone; on the spinning disk in an older machine it still helps.</p><p><strong>Speccy</strong> reports exactly what is inside the machine — CPU, memory type and speed, motherboard, disk health and live temperatures. It is how you find out whether a laptop is throttling because it is overheating, and which memory to buy before ordering any.</p>',
    },
    { type: 'heading', level: 2, text: 'Plus or plain Professional' },
    {
      type: 'richText',
      html: '<p>If you only want scheduled cleaning and the updaters, <a href="/en/store/ccleaner-professional">CCleaner Professional</a> is the cheaper licence. Plus is worth the difference for anyone who maintains other people’s machines, where recovering a file and reading hardware are the two jobs that come up most.</p>',
    },
  ],

  'eset-nod32-antivirus-bind-panel': [
    {
      type: 'answerFirst',
      text: 'ESET NOD32 AntiVirus supplied through a management panel rather than as individual keys: licences are issued and assigned from one place, which is how a business or a reseller covers many machines without tracking a key per device.',
    },
    { type: 'heading', level: 2, text: 'Why a panel rather than keys' },
    {
      type: 'richText',
      html: '<p>Past a handful of machines, individual keys become the problem. Which key is on which laptop, which expires when, what happens when a machine is replaced — all of it lives in a spreadsheet nobody maintains.</p><p>A panel replaces that with one list: issue a seat, assign it, reclaim it when a machine leaves. Renewal is one date instead of many, and a device that has stopped reporting is visible rather than assumed to be fine.</p>',
    },
    { type: 'heading', level: 2, text: 'The protection is NOD32 AntiVirus' },
    {
      type: 'richText',
      html: '<p>The same engine as the <a href="/en/store/eset-nod32-antivirus">retail edition</a>: real-time scanning, ransomware shield, exploit blocker, advanced memory scanner and UEFI scanning, with the light footprint ESET is chosen for. This product changes how the licences are administered, not what they protect against.</p>',
    },
  ],
};
