/**
 * FAQs for Windows Server — ten editions and seven CAL products.
 *
 * Server licensing is where this catalog's buyers go wrong most expensively,
 * and three questions account for nearly all of it: whether CALs are a separate
 * purchase (they are, except on Essentials), how many virtual machines the
 * edition permits, and whether a CAL bought for one version covers a newer one
 * (it does not). Every page in this family answers the ones that apply to it.
 *
 * The out-of-support versions answer a fourth question directly rather than
 * leaving it to be discovered: 2008 has had no security updates since January
 * 2020 and 2012 since October 2023.
 */
import type { ProductFaq } from './windows-and-office.js';

/** Asked on every edition page, answered from that edition's own numbers. */
function calNote(ar: boolean): string {
  return ar
    ? 'نعم، منفصلة. رخصة الخادم تُرخّص الجهاز، وكل مستخدم أو جهاز يتصل بالخادم يحتاج رخصة وصول عميل (CAL) إضافية. والاستثناء الوحيد إصدار Essentials، الذي يشمل الوصول ضمن سقفه فلا CAL معه.'
    : 'Yes, separately. The server licence covers the machine; every user or device that connects to it needs a Client Access Licence on top. The one exception is the Essentials edition, which includes access within its cap and needs no CALs at all.';
}

export const FAQ_WINDOWS_SERVER: Record<string, ProductFaq> = {
  'windows-server-2025-standard': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'كم جهازاً افتراضياً يسمح به؟',
        a: 'المضيف زائد جهازين افتراضيين. إن كنت ستشغّل ثلاثة أو أكثر فـ Datacenter يصبح الأرخص لا الأغلى، لأن Standard يُشترى من جديد مع كل جهازين إضافيين بينما Datacenter يُشترى مرّة للمضيف.',
      },
      {
        q: 'ما الجديد في 2025؟',
        a: 'أهمّه Hotpatching: تحديثات أمنية تُطبَّق على خادم يعمل بلا إعادة تشغيل، فتتحوّل نافذة الصيانة الشهرية إلى شيء لا يحتاج جدولة. ثم SMB over QUIC لكل الإصدارات، وتقسيم كرت الرسوميات بين الأجهزة الافتراضية.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'How many virtual machines does it permit?',
        a: 'The host plus two virtual instances. If you will run three or more, Datacenter becomes the cheaper licence rather than the dearer one — Standard has to be bought again for each additional pair, while Datacenter is bought once for the host.',
      },
      {
        q: 'What is new in 2025?',
        a: 'Hotpatching above all: security updates applied to a running server with no reboot, which turns the monthly maintenance window into something that no longer needs scheduling. Then SMB over QUIC across every edition, and GPU partitioning across virtual machines.',
      },
    ],
  },

  'windows-server-2025-datacenter': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'متى يستحقّ Datacenter فرق سعره عن Standard؟',
        a: 'عند ثلاثة أجهزة افتراضية أو أكثر، تقريباً. Standard يسمح باثنين ويُشترى من جديد لكل زوج إضافي؛ Datacenter غير محدود ويُشترى مرّة واحدة للمضيف. هذه الحسبة — لا الميزات — هي سبب تشغيل أغلب مضيفات الأجهزة الافتراضية على Datacenter.',
      },
      {
        q: 'ما الذي لا يوجد إلا في Datacenter؟',
        a: 'Storage Spaces Direct الذي يبني تخزيناً مشتركاً من أقراص الخوادم نفسها بدل SAN، وStorage Replica للنسخ إلى موقع ثانٍ، والشبكات المعرَّفة برمجياً، والأجهزة الافتراضية المحصَّنة التي تُشفَّر بحيث لا يقرأ قرصها حتى مدير المضيف.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'When does Datacenter justify the price difference?',
        a: 'At roughly three virtual machines or more. Standard permits two and must be bought again for each additional pair; Datacenter is unlimited and bought once for the host. That arithmetic, rather than any feature, is why most virtualisation hosts run Datacenter.',
      },
      {
        q: 'What exists only in Datacenter?',
        a: 'Storage Spaces Direct, which builds shared storage from the servers’ own disks instead of a SAN; Storage Replica for block-level replication to a second site; software-defined networking; and shielded virtual machines, encrypted so that even a host administrator cannot read the guest disk.',
      },
    ],
  },

  'windows-server-2022-standard': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'إلى متى يبقى 2022 مدعوماً؟',
        a: 'الدعم الأساسي حتى أكتوبر 2026 والممتدّ حتى أكتوبر 2031 — فهذه نسخة يمكن نشرها اليوم وإبقاؤها مرقّعة لسنوات.',
      },
      {
        q: 'ما الذي أضافه 2022؟',
        a: 'نقل حدّ الأمان إلى ما تحت نظام التشغيل: secured-core server يجمع TPM 2.0 وSecure Boot وSystem Guard فيُتحقَّق من البرنامج الثابت قبل إقلاع ويندوز. وTLS 1.3 مفعّل افتراضياً، وSMB over QUIC الذي يتيح الوصول إلى مشاركة ملفات عبر الإنترنت بلا VPN.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'How long is 2022 supported?',
        a: 'Mainstream support to October 2026 and extended support to October 2031 — a version you can deploy today and keep patched for years.',
      },
      {
        q: 'What did 2022 add?',
        a: 'It moved the security boundary below the operating system: secured-core server combines TPM 2.0, Secure Boot and System Guard so firmware is verified before Windows loads. TLS 1.3 is on by default, and SMB over QUIC lets a file share be reached across the internet without a VPN.',
      },
    ],
  },

  'windows-server-2022-datacenter': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'ما الفرق عن Standard؟',
        a: 'حدّ الأجهزة الافتراضية: Standard يسمح باثنين، وDatacenter بلا حدّ على المضيف المرخَّص. ويضيف Datacenter تخزيناً وشبكات معرَّفة برمجياً — Storage Spaces Direct وStorage Replica والأجهزة المحصَّنة — لا توجد في Standard إطلاقاً.',
      },
      {
        q: 'إلى متى يبقى مدعوماً؟',
        a: 'الدعم الأساسي حتى أكتوبر 2026 والممتدّ حتى أكتوبر 2031.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'How does it differ from Standard?',
        a: 'The virtual-machine limit: Standard permits two, Datacenter permits as many as the licensed host will carry. Datacenter also adds the software-defined storage and networking stack — Storage Spaces Direct, Storage Replica, shielded VMs — which Standard does not have at all.',
      },
      {
        q: 'How long is it supported?',
        a: 'Mainstream support to October 2026, extended support to October 2031.',
      },
    ],
  },

  'windows-server-2022-essential': {
    ar: [
      {
        q: 'هل أحتاج رخص CAL مع Essentials؟',
        a: 'لا، وهذا هو سبب وجوده. Standard وDatacenter يطلبان رخصة وصول لكل مستخدم أو جهاز، ولمكتب من عشرين شخصاً تكلّف تلك الرخص أكثر من رخصة الخادم نفسها. Essentials يشملها: سقف الـ25 مستخدماً و50 جهازاً هو الترخيص نفسه، ولا شيء بعده يُشترى.',
      },
      {
        q: 'ما حدوده بالضبط؟',
        a: 'خادم فيزيائي واحد، معالج واحد بحدّ 10 أنوية، 25 مستخدماً، 50 جهازاً، وبلا حقوق تشغيل أجهزة افتراضية عدا المضيف نفسه. هذه الأرقام مُنفَّذة لا استرشادية — المستخدم السادس والعشرون لا يستطيع تسجيل الدخول.',
      },
      {
        q: 'ماذا لو تجاوزت السقف لاحقاً؟',
        a: 'عندها يصبح الترخيص خاطئاً وتحتاج Standard مع رخص CAL. إن كان مكتبك قريباً من السقف اليوم فاشترِ Standard من البداية — سيبقى مناسباً العام القادم.',
      },
    ],
    en: [
      {
        q: 'Do I need CALs with Essentials?',
        a: 'No, and that is the point of it. Standard and Datacenter require a licence for every user or device, and for a twenty-person office those cost more than the server licence itself. Essentials includes them: the 25-user, 50-device cap is the licensing, and there is nothing further to buy.',
      },
      {
        q: 'What exactly are the limits?',
        a: 'One physical server, one CPU socket up to 10 cores, 25 users, 50 devices, and no virtualisation rights beyond running the host. Those numbers are enforced rather than advisory — the twenty-sixth user cannot sign in.',
      },
      {
        q: 'What if I outgrow it?',
        a: 'Then the licence is the wrong one and you need Standard plus CALs. If your office is near the ceiling now, buy Standard from the start — it will still fit next year.',
      },
    ],
  },

  'windows-server-2019-standard': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'هل ما زال 2019 يستقبل تحديثات؟',
        a: 'نعم. انتهى الدعم الأساسي في يناير 2024، والدعم الممتدّ مستمرّ حتى يناير 2029 — فالتحديثات الأمنية ما زالت تصل.',
      },
      {
        q: 'لماذا أختار 2019 بدل 2022؟',
        a: 'لمطابقة بنية قائمة، أو لأن مورّد تطبيق يعتمد 2019 دون ما بعده. لنشر جديد بلا قيد كهذا، 2022 يشتري أربع سنوات دعم إضافية بسعر مقارب.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'Is 2019 still receiving updates?',
        a: 'Yes. Mainstream support ended in January 2024; extended support runs to January 2029, so security updates continue.',
      },
      {
        q: 'Why choose 2019 over 2022?',
        a: 'To match an existing estate, or because an application vendor certifies 2019 and nothing later. For a new deployment with no such constraint, 2022 buys four more years of support at a comparable price.',
      },
    ],
  },

  'windows-server-2019-datacenter': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'ما الذي يميّزه عن Standard؟',
        a: 'أجهزة افتراضية بلا حدّ على المضيف بدل اثنين، مع Storage Spaces Direct وStorage Replica والأجهزة المحصَّنة. في 2019 نضج Storage Spaces Direct تحديداً: إزالة التكرار والضغط على أقراص ReFS، وسجلّ أداء مدمج، وعناقيد من عقدتين في متناول شركة صغيرة.',
      },
      {
        q: 'هل أستطيع خلطه مع 2022 في نفس العنقود؟',
        a: 'لا. خلط الإصدارات داخل عنقود Storage Spaces Direct واحد غير مدعوم — وهذا أحد أهمّ أسباب شراء 2019 اليوم: مطابقة عنقود قائم.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'What separates it from Standard?',
        a: 'Unlimited virtual instances on the host rather than two, plus Storage Spaces Direct, Storage Replica and shielded VMs. 2019 is where Storage Spaces Direct matured in particular: deduplication and compression on ReFS, built-in performance history, and two-node clusters a small business could afford.',
      },
      {
        q: 'Can I mix it with 2022 in the same cluster?',
        a: 'No. Mixing versions inside one Storage Spaces Direct cluster is not supported — which is one of the main reasons 2019 is still bought today: matching an existing cluster.',
      },
    ],
  },

  'windows-server-2019-essential': {
    ar: [
      {
        q: 'هل أحتاج رخص CAL مع Essentials؟',
        a: 'لا. السقف هو الترخيص: 25 مستخدماً و50 جهازاً مشمولون في سعر الشراء، وهو لمكتب صغير أقلّ عادةً ممّا تكلّفه رخص CAL وحدها مع Standard.',
      },
      {
        q: 'ما حدوده؟',
        a: 'خادم فيزيائي واحد، حتى معالجَين، 25 مستخدماً، 50 جهازاً، وبلا حقوق تشغيل أجهزة افتراضية عدا المضيف. الأرقام مُنفَّذة لا استرشادية.',
      },
      {
        q: 'هل هو ويندوز سيرفر كامل أم نسخة مبتورة؟',
        a: 'كامل: Active Directory وDNS وDHCP وخدمات الملفات والطباعة وHyper-V. وفي 2019 أُسقط دور Essentials Experience القديم، فصار يُثبَّت ويتصرّف كأي ويندوز سيرفر بدل المرور بمعالج إعداد.',
      },
    ],
    en: [
      {
        q: 'Do I need CALs with Essentials?',
        a: 'No. The cap is the licensing: 25 users and 50 devices are included in the purchase price, which for a small office is usually less than the CALs alone would cost alongside Standard.',
      },
      {
        q: 'What are the limits?',
        a: 'One physical server, up to two CPU sockets, 25 users, 50 devices, and no virtualisation rights beyond the host. The numbers are enforced rather than advisory.',
      },
      {
        q: 'Is it a full Windows Server or a cut-down one?',
        a: 'Full: Active Directory, DNS, DHCP, file and print services, Hyper-V. 2019 also dropped the old Essentials Experience role, so it installs and behaves like any other Windows Server rather than through a wizard.',
      },
    ],
  },

  'windows-server-2016-standard': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'إلى متى يبقى 2016 مدعوماً؟',
        a: 'انتهى الدعم الأساسي في يناير 2022، والدعم الممتدّ ينتهي في 12 يناير 2027. التحديثات الأمنية مستمرّة حتى ذلك التاريخ ثم تتوقّف — ما يجعله صالحاً لحاجة توافق محدّدة وخياراً ضعيفاً لنشر جديد.',
      },
      {
        q: 'ما الذي تغيّر في الترخيص مع 2016؟',
        a: 'هنا انتقل ويندوز سيرفر من الترخيص بالمقبس إلى الترخيص **بالنواة الفيزيائية** — وهو تغيير ما زال يفاجئ من يحسب تكلفة الترقية من 2012.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'How long is 2016 supported?',
        a: 'Mainstream support ended in January 2022 and extended support ends on 12 January 2027. Security updates continue until then and stop after — which makes it viable for a specific compatibility need and a poor choice for a new deployment.',
      },
      {
        q: 'What changed about licensing in 2016?',
        a: 'This is where Windows Server moved from per-socket to **per physical core** licensing — a change that still catches people costing an upgrade from 2012.',
      },
    ],
  },

  'windows-server-2016-datacenter': {
    ar: [
      { q: 'هل أحتاج رخص CAL بالإضافة إلى هذه؟', a: calNote(true) },
      {
        q: 'ما الذي يضيفه على Standard؟',
        a: 'أجهزة افتراضية بلا حدّ بدل اثنين، وهو أوّل إصدار يضمّ Storage Spaces Direct والأجهزة الافتراضية المحصَّنة.',
      },
      {
        q: 'هل أشتريه لنشر جديد؟',
        a: 'ينتهي دعمه الممتدّ في 12 يناير 2027. الأسباب السليمة لاختياره هي مطابقة عنقود 2016 قائم أو تطبيق معتمَد عليه؛ خلا ذلك، 2022 أو 2025 يمنحان مدى أطول بكثير.',
      },
    ],
    en: [
      { q: 'Do I need CALs on top of this?', a: calNote(false) },
      {
        q: 'What does it add over Standard?',
        a: 'Unlimited virtual instances rather than two, and it was the first release to include Storage Spaces Direct and shielded virtual machines.',
      },
      {
        q: 'Should I buy it for a new deployment?',
        a: 'Extended support ends on 12 January 2027. The sound reasons to choose it are matching an existing 2016 cluster or an application certified against it; otherwise 2022 or 2025 give a far longer runway.',
      },
    ],
  },
};
