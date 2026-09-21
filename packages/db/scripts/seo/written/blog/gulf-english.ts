/**
 * English versions of the three Gulf-framed comparisons.
 *
 * Written for the reader the Arabic originals were written for, in the other
 * language they work in: English-speaking residents and businesses in the GCC,
 * where English is the working language of a great deal of commerce and the
 * currency on the invoice is still the dirham or the riyal. The framing stays —
 * this is not a global rewrite with the region filed off.
 *
 * Faithful to the originals in structure, argument and recommendation. Three
 * things did not survive the crossing, and each is a claim rather than a
 * sentence:
 *
 *   **"Windows 10 is still installed on more than 60% of devices worldwide."**
 *   That was true around 2023. Windows 11 passed Windows 10 in global desktop
 *   share during 2025, so the figure is now wrong — and it was the opening
 *   sentence. The point it was making (a very large installed base, and a
 *   decision most of them have not made) is true without it.
 *
 *   **"More than 4 million files are stolen every day worldwide."** No source,
 *   and I could not find one. An unsourced statistic in an article that goes
 *   on to promise "real numbers from independent labs" undermines the numbers
 *   that are real, so it is gone rather than translated.
 *
 *   **"After thousands of orders, here is our recommendation."** This system
 *   records 145 units sold across the catalog and four orders. The legacy
 *   store's order history was never imported, so the claim may well be true of
 *   the business — but nothing here supports it, and I will not assert it in a
 *   new article. The recommendation stands on its reasoning, which is what
 *   made it worth reading.
 *
 * The AV-TEST and AV-Comparatives percentages are kept in the ranges the
 * original gives, but attributed to the labs rather than stated flat. That is
 * not softening the claim — it is saying where it comes from, which is what
 * the article promises in its own second paragraph.
 *
 * Prices are kept, because a three-year cost comparison with no numbers is not
 * a cost comparison. They are labelled as indicative retail pricing, which is
 * what they are: this shop's own prices are on its product pages and move.
 */
import type { NewPost } from './new-posts.js';

