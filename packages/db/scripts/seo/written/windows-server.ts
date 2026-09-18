/**
 * Windows Server — twelve server editions and six RDS CAL products.
 *
 * The largest near-identical block left in the catalog, and the one where the
 * columns are least able to help. Every server edition in this catalog is a
 * lifetime licence for one machine activated online, and every CAL is a
 * lifetime key for fifty seats; a generator reading those columns produced
 * eighteen pages that differed by a version number.
 *
 * What a buyer is actually choosing between is none of that. It is how many
 * virtual machines the licence permits, whether the edition is capped at
 * twenty-five users, whether a CAL is needed at all on top, and — the question
 * that decides several of these — whether the version is still receiving
 * security updates. Those are facts about the product, not about the row, so
 * they are written here.
 *
 * Support dates are Microsoft's published lifecycle dates and are stated even
 * where they are inconvenient: 2008 and 2012 are out of extended support
 * entirely, and a shop selling a CAL for them should say so on the page rather
 * than leave a buyer to discover it.
 */
import type { Block } from '../body.js';

/** Shared explanation of the CAL model, phrased once per product around it. */
export const WINDOWS_SERVER: Record<string, Block[]> = {
  // --- the editions ----------------------------------------------------------

  'windows-server-2025-standard': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2025 Standard is the current release for a physical server running one or two virtualised workloads. It licenses the host plus two virtual machines; beyond that, Datacenter is the edition that stops counting.',
    },
    { type: 'heading', level: 2, text: 'What 2025 brought that 2022 did not' },
    {
      type: 'richText',
      html: '<p><strong>Hotpatching</strong> is the headline: security updates applied to a running server without a reboot, which turns a monthly maintenance window into something that no longer needs scheduling. <strong>SMB over QUIC</strong> reaches every edition, so a file share can be reached across the internet over an encrypted connection with no VPN in front of it.</p><p>Underneath, Active Directory gained its first database page-size change in decades and 64-bit support throughout, GPU partitioning lets one card be shared across virtual machines, and storage throughput on NVMe is substantially higher than 2022 on the same hardware.</p>',
    },
    { type: 'heading', level: 2, text: 'Standard or Datacenter' },
    {
      type: 'richText',
      html: '<p>The line is virtualisation. Standard permits <strong>two virtual instances</strong> plus the host; <a href="/en/store/windows-server-2025-datacenter">Datacenter</a> permits unlimited ones and adds Storage Spaces Direct, Storage Replica and software-defined networking. If you are running two VMs or fewer and not building a storage cluster, Standard is the correct and far cheaper licence.</p><p>Client access licences are separate for both. Every user or device connecting to this server needs one.</p>',
    },
  ],

  'windows-server-2025-datacenter': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2025 Datacenter is the edition for virtualisation at density: unlimited Windows virtual machines on the licensed host, plus the software-defined storage and networking features Standard does not include.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Unlimited virtual instances, and the features that come with them',
    },
    {
      type: 'richText',
      html: '<p>The virtualisation right is the reason to buy it — Standard permits two virtual machines, Datacenter permits as many as the hardware will carry. Past roughly three, Datacenter is the cheaper licence rather than the more expensive one.</p><p>What only Datacenter has: <strong>Storage Spaces Direct</strong>, which builds a shared storage pool out of the servers own disks instead of a SAN. <strong>Storage Replica</strong> for block-level replication to a second site. <strong>Software-defined networking</strong>, and <strong>shielded virtual machines</strong>, which encrypt a VM so that even an administrator on the host cannot read its disk.</p>',
    },
    { type: 'heading', level: 2, text: '2025 specifically' },
    {
      type: 'richText',
      html: '<p>Hotpatching applies security updates without rebooting, which matters more on a host carrying twenty virtual machines than on any single server. GPU partitioning divides one card across guests. Mainstream support runs to October 2029 and extended support to October 2034 — the longest window of any version in this catalog.</p>',
    },
  ],

  'windows-server-2022-standard': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2022 Standard licenses one physical server plus two virtual machines, and is the version that introduced secured-core server — firmware protection, virtualisation-based security and TLS 1.3 on by default.',
    },
    { type: 'heading', level: 2, text: 'Secured-core, and why it was the point of this release' },
    {
      type: 'richText',
      html: '<p>2022 moved the security boundary below the operating system. <strong>Secured-core server</strong> combines TPM 2.0, Secure Boot and System Guard so that firmware is verified before Windows loads — the layer that ordinary antivirus cannot see into. <strong>TLS 1.3 is enabled by default</strong>, and <strong>SMB over QUIC</strong> arrived here first, letting a file share be reached across the internet without a VPN.</p><p>For most administrators the practical change was AES-256 encryption for SMB and the end of having to configure half of this by policy.</p>',
    },
    { type: 'heading', level: 2, text: 'Still in support, and for how long' },
    {
      type: 'richText',
      html: '<p>Mainstream support runs to <strong>October 2026</strong> and extended support to October 2031, so this is a version you can deploy today and keep patched for years. Two virtual instances are included; for more, see <a href="/en/store/windows-server-2022-datacenter">Datacenter</a>. CALs are separate.</p>',
    },
  ],

  'windows-server-2022-datacenter': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2022 Datacenter removes the virtual-machine limit and adds the software-defined storage and networking stack — Storage Spaces Direct, Storage Replica, shielded VMs — on top of everything Standard includes.',
    },
    { type: 'heading', level: 2, text: 'When the licence pays for itself' },
    {
      type: 'richText',
      html: '<p>At two virtual machines Standard is cheaper. At four or more, Datacenter usually is, because Standard has to be bought again for each additional pair of instances while Datacenter is bought once for the host. That arithmetic, rather than any feature, is why most virtualisation hosts run Datacenter.</p><p>The features follow from the same use: <strong>Storage Spaces Direct</strong> pools local disks across nodes into shared storage without a SAN, <strong>Storage Replica</strong> mirrors volumes to another site, and <strong>shielded virtual machines</strong> encrypt a guest so that an administrator on the host cannot read it — which is what makes a hosted environment defensible.</p>',
    },
    { type: 'heading', level: 2, text: 'Support window' },
    {
      type: 'richText',
      html: '<p>Mainstream support to <strong>October 2026</strong>, extended to October 2031. Every user or device connecting still needs a CAL, and Remote Desktop access needs an RDS CAL on top of that.</p>',
    },
  ],

  'windows-server-2022-essential': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2022 Essentials is the small-business edition: one physical server, up to 25 users and 50 devices, and — the part that decides it — no client access licences to buy at all.',
    },
    { type: 'heading', level: 2, text: 'No CALs, which is the whole economy of it' },
    {
      type: 'richText',
      html: '<p>Standard and Datacenter require a client access licence for every user or device that touches the server, and for a twenty-person office those licences cost more than the server licence does. Essentials includes them: the 25-user, 50-device cap <em>is</em> the licensing, and there is nothing further to buy.</p><p>It is a full Windows Server underneath — Active Directory, file and print services, DNS, DHCP, Hyper-V — not a reduced product.</p>',
    },
    { type: 'heading', level: 2, text: 'The limits, stated plainly' },
    {
      type: 'richText',
      html: '<p>One physical server, <strong>one CPU socket and up to 10 cores</strong>, 25 users, 50 devices, and no virtualisation rights beyond running the host itself. Cross any of those and the licence is the wrong one — <a href="/en/store/windows-server-2022-standard">Standard</a> plus CALs is the next step up. Below them, it is the cheapest correct way to run a server for a small office.</p>',
    },
  ],

  'windows-server-2019-standard': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2019 Standard licenses one server plus two virtual machines. It is the version that brought Windows Admin Center, System Insights and Storage Migration Service, and it remains in extended support until January 2029.',
    },
    { type: 'heading', level: 2, text: 'The release that changed how servers are managed' },
    {
      type: 'richText',
      html: '<p><strong>Windows Admin Center</strong> arrived with 2019 and replaced a scattering of MMC consoles with one browser-based tool that manages servers, clusters and hyper-converged infrastructure from anywhere. <strong>Storage Migration Service</strong> moves shares, permissions and even the server identity off an old file server onto a new one — which is the job most 2019 deployments were actually bought to do.</p><p><strong>System Insights</strong> added local forecasting for capacity, and Storage Spaces Direct gained deduplication for ReFS.</p>',
    },
    { type: 'heading', level: 2, text: 'Where it stands now' },
    {
      type: 'richText',
      html: '<p>Mainstream support ended in January 2024; <strong>extended support runs to January 2029</strong>, so it still receives security updates. It is a reasonable choice when you are matching an existing estate or when application vendors certify against 2019 and not 2022. For a new deployment with no such constraint, <a href="/en/store/windows-server-2022-standard">2022</a> buys four more years of the same support.</p>',
    },
  ],

  'windows-server-2019-datacenter': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2019 Datacenter lifts the virtual-machine limit and adds Storage Spaces Direct, Storage Replica and shielded VMs. Extended support runs to January 2029.',
    },
    { type: 'heading', level: 2, text: 'Datacenter on 2019' },
    {
      type: 'richText',
      html: '<p>Unlimited Windows virtual instances on the licensed host, against Standard’s two — the only difference that matters at purchase, and the reason a virtualisation host is licensed this way.</p><p>2019 was the release where <strong>Storage Spaces Direct</strong> matured: deduplication and compression on ReFS volumes, performance history built in, and two-node clusters that a small business could actually afford. <strong>Storage Replica</strong> gained a test failover so a disaster-recovery plan could be rehearsed without a disaster.</p>',
    },
    { type: 'heading', level: 2, text: 'Choosing 2019 deliberately' },
    {
      type: 'richText',
      html: '<p>Extended support to <strong>January 2029</strong> means security updates continue. Pick it to match an existing cluster — mixing versions inside one Storage Spaces Direct cluster is not supported — or where an application vendor certifies 2019 and nothing later. Otherwise <a href="/en/store/windows-server-2022-datacenter">2022</a> is the longer-lived licence.</p>',
    },
  ],

  'windows-server-2019-essential': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2019 Essentials is the small-business edition: one server, up to 25 users and 50 devices, with no client access licences to buy. Extended support runs to January 2029.',
    },
    { type: 'heading', level: 2, text: 'What you are buying instead of CALs' },
    {
      type: 'richText',
      html: '<p>The cap is the licence. Standard requires a CAL for every user or device; Essentials includes access for 25 users and 50 devices in the purchase price, which for a small office is usually less than the CALs alone would cost.</p><p>Underneath it is a complete Windows Server — Active Directory, DNS, DHCP, file and print services, Hyper-V, Remote Desktop for administration. 2019 also dropped the old Essentials Experience role, so it installs and behaves like any other Windows Server rather than through a wizard.</p>',
    },
    { type: 'heading', level: 2, text: 'The limits' },
    {
      type: 'richText',
      html: '<p>One physical server, up to <strong>two CPU sockets</strong>, 25 users, 50 devices, and no virtualisation rights beyond the host. Those numbers are enforced, not advisory: the twenty-sixth user cannot sign in. If your office is near the ceiling now, <a href="/en/store/windows-server-2019-standard">Standard</a> plus CALs is the licence that will still fit next year.</p>',
    },
  ],

  'windows-server-2016-standard': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2016 Standard licenses one server plus two virtual machines. It introduced containers and Nano Server and moved licensing from per-socket to per-core. Extended support ends in January 2027.',
    },
    { type: 'heading', level: 2, text: 'The release that changed the licensing model' },
    {
      type: 'richText',
      html: '<p>2016 is where Windows Server began to be licensed <strong>per physical core</strong> rather than per socket — a change that still catches people costing an upgrade from 2012. It also brought <strong>Windows containers</strong> and Hyper-V containers, Storage Spaces Direct in its first form, and shielded virtual machines.</p><p>For most estates the lasting change was nested virtualisation, which made it possible to run Hyper-V inside a virtual machine and therefore to build a test lab on one box.</p>',
    },
    { type: 'heading', level: 2, text: 'Its support window is closing' },
    {
      type: 'richText',
      html: '<p>Mainstream support ended in January 2022 and <strong>extended support ends on 12 January 2027</strong>. It still receives security updates until then, which makes it viable for a specific compatibility need and a poor choice for a new deployment — <a href="/en/store/windows-server-2022-standard">2022</a> is supported five years longer for a comparable price.</p>',
    },
  ],

  'windows-server-2016-datacenter': [
    {
      type: 'answerFirst',
      text: 'Windows Server 2016 Datacenter removes the virtual-machine limit and was the first version to include Storage Spaces Direct and shielded virtual machines. Extended support ends in January 2027.',
    },
    { type: 'heading', level: 2, text: 'Where the modern Datacenter feature set began' },
    {
      type: 'richText',
      html: '<p>Unlimited Windows virtual instances on the host, as against Standard’s two. 2016 is also where <strong>Storage Spaces Direct</strong> first shipped — building shared cluster storage from the servers’ own disks instead of a SAN — and where <strong>shielded VMs</strong> introduced guest encryption that a host administrator cannot bypass.</p><p>Licensing moved to a per-core model with this release, and nested virtualisation arrived, making a full Hyper-V lab possible on a single machine.</p>',
    },
    { type: 'heading', level: 2, text: 'Buy it for a reason, not by default' },
    {
      type: 'richText',
      html: '<p><strong>Extended support ends 12 January 2027.</strong> Security updates continue until that date and then stop. The sound reasons to choose it are matching an existing 2016 cluster or an application certified against it; otherwise <a href="/en/store/windows-server-2022-datacenter">2022</a> or <a href="/en/store/windows-server-2025-datacenter">2025</a> give a far longer runway.</p>',
    },
  ],

  // --- RDS client access licences -------------------------------------------

  'windows-server-2025-rds-device-user': [
    {
      type: 'answerFirst',
      text: 'An RDS client access licence for Windows Server 2025: the separate licence that lets people connect to the server as a remote desktop. Windows Server allows two administrative sessions out of the box — everything beyond that needs one of these per user or per device.',
    },
    { type: 'heading', level: 2, text: 'Three licences, not one' },
    {
      type: 'richText',
      html: '<p>Running a remote desktop server correctly means holding three things at once, and the second and third are what people miss. The <strong>server licence</strong> for Windows Server itself. A <strong>Windows Server CAL</strong> for each user or device that touches the server at all. And an <strong>RDS CAL</strong> on top of that for each one that connects as a desktop.</p><p>Without RDS CALs the Remote Desktop Session Host runs for a 120-day grace period and then refuses connections — which is how most administrators discover the requirement.</p>',
    },
    { type: 'heading', level: 2, text: 'Per device or per user' },
    {
      type: 'richText',
      html: '<p><strong>Per Device</strong> suits shift work: one licence per terminal, shared by everyone who sits at it. <strong>Per User</strong> suits mobile staff: one licence per person, used from a laptop, a tablet and a home machine. Count whichever number is smaller.</p><p>The licence is installed on the Remote Desktop Licensing role, not on the clients, and issued from there.</p>',
    },
  ],

  'windows-server-2022-rds-device-user': [
    {
      type: 'answerFirst',
      text: 'An RDS client access licence for Windows Server 2022, required for each user or device connecting as a remote desktop. It is a separate purchase from the server licence and from the ordinary Windows Server CAL.',
    },
    { type: 'heading', level: 2, text: 'What it licenses, and the 120-day trap' },
    {
      type: 'richText',
      html: '<p>Windows Server permits two simultaneous sessions for administration. A Remote Desktop Session Host serving actual users is a different thing, and every seat on it needs an RDS CAL.</p><p>Install the Remote Desktop Licensing role without CALs and it works for <strong>120 days</strong>, then stops accepting connections. There is no warning proportional to the disruption, and the grace period cannot be restarted — which is why the licences are usually bought in the same week as the server.</p>',
    },
    { type: 'heading', level: 2, text: 'Version has to match' },
    {
      type: 'richText',
      html: '<p>RDS CALs are not forward-compatible: a 2022 CAL licenses a 2022 session host and older ones, but a 2019 CAL will not license a 2022 host. Buy the CAL for the newest server version you run. Per Device suits shared terminals; Per User suits people who connect from several machines.</p>',
    },
  ],

  'windows-server-2019-rds-device-user': [
    {
      type: 'answerFirst',
      text: 'An RDS client access licence for Windows Server 2019, required per user or per device for remote desktop access. It licenses 2019 session hosts and earlier — not 2022 or 2025.',
    },
    { type: 'heading', level: 2, text: 'Matching the CAL to the server' },
    {
      type: 'richText',
      html: '<p>This is the rule that decides which of these products you need. An RDS CAL licenses its own version and every version below it, and nothing above: a 2019 CAL covers a 2019 or 2016 session host, and will not cover a 2022 one. Upgrading the server means buying CALs again.</p><p>Choose 2019 CALs when 2019 is the newest Remote Desktop host you run. If any host is 2022 or 2025, buy for that version instead — it covers the older hosts too.</p>',
    },
    { type: 'heading', level: 2, text: 'Per device or per user' },
    {
      type: 'richText',
      html: '<p>Per Device licenses the machine and everyone who uses it — right for a shop floor or a call centre on shifts. Per User licenses the person across every machine they connect from — right for staff with a desk, a laptop and a phone. The two cannot be mixed within one licensing mode on the same server.</p>',
    },
  ],

  'windows-server-2016-rds-device-user': [
    {
      type: 'answerFirst',
      text: 'An RDS client access licence for Windows Server 2016, required per user or per device for remote desktop access. It covers 2016 session hosts and earlier, and expires alongside the platform in January 2027.',
    },
    { type: 'heading', level: 2, text: 'What it covers' },
    {
      type: 'richText',
      html: '<p>A 2016 RDS CAL licenses a 2016 Remote Desktop Session Host, and every older one. It will not license 2019 or later — RDS CALs never license upward.</p><p>Buy at this version when 2016 is the newest session host you operate. Because Windows Server 2016 leaves extended support on <strong>12 January 2027</strong>, a new remote desktop deployment is better served by a 2022 or 2025 CAL, which covers 2016 hosts as well and does not need buying again at the upgrade.</p>',
    },
    { type: 'heading', level: 2, text: 'Per device or per user' },
    {
      type: 'richText',
      html: '<p>Per Device for shared terminals, Per User for people connecting from several machines. The licences are installed on the Remote Desktop Licensing role and issued from there; the clients need nothing installed.</p>',
    },
  ],

  'windows-server-2012-rds-device-user': [
    {
      type: 'answerFirst',
      text: 'An RDS client access licence for Windows Server 2012, per user or per device. Windows Server 2012 left extended support on 10 October 2023 and receives no further security updates, which should be weighed before extending a deployment on it.',
    },
    { type: 'heading', level: 2, text: 'The platform is out of support' },
    {
      type: 'richText',
      html: '<p>Windows Server 2012 and 2012 R2 stopped receiving security updates on <strong>10 October 2023</strong>. The server runs, the licence is valid, and a remote desktop host is by definition reachable from elsewhere — which makes an unpatched one a harder thing to defend than an unpatched file server.</p><p>Buy this CAL where the deployment is fixed: a line-of-business application that will not run on anything newer, a machine on an isolated network, or a system being kept alive until a migration completes.</p>',
    },
    { type: 'heading', level: 2, text: 'If the deployment is not fixed' },
    {
      type: 'richText',
      html: '<p>A <a href="/en/store/windows-server-2022-rds-device-user">2022 RDS CAL</a> licenses a 2012 session host as well as a current one, because CALs cover their own version and every version below. Buying at the newer version costs more now and nothing at the upgrade.</p>',
    },
  ],

  'windows-server-2012-r2-rds-device': [
    {
      type: 'answerFirst',
      text: 'An RDS Device client access licence for Windows Server 2012 R2 — one licence per connecting terminal, shared by everyone who uses it. The platform left extended support on 10 October 2023.',
    },
    { type: 'heading', level: 2, text: 'Per Device, specifically' },
    {
      type: 'richText',
      html: '<p>A Device CAL licenses the machine rather than the person. Ten terminals used across three shifts by thirty staff need ten Device CALs, where Per User would need thirty. Anywhere hardware is shared and people are not — a shop floor, a dispatch desk, a clinic reception — this is the cheaper side of the choice by a wide margin.</p><p>The reverse is also true: one person connecting from a desktop, a laptop and a tablet consumes three Device CALs and would have needed one User CAL.</p>',
    },
    { type: 'heading', level: 2, text: 'Support ended in 2023' },
    {
      type: 'richText',
      html: '<p>Windows Server 2012 R2 receives no security updates after <strong>10 October 2023</strong>. For a remote desktop host reachable from outside the network, that is a real exposure. Where the deployment can move, a <a href="/en/store/windows-server-2022-rds-device-user">2022 CAL</a> covers both this host and a current one.</p>',
    },
  ],

  'windows-server-2008-rds-user': [
    {
      type: 'answerFirst',
      text: 'An RDS User client access licence for Windows Server 2008 — one licence per person, across every device they connect from. Windows Server 2008 and 2008 R2 left extended support on 14 January 2020.',
    },
    { type: 'heading', level: 2, text: 'A licence for a system being kept running' },
    {
      type: 'richText',
      html: '<p>Windows Server 2008 has been out of support since <strong>14 January 2020</strong> — more than six years without a security update. Nobody deploys it now; the licence exists for estates that still have one running, usually because a single application will not move and its vendor no longer exists to port it.</p><p>If that is the situation, this is the correct CAL and the honest reason to buy it. If it is not, nothing about 2008 recommends it.</p>',
    },
    { type: 'heading', level: 2, text: 'Per User' },
    {
      type: 'richText',
      html: '<p>A User CAL follows the person: one licence covers them from a desktop, a laptop and a home machine. It is the right side of the choice wherever staff outnumber the terminals they use, and the wrong one where a few shared machines carry many people.</p>',
    },
  ],
};
