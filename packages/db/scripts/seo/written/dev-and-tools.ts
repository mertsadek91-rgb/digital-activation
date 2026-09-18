/**
 * Virtualisation, development tools, and the remaining singles.
 *
 * The last group, and the least alike — which is why the generator's output
 * here was the most misleading. Parallels and VMware both run one operating
 * system inside another and are chosen for opposite reasons; three Visual
 * Studio editions differ by a licensing rule rather than a feature list; and
 * the two bundles are the only products in the catalog whose value is the
 * combination itself.
 */
import type { Block } from '../body.js';

export const DEV_AND_TOOLS: Record<string, Block[]> = {
  // --- virtualisation --------------------------------------------------------

  'parallels-desktop-26-standard': [
    {
      type: 'answerFirst',
      text: 'Parallels Desktop 26 runs Windows on a Mac — including Apple Silicon — in a window beside macOS, with no reboot. Standard is the home edition: one virtual machine at a time, up to 8 GB of memory and 4 processor cores assigned to it.',
    },
    { type: 'heading', level: 2, text: 'Windows on a Mac, without restarting' },
    {
      type: 'richText',
      html: '<p>Boot Camp does not exist on Apple Silicon, so virtualisation is the only route to Windows on a modern Mac. Parallels runs ARM Windows in a window, and <strong>Coherence mode</strong> drops the window entirely — Windows applications appear on the macOS Dock and in Mission Control like native ones.</p><p>Files, clipboard, printers and displays are shared between the two, so a document on the Mac desktop opens in a Windows application without being copied anywhere.</p>',
    },
    { type: 'heading', level: 2, text: 'The limits of Standard' },
    {
      type: 'richText',
      html: '<p>Standard assigns up to <strong>8 GB of memory and 4 cores</strong> to a virtual machine, and runs one at a time. That is ample for Office, a line-of-business application or a Windows-only accounting package.</p><p>It is not enough for a development environment, a database, or running two systems at once — <a href="/en/store/parallels-desktop-26-pro">Pro</a> raises the ceilings substantially and adds the developer tooling.</p>',
    },
  ],

  'parallels-desktop-26-pro': [
    {
      type: 'answerFirst',
      text: 'Parallels Desktop 26 Pro raises the virtual machine limits far above Standard — up to 128 GB of memory and 32 cores per machine — and adds the developer tooling: network conditioner, snapshots, Visual Studio and JetBrains integration, and a command-line interface.',
    },
    { type: 'heading', level: 2, text: 'What the Pro tooling is for' },
    {
      type: 'richText',
      html: '<p><strong>Snapshots</strong> are the feature that changes how you work: capture a machine’s exact state, break it deliberately, roll back in seconds. Testing an installer, a driver or an upgrade stops being a thing you do carefully.</p><p><strong>Network conditioner</strong> simulates a slow or lossy connection, so an application can be tested against the network real users have. <strong>Visual Studio and JetBrains plugins</strong> build and debug into a virtual machine from the IDE on the Mac side, and the <strong>prlctl</strong> command line lets machines be created and controlled from a script.</p>',
    },
    { type: 'heading', level: 2, text: 'Pro or Business' },
    {
      type: 'richText',
      html: '<p>Pro is licensed per person and is the right edition for a developer or tester working alone. <a href="/en/store/parallels-desktop-26-business">Business</a> adds centralised management, volume licence keys and a unified administration console — worth it when an IT department is deploying to a team, and worth nothing when it is not.</p>',
    },
  ],

  'parallels-desktop-26-business': [
    {
      type: 'answerFirst',
      text: 'Parallels Desktop 26 Business is the managed edition: everything in Pro, plus centralised deployment, a single volume licence key for the whole organisation, an administration console, and policies pushed to every Mac.',
    },
    { type: 'heading', level: 2, text: 'Built for deploying, not for one desk' },
    {
      type: 'richText',
      html: '<p><strong>One volume key</strong> for the organisation rather than a licence per machine, so seats can be assigned and reclaimed as staff and hardware change. The <strong>Management Portal</strong> shows every installation, its licence and its virtual machines from one page.</p><p><strong>Unified Volume License Key</strong> deployment lets a prepared virtual machine be pushed to a fleet — every new starter gets the same configured Windows without anyone building it by hand. Policies can lock down what users may change, which is the point at which this stops being a power tool and becomes managed software.</p>',
    },
    { type: 'heading', level: 2, text: 'It includes everything in Pro' },
    {
      type: 'richText',
      html: '<p>The same raised limits — up to 128 GB of memory and 32 cores per virtual machine — plus snapshots, network conditioner, IDE integration and the command line. If there is no fleet to manage, <a href="/en/store/parallels-desktop-26-pro">Pro</a> is the same capability without the administration layer.</p>',
    },
  ],

  'vmware-workstation-pro-17-for-windows-linux': [
    {
      type: 'answerFirst',
      text: 'VMware Workstation Pro 17 runs multiple virtual machines side by side on a Windows or Linux PC — Windows, Linux and BSD guests, connected networks between them, snapshots and clones. It is the tool for building an environment rather than running one extra system.',
    },
    { type: 'heading', level: 2, text: 'Several machines, and the network between them' },
    {
      type: 'richText',
      html: '<p>The distinction from a desktop virtualisation tool is that Workstation expects more than one guest. <strong>Virtual networks</strong> let you build a topology on one PC — a domain controller, a server and two clients on their own subnet — which is how most people learn and test infrastructure without buying any.</p><p><strong>Snapshots</strong> branch into a tree, not a single point, so several states of the same machine can be kept and returned to. <strong>Linked clones</strong> spin up a copy that shares the parent’s disk, so twenty machines cost the space of one and change.</p>',
    },
    { type: 'heading', level: 2, text: 'Who it suits' },
    {
      type: 'richText',
      html: '<p>Developers testing across operating systems, administrators rehearsing a migration, students working through certification labs, and anyone who needs a disposable environment that can be reset to a known state. On a Mac, <a href="/en/store/vmware-fusion-pro-13-for-mac">VMware Fusion Pro</a> is the same idea for that platform.</p>',
    },
  ],

  'vmware-fusion-pro-13-for-mac': [
    {
      type: 'answerFirst',
      text: 'VMware Fusion Pro 13 runs Windows and Linux virtual machines on a Mac, including Apple Silicon, with snapshots, virtual networks and linked clones — the VMware tooling rather than a consumer virtualisation layer.',
    },
    { type: 'heading', level: 2, text: 'VMware on the Mac' },
    {
      type: 'richText',
      html: '<p>Fusion Pro 13 supports <strong>Windows 11 on Apple Silicon</strong> with a virtual TPM, which is what makes a licensed, supported Windows possible on an M-series Mac. On Intel Macs it runs the full range of guests.</p><p>The Pro tooling is where it separates from simpler options: <strong>snapshot trees</strong> rather than a single restore point, <strong>linked clones</strong> that share a parent disk so a lab of machines costs the space of one, custom <strong>virtual networks</strong> between guests, and a REST API for driving machines from a script.</p>',
    },
    { type: 'heading', level: 2, text: 'Fusion or Parallels' },
    {
      type: 'richText',
      html: '<p>Parallels is smoother for running a Windows application beside macOS — Coherence mode and the desktop integration are better. Fusion is the choice when the virtual machines themselves are the work: several at once, on their own network, with snapshot trees, and configured the same way as VMware infrastructure elsewhere.</p>',
    },
  ],

  // --- Visual Studio ---------------------------------------------------------

  'visual-studio-2022-professional': [
    {
      type: 'answerFirst',
      text: 'Visual Studio 2022 Professional is the full IDE for .NET, C++ and cross-platform development on Windows — the first 64-bit release, so it handles very large solutions without running out of memory the way earlier versions did.',
    },
    { type: 'heading', level: 2, text: 'The release that went 64-bit' },
    {
      type: 'richText',
      html: '<p>Every Visual Studio before 2022 was a 32-bit process and capped at roughly 4 GB however much memory the machine had. On a solution with hundreds of projects that ceiling was reached daily. 2022 removed it, and for large codebases that single change is the reason to be on this version.</p><p>Alongside it: <strong>Hot Reload</strong>, which applies code edits to a running application without restarting it, and <strong>IntelliCode</strong> completions trained on whole-line context rather than one symbol.</p>',
    },
    { type: 'heading', level: 2, text: 'Professional against Enterprise' },
    {
      type: 'richText',
      html: '<p>Professional has the complete editor, debugger, profiler and designers — everything needed to write and ship software. <a href="/en/store/visual-studio-2022-enterprise">Enterprise</a> adds the testing and analysis tier: Live Unit Testing, IntelliTest, Code Map, and architectural validation. Those are team-scale tools; for an individual developer or a small team, Professional is the correct licence.</p>',
    },
  ],

  'visual-studio-2022-enterprise': [
    {
      type: 'answerFirst',
      text: 'Visual Studio 2022 Enterprise adds the testing, profiling and architecture tier to Professional: Live Unit Testing, IntelliTest, Code Map, dependency validation and the full memory and performance profilers.',
    },
    { type: 'heading', level: 2, text: 'What only Enterprise has' },
    {
      type: 'richText',
      html: '<p><strong>Live Unit Testing</strong> runs the affected tests as you type and marks each line in the editor as covered, passing or failing — the difference between knowing your tests pass and knowing which line broke them. <strong>IntelliTest</strong> generates test cases and inputs from the code itself, which is how coverage gets built over code nobody wrote tests for at the time.</p><p><strong>Code Map</strong> and <strong>dependency validation</strong> draw the real structure of a solution and fail the build when a layer is violated — the only practical way to hold an architecture in place across a team over years.</p>',
    },
    { type: 'heading', level: 2, text: 'Who needs this tier' },
    {
      type: 'richText',
      html: '<p>Teams maintaining a large long-lived codebase, and anyone under a coverage or architectural requirement they must demonstrate rather than assert. For writing and shipping software without those obligations, <a href="/en/store/visual-studio-2022-professional">Professional</a> is the same editor, debugger and designers for much less.</p>',
    },
  ],

  'visual-studio-2026-professional': [
    {
      type: 'answerFirst',
      text: 'Visual Studio 2026 Professional is the current release of the Windows IDE, licensed against a Microsoft account rather than a standalone key — the full editor, debugger, profiler and designers for .NET, C++ and cross-platform work.',
    },
    { type: 'heading', level: 2, text: 'The current release' },
    {
      type: 'richText',
      html: '<p>Being on the current IDE matters more than it does for most software, because the toolchain moves with it: the newest .NET and C++ targets, current SDKs, and the debugger and profiler work that each release brings. A project started on the current version is one that will not need the IDE upgraded before it can adopt a new framework.</p><p>It carries forward what 2022 established — a 64-bit process with no 4 GB ceiling, Hot Reload for editing a running application, and whole-line IntelliCode completion.</p>',
    },
    { type: 'heading', level: 2, text: 'Licensed to your Microsoft account' },
    {
      type: 'richText',
      html: '<p>This edition binds to the <strong>Microsoft account you name at checkout</strong> rather than being entered as a product key. Sign in to Visual Studio with that account and the licence is present; it follows the account to a new machine rather than staying with the old one.</p><p>Give the account you actually develop under, and keep access to it — the licence lives there.</p>',
    },
  ],

  // --- the remaining singles -------------------------------------------------

  'autodesk-all-apps': [
    {
      type: 'answerFirst',
      text: 'Autodesk All Apps is the collection subscription: AutoCAD, Revit, Civil 3D, Inventor, 3ds Max, Maya, Fusion and the rest of Autodesk’s catalogue under one licence, rather than each product bought separately.',
    },
    { type: 'heading', level: 2, text: 'Why a collection instead of one product' },
    {
      type: 'richText',
      html: '<p>Autodesk products are expensive individually and a real project rarely uses only one. A building goes through <strong>Revit</strong> for the model, <strong>AutoCAD</strong> for the drawings, <strong>Civil 3D</strong> for the site, and <strong>Navisworks</strong> for clash detection. A product design moves between <strong>Inventor</strong>, <strong>Fusion</strong> and <strong>3ds Max</strong> for the visual.</p><p>Bought separately, any two of those cost more than the collection. That is the whole arithmetic, and it is why firms buy this rather than a product.</p>',
    },
    { type: 'heading', level: 2, text: 'How it is licensed and delivered' },
    {
      type: 'richText',
      html: '<p>This arrives as a <strong>redeem code against an Autodesk account</strong>, so checkout asks which email address it should be attached to. Once redeemed, every application in the collection is available to download and install from that account, and your licence follows the account rather than the machine.</p>',
    },
  ],

  'canva-pro': [
    {
      type: 'answerFirst',
      text: 'Canva Pro unlocks the paid side of Canva: the premium template, photo, video and audio library, one-click background removal, brand kits, Magic Resize, and scheduling for social posts — all in the browser with nothing to install.',
    },
    { type: 'heading', level: 2, text: 'What the paid tier is actually for' },
    {
      type: 'richText',
      html: '<p>Three features carry the subscription for most people. The <strong>background remover</strong> replaces the commonest reason a non-designer opens an image editor. <strong>Brand kit</strong> fixes a logo, a palette and two fonts so every design starts consistent instead of being rebuilt from memory. <strong>Magic Resize</strong> turns one finished design into every other size it is needed in — a post, a story, a banner, a cover — in a click rather than a morning.</p><p>Beyond those: the full premium library rather than the free subset, unlimited folders, version history, and scheduling posts directly to connected social accounts.</p>',
    },
    { type: 'heading', level: 2, text: 'Pro or Education' },
    {
      type: 'richText',
      html: '<p>Pro is the plan for a business, a freelancer or anyone producing marketing material. <a href="/en/store/canva-edu">Canva Edu</a> adds the classroom side — a shared class workspace, assignments and student collaboration — which is worth nothing outside teaching and is the right plan inside it.</p>',
    },
  ],

  'elementor-pro': [
    {
      type: 'answerFirst',
      text: 'Elementor Pro is the paid tier of the WordPress page builder: the theme builder, form builder, WooCommerce widgets, popup builder and dynamic content that connect a visually built page to the data behind it.',
    },
    { type: 'heading', level: 2, text: 'What Pro adds to the free plugin' },
    {
      type: 'richText',
      html: '<p>Free Elementor builds pages. Pro builds the <strong>site</strong>. The <strong>Theme Builder</strong> is the dividing line: header, footer, single post template, archive template and 404 page all designed visually, so a site stops being a theme with some Elementor pages inside it.</p><p><strong>Dynamic content</strong> is the other half — a template that pulls the title, featured image, price or custom field from each post, so one design serves five hundred products. Plus the <strong>form builder</strong> with mail and CRM integrations, <strong>popup builder</strong> with display rules, and the <strong>WooCommerce widgets</strong> that make a shop layout editable without code.</p>',
    },
    { type: 'heading', level: 2, text: 'How the licence works' },
    {
      type: 'richText',
      html: '<p>Elementor Pro is licensed per site and activated from your WordPress dashboard. The licence covers updates and the template library for its term; when it lapses the site keeps working and stops receiving updates — which for a security-sensitive plugin is a reason to keep it current.</p>',
    },
  ],

  'starter-bundle-windows-11-pro-office-365': [
    {
      type: 'answerFirst',
      text: 'The Starter Bundle is a new machine’s two licences bought together: Windows 11 Pro to activate the system permanently, and an Office 365 account for the desktop Office applications with a subscription that keeps them current.',
    },
    { type: 'heading', level: 2, text: 'What a machine needs on the first day' },
    {
      type: 'richText',
      html: '<p>These are the two purchases that follow almost every PC build or reinstall, and buying them together is cheaper than buying them apart.</p><p><strong>Windows 11 Pro</strong> activates the system permanently and brings BitLocker drive encryption, Hyper-V, Remote Desktop hosting and Group Policy — the features Home does not have. <strong>Office 365</strong> arrives as account credentials rather than a key, installs the full desktop Word, Excel, PowerPoint and Outlook, and keeps receiving new versions for as long as the term runs.</p>',
    },
    { type: 'heading', level: 2, text: 'Two different things arrive' },
    {
      type: 'richText',
      html: '<p>Worth knowing before the email lands: the Windows part is an <strong>activation key</strong> you enter in Settings, and the Office part is a <strong>username and password</strong> you sign in to Office with. They are activated in different places and neither substitutes for the other.</p><p>Check the hardware first — Windows 11 requires TPM 2.0 and Secure Boot.</p>',
    },
  ],

  'protection-bundle-windows-11-pro-office-365-mcafee': [
    {
      type: 'answerFirst',
      text: 'The Protection Bundle is the Starter Bundle with security added: Windows 11 Pro, an Office 365 account, and a McAfee subscription covering the machine and the phones and tablets around it.',
    },
    { type: 'heading', level: 2, text: 'The three licences, and what each covers' },
    {
      type: 'richText',
      html: '<p><strong>Windows 11 Pro</strong> activates the system permanently and adds BitLocker, Hyper-V, Remote Desktop hosting and Group Policy over Home. <strong>Office 365</strong> installs the desktop Word, Excel, PowerPoint and Outlook and keeps them current for the term. <strong>McAfee</strong> covers antivirus, firewall, web protection and a password manager, across Windows, Mac, Android and iOS rather than this machine alone.</p><p>That last point is what separates this bundle from the Starter one: the security licence is the only part of the purchase that protects anything other than the PC it was bought for.</p>',
    },
    { type: 'heading', level: 2, text: 'Setting it up in the right order' },
    {
      type: 'richText',
      html: '<p>Activate Windows first, sign in to Office second, install McAfee last — antivirus installed before the system is activated and updated is the usual cause of a first-day conflict.</p><p>Three different things arrive: a Windows key, an Office username and password, and a McAfee subscription. Each is activated in its own place.</p>',
    },
  ],
};