export const GULF_ENGLISH: NewPost[] = [
  {
    slug: 'windows-10-vs-windows-11',
    title: 'Windows 10 or Windows 11 in 2026: which should you actually choose?',
    summary:
      'The difference is not a centred Start button. It is a hardware requirement that rules out a great many working machines, a support date that has already passed, and a set of built-in AI features that did not exist before. This settles the question with the requirements and the dates rather than with opinion.',
    seo: {
      title: 'Windows 10 vs Windows 11 in 2026: Which To Choose',
      description:
        'The official requirements and the one that blocks most machines, what actually differs in use, what Windows 10 end of support means, and when to stay put.',
    },
    products: ['windows-11-pro', 'windows-10-pro', 'windows-11-home', 'windows-10-home'],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Choose Windows 11 if your machine passes Microsoft’s hardware check — it is the version still receiving security updates, and upgrading an activated Windows 10 install needs no new key. Stay on Windows 10 if the hardware cannot qualify or your software is certified against it, and manage the risk deliberately.',
      },
      { type: 'heading', level: 2, text: 'First: can your machine even run Windows 11?' },
      {
        type: 'richText',
        html: '<p>Before any discussion of differences, this is the question that decides the answer for most people. Microsoft set stricter requirements for Windows 11 than for any release before it, and a machine that fails them is not offered the upgrade at all.</p>',
      },
      {
        type: 'specTable',
        title: 'The official minimum',
        rows: [
          { label: 'Processor', value: '1 GHz or faster, two or more cores, 64-bit' },
          { label: 'Memory', value: '4 GB' },
          { label: 'Storage', value: '64 GB' },
          { label: 'Graphics', value: 'DirectX 12 compatible' },
          { label: 'TPM', value: 'Version 2.0 — the requirement that blocks most machines' },
          { label: 'Secure Boot', value: 'Supported and enabled, in UEFI mode' },
          { label: 'Display', value: '720p or better, 9 inches or larger' },
        ],
      },
      {
        type: 'richText',
        html: '<p>The one that stops most machines is <strong>TPM 2.0</strong> — a security chip absent from most hardware built before roughly 2017. Two things worth knowing before you write a machine off: on many 2016 and 2017 models the chip is present but <strong>switched off in firmware</strong>, which is a BIOS setting rather than a purchase; and a processor outside Microsoft’s supported list cannot be fixed by any setting.</p><p>Run Microsoft’s free <strong>PC Health Check</strong>. It names the requirement that fails, which is the part that decides what you do next.</p>',
      },
      { type: 'heading', level: 2, text: 'What actually differs in daily use' },
      {
        type: 'richText',
        html: '<p><strong>The interface.</strong> A centred Start menu and taskbar, rounded windows, a rebuilt Settings app, and — the change people keep — <strong>Snap Layouts</strong>, which arranges windows into a chosen grid instead of dragging them to edges. On a wide monitor that is a real working difference rather than a cosmetic one.</p><p><strong>Performance.</strong> On modern hardware Windows 11 schedules work better across efficiency and performance cores, which matters on recent Intel and AMD laptops and matters not at all on a machine from 2017. On older qualifying hardware the two feel the same; anyone expecting an upgrade to make a slow machine fast will be disappointed in either direction.</p><p><strong>Security.</strong> This is where the strict requirements pay for themselves: TPM 2.0 and Secure Boot are not bureaucracy, they are what virtualisation-based security and hardware-backed encryption are built on. It is also why the requirement cannot simply be waived.</p><p><strong>AI features.</strong> Copilot is built into Windows 11 and is not coming to Windows 10. Whether that belongs in the plus column depends entirely on whether you would use it.</p>',
      },
      { type: 'heading', level: 2, text: 'Windows 10 end of support: what it means' },
      {
        type: 'richText',
        html: '<p>Free security updates for Windows 10 ended on <strong>14 October 2025</strong>. Nothing switched off and nothing will: the system boots, activates and runs every application it ran before, and there is no shutdown date coming. What stopped is the monthly patch for newly discovered vulnerabilities.</p><p>How much that matters depends on the machine rather than on the calendar. A PC that browses the web, receives attachments and signs into bank accounts carries real and permanent exposure. A machine running one application on a network with no internet — a till, a workshop tool, a laboratory instrument — carries almost none, because nothing can reach the holes. Microsoft sells Extended Security Updates to organisations that need more time, which is a bridge with an annual cost rather than an answer.</p>',
      },
      { type: 'heading', level: 2, text: 'When to stay on 10, and when to move to 11' },
      {
        type: 'richText',
        html: '<p><strong>Stay on Windows 10</strong> when the hardware cannot qualify and replacing it to chase an operating system is the more expensive answer; or when your line-of-business software is certified against Windows 10 and not against 11 — industrial control, laboratory instruments, some accounting suites — because a certification is not something a user can override; or when the machine is isolated and does one job.</p><p><strong>Move to Windows 11</strong> when the machine passes the check, which is most machines bought from 2018 onward. The upgrade carries the licence across with no new key. And when buying for a new machine, buy Windows 11 — it is the version being patched.</p><p>The edition question is separate and the same in both: <strong>Pro</strong> adds BitLocker full-drive encryption, Hyper-V, Remote Desktop hosting and Group Policy over <strong>Home</strong>. If none of those four describes a need, Home is the right choice and Pro is money in features that will sit idle.</p>',
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Do I need a new licence key to upgrade from 10 to 11?',
            a: 'No. Upgrading an activated Windows 10 machine carries the licence across, provided the hardware meets the requirements. If it does not, the upgrade is not offered with any key.',
          },
          {
            q: 'My PC says it is not supported. Is that final?',
            a: 'Not necessarily. On many machines from 2016 onward the TPM is present but disabled in firmware — enabling fTPM on AMD or PTT on Intel, plus Secure Boot, is often the whole fix. If the processor itself is off the supported list, no setting changes that.',
          },
          {
            q: 'Is Windows 10 unsafe to use now?',
            a: 'It depends on the machine. Newly discovered vulnerabilities are no longer patched, which is serious on a PC that browses and holds customer data and close to irrelevant on one running a single application on an isolated network. Keep the browser and a third-party antivirus current either way.',
          },
          {
            q: 'Will Windows 11 make an older machine faster?',
            a: 'No. Its scheduling improvements apply to recent processors with efficiency and performance cores. On older qualifying hardware the two perform much the same.',
          },
        ],
      },
    ],
  },

  {
    slug: 'office-365-vs-office-2021',
    title: 'Office 365 or Office 2021: which suits your business in the Gulf?',
    summary:
      'Do you pay a subscription that never ends, or buy a licence once and be done? Plenty of business owners in the GCC are standing at exactly that junction, and there is no single right answer. Here is the comparison, the real cost over three years, and a clear recommendation for each situation.',
    seo: {
      title: 'Office 365 vs Office 2021: Which For Your Business',
      description:
        'Subscription against perpetual licence, what each includes, the real three-year cost, and a clear recommendation by situation — for businesses in the Gulf.',
    },
    products: ['office-365-pro-plus', 'office-2021-pro-plus', 'office-2019-pro-plus'],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Buy Office 2021 if you work alone on one machine and want a licence that never renews — over three to five years it is clearly cheaper. Choose Office 365 if you work across several devices, collaborate on the same files with a team, or want the version to keep improving.',
      },
      { type: 'heading', level: 2, text: 'The difference is the model, not the features' },
      {
        type: 'richText',
        html: '<p>Before any comparison, the philosophy behind each one.</p><p><strong>Office 365</strong> — Microsoft 365 under its newer name — is a subscription. You pay monthly or annually, and for as long as you pay you get the latest release, new features as they arrive, cloud storage and continuing support. Stop paying and the applications stop working.</p><p><strong>Office 2021</strong> is a perpetual licence. You pay once and own that version indefinitely, but you will not automatically receive features added after release. No cloud storage, no feature updates — security fixes only, and those run until October 2026.</p><p>The real question is not which has more features. It is whether you would rather rent or own.</p>',
      },
      {
        type: 'specTable',
        title: 'What each one gives you',
        rows: [
          { label: 'Always the latest release', value: 'Office 365: yes · Office 2021: no' },
          { label: 'OneDrive cloud storage (1 TB)', value: 'Office 365: yes · Office 2021: no' },
          { label: 'Teams', value: 'Office 365: included · Office 2021: limited' },
          { label: 'Devices per licence', value: 'Office 365: up to five · Office 2021: one' },
          { label: 'Co-authoring the same file', value: 'Office 365: yes · Office 2021: no' },
          { label: 'Mobile apps, full features', value: 'Office 365: yes · Office 2021: no' },
          { label: 'Cost shape', value: 'Office 365: recurring · Office 2021: once' },
          {
            label: 'Security updates',
            value: 'Office 365: while subscribed · Office 2021: to Oct 2026',
          },
        ],
      },
      { type: 'heading', level: 2, text: 'The real cost over three years' },
      {
        type: 'richText',
        html: '<p>Indicative retail pricing, to show the shape of the arithmetic rather than to quote a price — our own prices sit on the product pages and move.</p><ul><li><strong>Office 2021 Pro Plus</strong> — around AED 618 once. Over three years that is roughly $55 a year; over five, roughly $33 a year, and it keeps falling because nothing further is paid.</li><li><strong>Office 365 Personal</strong> — around AED 253 a year, so roughly $207 over three years, and it never stops.</li><li><strong>Office 365 Business Basic</strong> — around $6 per user per month. For five staff over three years, roughly $1,080.</li></ul><p><strong>The arithmetic, in a sentence:</strong> if you are one person doing routine work, Office 2021 is clearly cheaper over any long horizon. If you work as a team, or genuinely need the cloud and the continuing updates, Office 365 returns more than it costs.</p>',
      },
      { type: 'heading', level: 2, text: 'Who each edition suits' },
      {
        type: 'richText',
        html: '<p><strong>Office 365 suits</strong> companies and teams collaborating on the same files; anyone working across several devices — desk, laptop, phone; anyone who wants the newest capabilities as they ship; and a growing business that expects to add staff.</p><p><strong>Office 2021 suits</strong> individuals and freelancers on a single machine; businesses with a settled IT setup that does not change; anyone with no use for cloud storage; and training and education settings where the software needs to behave the same way every term.</p>',
      },
      { type: 'heading', level: 2, text: 'Our recommendation, by situation' },
      {
        type: 'richText',
        html: '<ul><li><strong>One person, one machine</strong> → Office 2021. Pay once, use it for years, no monthly pressure.</li><li><strong>Small company, 2–10 staff</strong> → Office 365 Business. Collaboration, cloud and support are worth the subscription at that size.</li><li><strong>You want the newest Microsoft features across several devices</strong> → Office 365 Personal or Family.</li><li><strong>Limited budget, basics only</strong> → Office 2021 Home &amp; Business. Everything most people need, at a fixed one-time price.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'The decision is easier than it looks' },
      {
        type: 'richText',
        html: '<p>Neither is better in the abstract — each is better for a particular reader. If you need collaboration, cloud storage and continuing updates, 365 earns its subscription. If you need a reliable suite you own outright at a price that does not repeat, 2021 is your answer.</p>',
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'What happens to my files if I stop paying for Office 365?',
            a: 'The files are yours and stay readable — Word and Excel formats are the same in both products. What stops is the applications: they drop to a read-only state until the subscription resumes.',
          },
          {
            q: 'Can I install Office 2021 on a second computer?',
            a: 'No. The perpetual licence covers one device. Office 365 is the product that covers several, and signing in on a sixth signs the oldest out rather than refusing.',
          },
          {
            q: 'Will Office 2021 open files made in Microsoft 365?',
            a: 'Yes, the formats are identical. The one exception is a formula built on a function added after the 2021 release, which shows a name error rather than a result.',
          },
          {
            q: 'Office 2021 security updates end in 2026 — then what?',
            a: 'The applications keep running and keep opening your files; the monthly security patch stops. That is worth knowing before choosing between a perpetual licence and a subscription, and it is why Office 2024 is supported for longer.',
          },
        ],
      },
    ],
  },

  {
    slug: 'eset-vs-norton-vs-mcafee',
    title: 'ESET vs Norton vs McAfee: the antivirus comparison, by the published numbers',
    summary:
      'Plenty of people in the Gulf still pick an antivirus from an advertisement or a name they remember. This article is not selling you one — it puts the published results from the independent testing labs in front of you so you can choose. Four criteria: protection, effect on performance, price, and ease of use.',
    seo: {
      title: 'ESET vs Norton vs McAfee: Which Antivirus To Pick',
      description:
        'Detection rates and performance impact as the independent labs publish them, what each suite bundles, the weaknesses, and which one suits your machine.',
    },
    products: [
      'eset-internet-security-nod32',
      'norton-360-deluxe',
      'mcafee-internet-security-10-deivce',
      'eset-nod32-antivirus',
    ],
    blocks: [
      {
        type: 'answerFirst',
        text: 'All three detect at rates the independent labs publish in the high nineties, so detection is not what separates them. What does: ESET is by far the lightest on an older machine, Norton bundles the most beyond protection — VPN, cloud backup, password manager — and McAfee is built around covering every device in a household on one subscription.',
      },
      { type: 'heading', level: 2, text: 'How the three were assessed' },
      {
        type: 'richText',
        html: '<ul><li><strong>AV-TEST and AV-Comparatives</strong> — two independent European laboratories that test security software quarterly under standardised conditions, and publish the results.</li><li><strong>Detection rate</strong> — the proportion of malware each product catches from a common sample set.</li><li><strong>Performance testing</strong> — machine speed measured with the product installed against without it.</li><li><strong>Ease of use and support</strong> — interface, defaults, and what is bundled beyond the scanner.</li></ul><p>A note on reading any of this: the headline detection percentages sit within a point of each other across all the major suites, and a difference of 0.1% is inside the noise of a quarterly test. Choose on the other three criteria.</p>',
      },
      { type: 'heading', level: 2, text: 'ESET — the quietest and the lightest' },
      {
        type: 'richText',
        html: '<p>ESET consistently posts strong results at AV-TEST, with detection of known threats reported in the <strong>99.8%–100%</strong> range. What actually distinguishes it is weight: the labs report a performance impact in the region of <strong>3–5%</strong> while it runs in the background.</p><p><strong>Strengths:</strong> multi-layered detection, the smallest footprint of the three, home network and router scanning, a gaming mode that silences notifications, and unusually deep configuration for a technical user.</p><p><strong>Weaknesses:</strong> an interface that can confuse a non-technical user, no VPN in the base tiers, relatively limited Arabic-language support, and fewer privacy extras than the others.</p><p><strong>Suits:</strong> older machines, technical users, small businesses, and anyone for whom performance is the priority.</p>',
      },
      { type: 'heading', level: 2, text: 'Norton 360 — the most complete bundle' },
      {
        type: 'richText',
        html: '<p>Norton 360 is among the most comprehensive suites on the market, with detection reported between <strong>99.9%</strong> and <strong>100%</strong> in most AV-TEST rounds. Its real advantage is what arrives outside traditional protection.</p><p><strong>Strengths:</strong> an unmetered VPN included, encrypted cloud backup, dark web monitoring for your addresses, a password manager, parental controls, and a genuinely simple interface.</p><p><strong>Weaknesses:</strong> heavier on resources — the labs report a slowdown in the <strong>15–20%</strong> region during a full scan — and a bundle large enough that some of it will go unused.</p><p>Of everything in that list, <strong>cloud backup</strong> is the one worth weighing hardest: it is the only feature in any of these suites that helps <em>after</em> ransomware rather than before it.</p>',
      },
      { type: 'heading', level: 2, text: 'McAfee — built around the household' },
      {
        type: 'richText',
        html: '<p>McAfee’s design assumption is a home with more screens than people: one subscription covering Windows, Mac, Android and iOS, with the protection following each platform’s own rules.</p><p><strong>Strengths:</strong> broad multi-device coverage, WebAdvisor — which colours search results and blocks known malicious pages before they open, and stops more household infections than any scan does — a password manager, a file shredder, and one account page showing which machines are protected and which have fallen behind.</p><p><strong>Weaknesses:</strong> more upsell prompts than the other two, and a heavier footprint than ESET.</p><p><strong>Suits:</strong> families and households, and anyone maintaining everyone else’s computers from one place.</p>',
      },
      {
        type: 'specTable',
        title: 'Side by side',
        rows: [
          {
            label: 'Detection (published ranges)',
            value: 'All three in the high nineties — not the deciding factor',
          },
          { label: 'Lightest on an old machine', value: 'ESET, by a wide margin' },
          { label: 'VPN included', value: 'Norton — unmetered' },
          { label: 'Cloud backup', value: 'Norton only — the one that helps after an attack' },
          { label: 'Best multi-device coverage', value: 'McAfee' },
          { label: 'Deepest configuration', value: 'ESET' },
          { label: 'Simplest interface', value: 'Norton' },
        ],
      },
      { type: 'heading', level: 2, text: 'Which to buy' },
      {
        type: 'richText',
        html: '<ul><li><strong>An older or slower machine</strong> → ESET. The footprint is the whole argument, and it is a large one.</li><li><strong>You want protection plus a VPN and backup in one bill</strong> → Norton 360. Bought separately those cost more than the difference.</li><li><strong>A household of phones, tablets and laptops</strong> → McAfee. One subscription, one page, every device.</li><li><strong>A technical user who wants control over every setting</strong> → ESET.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'Do not buy a name — buy protection that fits' },
      {
        type: 'richText',
        html: '<p>The three are close enough on detection that the choice is decided by everything else: what the machine can spare, what else you need bundled, and how many devices are involved. Answer those and the product picks itself.</p>',
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Is a paid antivirus better than Windows Defender?',
            a: 'Defender scores well at the labs and is genuinely adequate on a careful, updated machine. What the paid suites add is the surrounding layer — a two-way firewall, a hardened browser for banking, a VPN, cloud backup, multi-device coverage — rather than better detection.',
          },
          {
            q: 'Which slows my computer least?',
            a: 'ESET, consistently, and by a margin the labs measure rather than a marketing claim. On a laptop that is already slow, that is usually the deciding factor.',
          },
          {
            q: 'Can I run two antivirus products together?',
            a: 'No. They interfere with each other, and the usual result is a machine that is slower and less protected than with either alone. Remove one before installing the other.',
          },
          {
            q: 'Which one protects against ransomware best?',
            a: 'All three detect ransomware behaviour. The meaningful difference is recovery: Norton includes cloud backup, which is what restores a machine after an attack has already encrypted it — the only feature here that works after the fact.',
          },
        ],
      },
    ],
  },
];
