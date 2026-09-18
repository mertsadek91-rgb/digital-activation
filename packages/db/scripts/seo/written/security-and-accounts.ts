/**
 * The antivirus line and the account-delivered products.
 *
 * Two families that the generator flattened for different reasons. The ESET
 * products differ only by feature set, which lives in no column at all — one
 * is an antivirus and the other is a suite wrapped around the same engine, and
 * a buyer choosing between them is choosing exactly that. Canva Edu differs by
 * how it arrives: credentials rather than a key, browser rather than an
 * installer, which changes what the page has to tell somebody.
 */
import type { Block } from '../body.js';

export const SECURITY_AND_ACCOUNTS: Record<string, Block[]> = {
  'eset-internet-security-nod32': [
    {
      type: 'answerFirst',
      text: 'ESET Internet Security is the mid-tier suite: the NOD32 detection engine plus everything an antivirus alone does not do — a two-way firewall, network and Wi-Fi inspection, anti-phishing, a hardened browser for banking, and webcam control.',
    },
    { type: 'heading', level: 2, text: 'What it adds over plain NOD32 AntiVirus' },
    {
      type: 'richText',
      html: '<p>The detection engine is the same in both. What this edition adds is everything that guards the connection rather than the disk.</p><p>A <strong>two-way firewall</strong> watches what leaves the machine as well as what arrives, which is what catches software already installed and quietly talking to somewhere it should not. <strong>Network inspector</strong> scans the router and lists every device on the Wi-Fi, including the ones nobody remembers connecting. <strong>Banking and payment protection</strong> opens a hardened browser window for a bank or a checkout page, so a keylogger running on the same machine sees nothing. <strong>Anti-phishing</strong> blocks the counterfeit page before a password is typed into it, and <strong>webcam control</strong> asks before any application switches the camera on.</p>',
    },
    { type: 'heading', level: 2, text: 'Why it is the one chosen for older machines' },
    {
      type: 'richText',
      html: '<p>ESET has a long reputation for staying out of the way — a small memory footprint, scans that do not stall the machine, and few interruptions. On a laptop that is already slow, that difference is usually the reason to choose it over a heavier suite, and it is why the product has survived two decades of competitors that were faster to add features.</p>',
    },
  ],

  'eset-nod32-antivirus': [
    {
      type: 'answerFirst',
      text: 'ESET NOD32 AntiVirus is the core product: malware, ransomware and script-attack protection on the same detection engine as ESET’s larger suites, without the firewall, network tools and parental controls layered on top.',
    },
    { type: 'heading', level: 2, text: 'The engine, and nothing you will not use' },
    {
      type: 'richText',
      html: '<p>Real-time scanning of files, downloads and mail attachments. <strong>Ransomware shield</strong>, which watches for the behaviour rather than waiting for a signature. <strong>Exploit blocker</strong>, aimed at the applications most often attacked through a document — browsers, PDF readers, Office. <strong>Advanced memory scanner</strong>, for malware that only reveals itself once it has unpacked itself in memory. And a <strong>UEFI scanner</strong>, which checks the firmware that runs before Windows does.</p><p>What is deliberately absent is the firewall, the network inspector and the banking browser. Windows Defender Firewall already covers the first on most home machines, which is why this edition exists at a lower price.</p>',
    },
    { type: 'heading', level: 2, text: 'Choose this, or Internet Security' },
    {
      type: 'richText',
      html: '<p>Take NOD32 AntiVirus for a personal machine sitting behind a home router, where you want protection with the lightest possible footprint. Take <a href="/en/store/eset-internet-security-nod32">ESET Internet Security</a> if you bank or shop on the machine, use public Wi-Fi, or want to see what else is on your network.</p>',
    },
  ],

  'canva-edu': [
    {
      type: 'answerFirst',
      text: 'A Canva account on the Education plan: the full design tool in the browser with the premium template library, the one-click background remover, brand kits and Magic Resize, plus the classroom side — a class workspace, assignments and student collaboration.',
    },
    { type: 'heading', level: 2, text: 'What the plan unlocks' },
    {
      type: 'richText',
      html: '<p>Everything sitting behind the crown icon on a free account. The <strong>premium library</strong> — templates, photos, video, audio and graphics — rather than the free subset. The one-click <strong>background remover</strong> and Magic Eraser, which between them replace most of the reasons people open an image editor. <strong>Brand kits</strong>, so a logo, a palette and two fonts apply across every design instead of being re-picked each time. And <strong>Magic Resize</strong>, which turns one finished design into every other format it is needed in.</p><p>The teaching features are what separate Education from Pro: a shared class workspace, assignments you can set and collect back, and student collaboration without each student needing a paid plan of their own.</p>',
    },
    { type: 'heading', level: 2, text: 'An account rather than a key' },
    {
      type: 'richText',
      html: '<p>This arrives as <strong>sign-in credentials</strong>, not an activation key: you sign in at canva.com and the plan is already on the account. Nothing is installed, so it behaves the same on a laptop, a tablet and a phone, and your designs follow you between them.</p><p>Change the password after the first sign-in, and keep your work in a folder of your own so it stays easy to find.</p>',
    },
  ],
};
