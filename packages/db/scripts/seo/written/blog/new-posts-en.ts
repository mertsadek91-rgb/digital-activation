/**
 * English versions of the four new posts.
 *
 * Written rather than translated, and the difference matters in two places.
 *
 * The Arabic posts open on what an Arabic-speaking reader is worried about;
 * the English ones open on what an English-speaking one is. On Windows 10 end
 * of support that is the same fact framed opposite ways round — the Arabic
 * leads with the reassurance that nothing switches off, the English with the
 * exposure, because that is how each is actually asked. Sentence-for-sentence
 * translation would have got one of the two wrong.
 *
 * The other difference is the audience. The CAL guide and the TPM post are the
 * two with real English search value and almost no good competition: the CAL
 * rules are learned expensively in every language, and "my PC will not take
 * Windows 11" is usually a firmware setting that nobody names. Those two are
 * written at full length. The other two follow their Arabic counterparts
 * closely because the decision they describe is arithmetic, and arithmetic
 * does not localise.
 *
 * No post quotes a price, in either language, for the same reason: the live
 * product grid beneath it carries today's and an article cannot.
 */
import type { NewPost } from './new-posts.js';

export const NEW_POSTS_EN: NewPost[] = [
  {
    slug: 'windows-10-end-of-support',
    title: 'Windows 10 support has ended: what that actually means, and your options',
    summary:
      'Free security updates for Windows 10 stopped on 14 October 2025. Nothing switched off — the system boots, activates and runs everything it ran before. What stopped is the monthly patch for newly discovered vulnerabilities, and how much that matters depends on what your machine does, not on the date.',
    seo: {
      title: 'Windows 10 End of Support: What To Do Now',
      description:
        'What actually stopped in October 2025 and what did not, how much risk your machine really carries, and three honest options if it cannot run Windows 11.',
    },
    products: ['windows-10-pro', 'windows-10-home', 'windows-11-pro', 'windows-11-home'],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Free security updates for Windows 10 stopped on 14 October 2025. The system still boots, still activates and still runs every application it ran before — what stopped is the monthly patch for new vulnerabilities, so the risk depends on what the machine does rather than on the date.',
      },
      { type: 'heading', level: 2, text: 'What stopped, and what did not' },
      {
        type: 'richText',
        html: '<p>This is the confusion half the internet lives on. <strong>Nothing stopped</strong> on the machine itself: Windows 10 boots, accepts an activation key, runs every program it ran the day before, and will not switch itself off on some future date. There is no kill switch coming.</p><p><strong>What stopped</strong> is Patch Tuesday — the monthly fix that closes newly discovered holes in the operating system. With it went feature updates, which Windows 10 had not been receiving for years anyway, and free Microsoft support for operating-system problems.</p><p>What continues is everything that is not Microsoft’s: your <strong>browser</strong> updates on its own schedule, third-party <strong>antivirus</strong> likewise, and most applications keep shipping Windows 10 builds for a while after the platform itself goes quiet.</p>',
      },
      { type: 'heading', level: 2, text: 'The risk depends on the machine, not the calendar' },
      {
        type: 'richText',
        html: '<p>These two cases are not close, and treating them the same is what produces bad decisions in both directions.</p><p><strong>Real exposure:</strong> a PC that browses the web, receives mail and attachments, signs into bank accounts, or holds customer data. A vulnerability found after October 2025 stays open on that machine permanently, and the route to it — a browser, an attachment, a network — is open every day.</p><p><strong>Close to none:</strong> a machine running one application on a network with no internet. A workshop tool, a till, a laboratory instrument, a PC driving a printer or a camera array. The vulnerabilities exist; nothing can reach them. That is exactly why a great many of those machines are still on Windows 10 by a deliberate decision rather than by neglect.</p>',
      },
      { type: 'heading', level: 2, text: 'Why many people cannot simply upgrade' },
      {
        type: 'richText',
        html: '<p>"Just move to Windows 11" ignores that a lot of hardware <strong>cannot</strong>. Windows 11 refuses to install without <strong>TPM 2.0</strong>, without <strong>Secure Boot</strong>, and without a processor on Microsoft’s supported list.</p><p>The good news is that many machines from 2016 and 2017 have a TPM that is <strong>switched off in firmware</strong> rather than absent — a BIOS setting, not a purchase. The other news is that a 2013 or 2014 machine will not pass whatever you change, and replacing it to chase an operating system is the most expensive answer rather than the most correct one.</p><p>Run Microsoft’s free <strong>PC Health Check</strong> before deciding anything. It answers the question in a minute, and it tells you <em>which</em> requirement fails, which is the part that matters.</p>',
      },
      { type: 'heading', level: 2, text: 'Your three options' },
      {
        type: 'richText',
        html: '<p><strong>1 — Upgrade to Windows 11.</strong> If the machine passes, this is the right answer: upgrading an activated Windows 10 install needs no new key, and the licence carries across. Buying for a new machine, Windows 11 Pro is what is still being patched.</p><p><strong>2 — Stay on Windows 10 deliberately.</strong> Entirely defensible for the isolated machine described above, and for a PC running software certified against Windows 10 and not against 11 — industrial control, laboratory instruments, some accounting suites, and a certification is not something a user can override. Keep the browser and a third-party antivirus current, and reduce what reaches the machine from outside the network.</p><p><strong>3 — Extended Security Updates.</strong> Microsoft sells ESU to organisations that need more time to migrate. It is a bridge with an annual cost, not a permanent answer — sensible for a business with a migration plan and a date, not for an individual.</p>',
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Will Windows 10 stop working on some date?',
            a: 'No. There is no shutdown date and no kill switch. The system runs and activates as before; what ended is the free security updates.',
          },
          {
            q: 'Does buying a Windows 10 key still make sense?',
            a: 'Yes, for a machine that cannot run Windows 11 or for software certified against 10 — the two commonest reasons. The licence is permanent and activates the system fully. For a machine that passes the Windows 11 check, buy Windows 11 Pro instead: same features, still patched.',
          },
          {
            q: 'Is the upgrade from Windows 10 to 11 free?',
            a: 'If the hardware meets the requirements, upgrading an activated install needs no new key. If it does not meet them, the upgrade is not offered at all, with any key.',
          },
          {
            q: 'What should I do immediately if I stay on Windows 10?',
            a: 'Update the browser and leave it on automatic updates, install a third-party antivirus that still receives definitions, and take a backup that lives off the machine — a backup is the one measure that helps after something has gone wrong rather than before.',
          },
        ],
      },
    ],
  },

  {
    slug: 'windows-server-cal-guide',
    title: 'Windows Server CALs: the complete guide, and the three mistakes everyone makes',
    summary:
      'The server licence alone is not enough. Every user or device that touches Windows Server needs a Client Access Licence, and anyone connecting as a remote desktop needs a second one on top of that. The licensing server runs for 120 days without CALs and then refuses every connection — which is how most administrators discover they exist.',
    seo: {
      title: 'Windows Server CALs: The Complete Guide',
      description:
        'Three licences rather than one, Per Device against Per User with the arithmetic, the 120-day trap, and why a CAL never licenses a newer server.',
    },
    products: [
      'windows-server-2025-standard',
      'windows-server-2025-rds-device-user',
      'windows-server-2022-standard',
      'windows-server-2022-rds-device-user',
      'windows-server-2022-essential',
    ],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Running Windows Server correctly licensed takes three things, not one: the server licence, a Client Access Licence for every user or device that connects to it, and an RDS CAL on top for anyone connecting as a remote desktop. The middle one is what people miss.',
      },
      { type: 'heading', level: 2, text: 'Three licences, not one' },
      {
        type: 'richText',
        html: '<p><strong>The server licence</strong> covers the machine — the copy of Windows Server running on it. This is the one everybody knows about and everybody buys.</p><p><strong>A Windows Server CAL</strong> licenses <em>access</em>. Every user or device that deals with the server in any way — file shares, printing, Active Directory, DHCP — needs one. This is the one that gets forgotten, and forgetting it stops nothing from working, which is precisely why it surfaces only in a licence audit.</p><p><strong>An RDS CAL</strong> licenses connecting <em>as a desktop</em>. Windows Server permits two administrative sessions with no extra licence, and those are for administration rather than for work. Anything beyond that needs an RDS CAL per user or device — <strong>on top of</strong> the ordinary CAL, not instead of it.</p>',
      },
      { type: 'heading', level: 2, text: 'The 120-day grace period, and how it ends' },
      {
        type: 'richText',
        html: '<p>This is the most expensive surprise in Windows Server licensing. Install the <em>Remote Desktop Licensing</em> role without CALs and everything works exactly as you expect — <strong>for 120 days</strong>.</p><p>Then the server stops accepting connections. There is no warning proportional to the disruption, and the grace period <strong>cannot be restarted</strong>: not by reinstalling the role, not by rebuilding the server from an image. That is why RDS CALs are usually bought in the same week as the server rather than afterwards.</p><p>If the period does run out, the only fix is buying the licences and installing them on the licensing role. There is no workaround.</p>',
      },
      { type: 'heading', level: 2, text: 'Per Device or Per User?' },
      {
        type: 'richText',
        html: '<p>The rule is simple and the arithmetic is simpler. <strong>Per Device</strong> licenses the machine and everyone who uses it; <strong>Per User</strong> licenses the person across every machine they connect from. Count both and take the smaller number.</p><p><strong>An example that shows the gap:</strong> ten terminals in a warehouse worked across three shifts by thirty staff. Per Device needs <em>ten</em> licences. Per User needs <em>thirty</em>. Three times the cost for the same access.</p><p><strong>And the reverse:</strong> fifteen office staff, each with a desktop, a laptop and a phone. Per User needs <em>fifteen</em>. Per Device needs <em>forty-five</em>.</p><p>One practical note: the two modes cannot be mixed within one licensing mode on the same server. You pick a mode and it applies to everyone.</p>',
      },
      {
        type: 'heading',
        level: 2,
        text: 'The rule that charges you twice: CALs never license upward',
      },
      {
        type: 'richText',
        html: '<p>A CAL licenses <strong>its own version and every version below it, and nothing above</strong>. A 2019 CAL covers a 2019, 2016 or 2012 host, and will not cover 2022 or 2025.</p><p>The consequence is direct: <strong>buy at the newest host version you run</strong>, because it covers the older ones at no extra cost. Upgrading the server later means buying the CALs again — a cost that belongs in the upgrade decision rather than being discovered after it.</p><p>If you run one host on 2016 and intend to upgrade next year, a 2022 CAL today is cheaper than a 2016 CAL today plus a 2022 CAL tomorrow.</p>',
      },
      { type: 'heading', level: 2, text: 'The one exception: the Essentials edition' },
      {
        type: 'richText',
        html: '<p>The <strong>Essentials</strong> edition needs no CALs at all, and that is the point of it. Its cap — <strong>25 users and 50 devices</strong> — <em>is</em> the licensing, and there is nothing further to buy.</p><p>For a twenty-person office, CALs alongside Standard cost more than the server licence itself; with Essentials they cost nothing. And it is a complete Windows Server underneath — Active Directory, DNS, DHCP, file and print, Hyper-V — not a reduced product.</p><p>But the numbers are <strong>enforced rather than advisory</strong>: the twenty-sixth user cannot sign in. Its other limits are tight too: one physical server, one CPU socket up to 10 cores on the 2022 edition, and no virtualisation rights beyond the host. If your office is near the ceiling now, Standard plus CALs is the licence that will still fit next year.</p>',
      },
      {
        type: 'specTable',
        title: 'Quick reference',
        rows: [
          { label: 'Server licence', value: 'The machine itself — everybody buys this one' },
          { label: 'Windows Server CAL', value: 'Every user or device that connects at all' },
          { label: 'RDS CAL', value: 'On top of that, for anyone connecting as a desktop' },
          {
            label: 'Without RDS CALs',
            value: '120 days, then every connection refused — no restart',
          },
          { label: 'Per Device', value: 'Cheaper when machines are shared and people are not' },
          { label: 'Per User', value: 'Cheaper when one person connects from several machines' },
          { label: 'Version rule', value: 'Covers its own version and older, never newer' },
          { label: 'Essentials', value: 'No CALs at all — up to 25 users and 50 devices' },
        ],
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Do I need CALs if the server only serves files?',
            a: 'Yes. A CAL is required for any access to the server, and a file share is one of the clearest cases. It is the RDS CAL you do not need there, because nobody is connecting as a desktop.',
          },
          {
            q: 'Are CALs installed on the users’ machines?',
            a: 'No. They are installed on the Remote Desktop Licensing role on the server and issued from there. The client machines need nothing installed.',
          },
          {
            q: 'What if the 120 days run out before I buy?',
            a: 'The server refuses connections until the licences are installed. There is no way to extend or reset the period, and reinstalling the role does not renew it.',
          },
          {
            q: 'I run two hosts, 2019 and 2022. Which CAL do I buy?',
            a: 'The 2022 one. It covers both the 2022 host and the 2019 host, where a 2019 CAL covers only the older of the two.',
          },
        ],
      },
    ],
  },

  {
    slug: 'windows-server-standard-vs-datacenter',
    title: 'Standard, Datacenter or Essentials? The decision is arithmetic, not features',
    summary:
      'The difference that settles the choice between Standard and Datacenter is the number of virtual machines permitted: two against unlimited. At three or more, Datacenter becomes the cheaper licence rather than the dearer one — and that arithmetic, not the feature list, is why most virtualisation hosts run it.',
    seo: {
      title: 'Standard vs Datacenter: The Break-Even Point',
      description:
        'Virtualisation rights and where Datacenter becomes cheaper, the storage features Standard cannot have at any price, the Essentials cap, and per-core licensing.',
    },
    products: [
      'windows-server-2025-standard',
      'windows-server-2025-datacenter',
      'windows-server-2022-standard',
      'windows-server-2022-datacenter',
      'windows-server-2022-essential',
    ],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Standard permits two virtual machines above the host; Datacenter permits as many as the hardware carries. At three or more, Datacenter becomes the cheaper licence rather than the dearer one, because Standard has to be bought again for every additional pair while Datacenter is bought once for the host.',
      },
      { type: 'heading', level: 2, text: 'The real difference: virtualisation rights' },
      {
        type: 'richText',
        html: '<p>Everything else is detail. <strong>Standard</strong> licenses the host plus <strong>two virtual instances</strong>. <strong>Datacenter</strong> licenses the host plus an <strong>unlimited</strong> number — as many as the hardware will carry.</p><p>The part that surprises people: Standard does not stop you running four virtual machines. It requires <strong>buying the licence a second time</strong> to cover the second pair, and again for each further pair. That is where the two costs cross.</p><p>Roughly: at two virtual machines Standard is clearly cheaper. At four they converge. At six or more Datacenter is cheaper by a margin that widens with every machine. Run the numbers at today’s prices before buying, because the answer flips sooner than most people expect.</p>',
      },
      { type: 'heading', level: 2, text: 'What only Datacenter has' },
      {
        type: 'richText',
        html: '<p>These cannot be bought alongside Standard at any price, and all of them concern storage and networking at cluster scale:</p><ul><li><strong>Storage Spaces Direct</strong> — builds shared storage from the servers’ own disks instead of buying a SAN. This one alone changes the cost of building a two-node cluster substantially.</li><li><strong>Storage Replica</strong> — block-level replication to a second site, with a test failover so a disaster-recovery plan can be rehearsed without a disaster.</li><li><strong>Software-defined networking</strong> — virtual networks, routing and firewalls managed as configuration rather than as hardware.</li><li><strong>Shielded virtual machines</strong> — encrypted so that even an administrator on the host cannot read the guest disk. This is what makes a hosting environment defensible to a customer.</li></ul><p>If you are not building distributed storage or hosting for somebody else, most of that list does not apply to you — and Standard is the correct and cheaper licence.</p>',
      },
      { type: 'heading', level: 2, text: 'Essentials: a cap instead of access licences' },
      {
        type: 'richText',
        html: '<p><strong>Essentials</strong> is not a smaller edition so much as a different licensing model: it needs no CALs at all. Its cap — 25 users and 50 devices — is the licensing itself.</p><p>For a small office this is the cheapest correct way to run a server, because access licences alongside Standard usually cost more than the server licence does. And it is a complete Windows Server underneath, not a cut-down one.</p><p>The limits are correspondingly tight: one physical server, one CPU socket up to 10 cores on the 2022 edition, 25 users and 50 devices <strong>enforced rather than advisory</strong>, and no virtualisation rights beyond running the host. Cross any of them and the licence is the wrong one.</p>',
      },
      { type: 'heading', level: 2, text: 'And before any arithmetic: per-core licensing' },
      {
        type: 'richText',
        html: '<p>Since the 2016 release, Windows Server is licensed by <strong>physical core</strong> rather than by socket — which is what ruins most upgrade costings coming from 2012.</p><p>The rule: a minimum of 8 cores per socket and 16 cores per server, and anything beyond that is bought in packs. A server with two 12-core processors needs a 24-core licence, not two socket licences.</p><p>Count the cores first, then compare Standard against Datacenter at your virtual machine count. In that order, not the reverse.</p>',
      },
      {
        type: 'specTable',
        title: 'Which edition',
        rows: [
          { label: 'Office up to 25 users', value: 'Essentials — no CALs' },
          { label: 'Host plus two virtual machines', value: 'Standard' },
          {
            label: 'Three virtual machines or more',
            value: 'Do the arithmetic — Datacenter converges, then wins',
          },
          { label: 'Distributed storage, or hosting', value: 'Datacenter, with no alternative' },
          { label: 'Access licences', value: 'Separate for every edition except Essentials' },
          { label: 'Licensing basis', value: 'Physical cores since 2016, not sockets' },
        ],
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Can I run more than two virtual machines on Standard?',
            a: 'Technically yes, but it requires buying an additional Standard licence for each further pair. Past a certain count, Datacenter costs less than repeating Standard.',
          },
          {
            q: 'Is performance different between Standard and Datacenter?',
            a: 'No. Same kernel, same performance. The difference is in licensing rights and in the cluster-scale storage and networking features.',
          },
          {
            q: 'I only need Storage Spaces Direct — can I add it to Standard?',
            a: 'No. It is exclusive to Datacenter and is not sold separately.',
          },
          {
            q: 'How many core licences does my server need?',
            a: 'A minimum of 8 per socket and 16 per server. Count the actual physical cores and round up to those minimums if you are below them.',
          },
        ],
      },
    ],
  },

  {
    slug: 'tpm-2-0-windows-11-requirements',
    title: 'Your PC will not take Windows 11? It is usually a setting, not the hardware',
    summary:
      'What blocks a Windows 11 install most often is TPM 2.0 and Secure Boot. On a great many machines from 2016 onward the chip is present but switched off in firmware — which makes the fix a setting that takes minutes rather than a new computer. This covers how to check, how to enable it, and what to do if the machine genuinely does not qualify.',
    seo: {
      title: 'TPM 2.0 and Windows 11: Check and Enable It',
      description:
        'The real Windows 11 requirements, how to tell whether a TPM is present but disabled, the BIOS steps to enable it, and what to do if it cannot qualify.',
    },
    products: ['windows-11-pro', 'windows-11-home', 'windows-10-pro', 'windows-10-home'],
    blocks: [
      {
        type: 'answerFirst',
        text: 'Windows 11 requires a TPM 2.0 chip, Secure Boot enabled, and a processor on Microsoft’s supported list. On many machines from 2016 onward the chip is present but disabled in firmware — so the fix is a BIOS setting that takes minutes, not a new computer.',
      },
      { type: 'heading', level: 2, text: 'The requirements, no more and no less' },
      {
        type: 'richText',
        html: '<ul><li><strong>TPM 2.0</strong> — a chip, or a function built into the processor, that stores encryption keys.</li><li><strong>Secure Boot</strong> supported and enabled — which requires <em>UEFI</em> boot mode rather than <em>Legacy/CSM</em>.</li><li>A <strong>64-bit processor</strong> on Microsoft’s supported list. This is the requirement that rules out most 2013–2016 machines, and the one no setting can fix.</li><li><strong>4 GB</strong> of RAM and <strong>64 GB</strong> of storage as a floor.</li><li>A DirectX 12 capable graphics adapter and a 720p or better display.</li></ul><p>Start with Microsoft’s free <strong>PC Health Check</strong>. It tells you which requirement fails specifically, which matters far more than knowing that one did.</p>',
      },
      { type: 'heading', level: 2, text: 'Is the chip even there? Check in a minute' },
      {
        type: 'richText',
        html: '<p>Press <strong>Win + R</strong>, type <code>tpm.msc</code> and press Enter. The Trusted Platform Module Management window opens.</p><p><strong>If it says "The TPM is ready for use"</strong> with specification version <strong>2.0</strong>, the chip is present and working — and something else is blocking the install, usually Secure Boot or the processor.</p><p><strong>If it says "Compatible TPM cannot be found"</strong>, there are two possibilities: the chip is absent, or — far more likely on a machine from 2016 or later — it is present and disabled in firmware. Do not conclude the first before checking the second.</p><p>To check Secure Boot: type <code>msinfo32</code> in the same Run box and look at the "Secure Boot State" and "BIOS Mode" lines. The second needs to read <strong>UEFI</strong>.</p>',
      },
      { type: 'heading', level: 2, text: 'Enabling it in the firmware' },
      {
        type: 'richText',
        html: '<p>The name in the menu differs by manufacturer, which is why people cannot find it:</p><ul><li>On <strong>AMD</strong> processors the setting is called <strong>fTPM</strong>, or <em>AMD fTPM switch</em>.</li><li>On <strong>Intel</strong> it is <strong>PTT</strong>, or <em>Intel Platform Trust Technology</em>.</li><li>It may also appear directly as <em>Security Device Support</em> or <em>TPM Device</em>.</li></ul><p>The steps: restart and press the key that opens firmware setup (Del, F2, F10 or F12 depending on the maker) → look under <em>Security</em> or <em>Advanced</em> → enable the setting → enable <strong>Secure Boot</strong> → save and exit.</p><p><strong>A warning that belongs before the instruction, not after it:</strong> if the drive is encrypted with BitLocker, suspend the encryption or save the recovery key <em>before</em> changing either setting — changing them makes Windows ask for the recovery key at boot. And if the machine is running in <em>Legacy/CSM</em> mode, switching to UEFI requires converting the disk to GPT first, which is an operation to perform after a backup rather than before one.</p>',
      },
      { type: 'heading', level: 2, text: 'If the machine genuinely does not qualify' },
      {
        type: 'richText',
        html: '<p>If the processor is off the supported list, no setting fixes that. Three honest paths:</p><p><strong>Stay on Windows 10 deliberately.</strong> The system runs and activates; free security updates ended in October 2025, and how much that matters depends on what the machine does. An isolated machine running one application carries close to no risk; one that browses and receives mail carries real risk.</p><p><strong>Upgrade one component.</strong> Some motherboards from that period have a <em>TPM header</em> that takes a chip bought separately and cheaply. Check your board’s manual before replacing the whole machine.</p><p><strong>A new machine.</strong> Buy Windows 11 Pro if you need BitLocker, Hyper-V or Remote Desktop hosting, and Home if you need none of them.</p><p>What we do not recommend: tricks that bypass the TPM check. They do install the system, but Microsoft does not guarantee updates will reach an unsupported install — so you end up on a "newer" operating system with a weaker update guarantee than supported Windows 10 had. That is the wrong trade.</p>',
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            q: 'Will enabling TPM erase my data?',
            a: 'Not normally. But if the drive is encrypted with BitLocker, Windows will ask for the recovery key at boot — so save the key or suspend encryption before making the change.',
          },
          {
            q: 'It reports TPM 1.2, not 2.0. Is that enough?',
            a: 'No, Windows 11 requires 2.0. Some machines move to 2.0 with a firmware update from the manufacturer, so look for a BIOS update for your exact model before writing the machine off.',
          },
          {
            q: 'Do I need a new key to upgrade from Windows 10?',
            a: 'No. Upgrading an activated Windows 10 machine to Windows 11 needs no new key — the licence carries across, provided the hardware meets the requirements.',
          },
          {
            q: 'What is the difference between a discrete TPM and fTPM?',
            a: 'A discrete TPM is a chip on the board; fTPM and PTT are functions inside the processor itself. Windows 11 accepts either as long as the version is 2.0, and for this purpose there is no practical difference.',
          },
        ],
      },
    ],
  },
];
