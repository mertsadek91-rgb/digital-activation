/**
 * FAQs for the antivirus shelf.
 *
 * The question these products actually raise is never "does it detect
 * viruses" — every one of them does. It is which edition, and whether the
 * extras justify the gap: Norton's VPN and cloud backup, ESET's firewall,
 * CCleaner Plus's three extra tools. Each page answers its own version of that
 * and points at the neighbour when the neighbour is the better buy.
 *
 * The two Norton "Panel" pages answer one more, because the answer matters:
 * the credentials are the licence, so the first thing to do with them is
 * change the password.
 */
import type { ProductFaq } from './windows-and-office.js';

export const FAQ_SECURITY: Record<string, ProductFaq> = {
  'norton-360-deluxe': {
    ar: [
      {
        q: 'ما الفرق بين Deluxe وPremium؟',
        a: 'محرّك الحماية واحد — تهديد يُصدّ على Premium يُصدّ على Deluxe. ما يرفعه Premium هو السعة: مساحة نسخ احتياطي سحابي أكبر وتغطية أجهزة أوسع. Deluxe هو الإصدار الذي يناسب منزلاً بدل عائلة ممتدّة، وهو ما ينبغي لأغلب الناس شراؤه.',
      },
      {
        q: 'هل VPN مشمول فعلاً بلا حدّ بيانات؟',
        a: 'نعم، Secure VPN مشمول بلا اشتراك منفصل وبلا سقف بيانات. وهو الجزء الذي يغطّي ما لا يغطّيه مضاد الفيروسات: شبكة فندق أو مطار يكون فيها الاتصال نفسه هو الخطر.',
      },
      {
        q: 'ما فائدة النسخ الاحتياطي السحابي مع وجود مضاد فيروسات؟',
        a: 'هو الميزة الوحيدة في الحزمة التي تنفع **بعد** وقوع الضرر. فدية شفّرت مجلّد مستنداتك لا يُبطلها إلا نسخة لم تكن على الجهاز أصلاً — ولا شيء آخر في القائمة يفعل ذلك.',
      },
    ],
    en: [
      {
        q: 'What is the difference between Deluxe and Premium?',
        a: 'The protection engine is the same — a threat blocked on Premium is blocked on Deluxe. What Premium raises is capacity: more cloud backup storage and broader device coverage. Deluxe is the edition that fits a household rather than an extended family, and the one most people should buy.',
      },
      {
        q: 'Is the VPN really included with no data cap?',
        a: 'Yes. Secure VPN is included with no separate subscription and no data limit. It covers the case antivirus cannot: a hotel or airport network where the connection itself is the risk.',
      },
      {
        q: 'Why does cloud backup matter if I have antivirus?',
        a: 'It is the one feature in the suite that helps *after* something has gone wrong. Ransomware that encrypts a documents folder is undone by a copy that was never on the machine, and by nothing else on the list.',
      },
    ],
  },

  'norton-360-premium': {
    ar: [
      {
        q: 'هل الحماية أقوى من Deluxe؟',
        a: 'لا. المحرّك واحد عبر كل خطّ 360، والكشف متطابق. ما يزيده Premium هو السعة: مساحة نسخ سحابي أكبر وعدد أجهزة أوسع تحت اشتراك واحد.',
      },
      {
        q: 'إذن متى يستحقّ الفرق؟',
        a: 'حين تكون مساحة النسخ الاحتياطي هي ما تحتاجه فعلاً — وهي الجزء الذي ينفع بعد وقوع الضرر لا قبله — أو حين يتجاوز عدد أجهزة البيت ما يغطّيه Deluxe. خلا ذلك، Deluxe نفس الحماية بسعر أقلّ.',
      },
      {
        q: 'ما SafeCam؟',
        a: 'يمنع أي تطبيق من تشغيل كاميرا الويب دون أن يستأذن، ويُخطرك بمن حاول. مشمول في كامل خطّ 360.',
      },
    ],
    en: [
      {
        q: 'Is the protection stronger than Deluxe?',
        a: 'No. The engine is the same across the whole 360 range and detection is identical. What Premium adds is capacity: more cloud backup storage and more devices under one subscription.',
      },
      {
        q: 'So when is the difference worth paying?',
        a: 'When the backup allowance is what you actually need — the part that helps after something has gone wrong rather than before — or when the household has more devices than Deluxe covers. Otherwise Deluxe is the same protection for less.',
      },
      {
        q: 'What is SafeCam?',
        a: 'It blocks any application from switching on the webcam without asking, and tells you which one tried. Included across the whole 360 line.',
      },
    ],
  },

  'norton-360-deluxe-panel': {
    ar: [
      {
        q: 'ما الفرق عن ترخيص Norton العادي؟',
        a: 'التسليم فقط. الترخيص العادي كود تُدخله في حسابك أنت؛ هذا هو الحساب نفسه وعليه الاشتراك جاهزاً — تسجّل الدخول وتُنزّل وتضيف أجهزتك. الحماية متطابقة.',
      },
      {
        q: 'هل أغيّر كلمة المرور؟',
        a: 'نعم، فوراً بعد أوّل تسجيل دخول. بيانات الدخول **هي** الترخيص: من يملكها يملك الاشتراك — ولهذا يجب أن تتوقّف عن كونها تلك التي وصلت بالبريد.',
      },
    ],
    en: [
      {
        q: 'How does this differ from an ordinary Norton licence?',
        a: 'Only in delivery. A retail licence is a code you enter into your own account; this is the account itself, already subscribed — sign in, download, add your devices. The protection is identical.',
      },
      {
        q: 'Should I change the password?',
        a: 'Yes, immediately after the first sign-in. The credentials *are* the licence: whoever holds them holds the subscription, which is exactly why they should stop being the ones that arrived by email.',
      },
    ],
  },

  'norton-360-premium-panel': {
    ar: [
      {
        q: 'ماذا أستلم بالضبط؟',
        a: 'اسم مستخدم وكلمة مرور لحساب Norton يحمل اشتراك Premium جاهزاً — لا كود تفعيل. سجّل الدخول، نزّل المثبّت، وأضف أجهزتك من الحساب نفسه.',
      },
      {
        q: 'هل أغيّر كلمة المرور؟',
        a: 'نعم، من أوّل تسجيل دخول. بيانات الدخول هي الترخيص، فبقاؤها كما وصلت يعني بقاء الاشتراك في يد غيرك أيضاً.',
      },
      {
        q: 'ما الذي يميّز Premium؟',
        a: 'مساحة النسخ الاحتياطي السحابي الأكبر — وهي الميزة الوحيدة التي تسترجع جهازاً بعد هجمة بدل أن تمنعها — مع تغطية أجهزة أوسع. المحرّك نفسه محرّك Deluxe.',
      },
    ],
    en: [
      {
        q: 'What exactly do I receive?',
        a: 'A username and password for a Norton account already carrying the Premium subscription — not an activation code. Sign in, download the installer, and add your devices from the same account.',
      },
      {
        q: 'Should I change the password?',
        a: 'Yes, from the first sign-in. The credentials are the licence, so leaving them as they arrived leaves the subscription in somebody else’s hands as well.',
      },
      {
        q: 'What distinguishes Premium?',
        a: 'The larger cloud backup allowance — the one feature that recovers a machine after an attack rather than preventing one — and broader device coverage. The engine is the same as Deluxe.',
      },
    ],
  },

  'norton-security-premium': {
    ar: [
      {
        q: 'ما الفرق بينه وبين Norton 360؟',
        a: 'هذا هو الجيل السابق. يغطّي الأساس جيداً — حماية فورية وجدار ناري ومدير كلمات مرور ورقابة أبوية ونسخ احتياطي — لكنه بلا **Secure VPN** وبلا مراقبة الويب المظلم، وهما ما جاء مع 360.',
      },
      {
        q: 'متى أختاره إذن؟',
        a: 'للاستمرارية: تثبيت Norton Security قائم تفضّل تمديده على ترحيله. لجهاز جديد، Norton 360 Deluxe هو الخطّ الحالي ويشمل VPN.',
      },
    ],
    en: [
      {
        q: 'How does it differ from Norton 360?',
        a: 'This is the previous generation. It covers the core well — real-time protection, firewall, password manager, parental controls, cloud backup — but has no **Secure VPN** and no dark web monitoring, both of which arrived with 360.',
      },
      {
        q: 'So when should I choose it?',
        a: 'For continuity: an existing Norton Security installation you would rather extend than migrate. For a new machine, Norton 360 Deluxe is the current range and includes the VPN.',
      },
    ],
  },

  'mcafee-internet-security-10-deivce': {
    ar: [
      {
        q: 'هل يغطّي الهواتف والأجهزة اللوحية أم الكمبيوتر فقط؟',
        a: 'يغطّي ويندوز وماك وأندرويد وiOS باشتراك واحد، وتتبع الحماية قواعد كل منصّة: فحص كامل على ويندوز، وحماية التطبيقات والويب على أندرويد، وفحص الويب والشبكات على iOS.',
      },
      {
        q: 'ما WebAdvisor؟',
        a: 'يُلوّن نتائج البحث ويحجب الصفحات والتنزيلات الخبيثة المعروفة قبل فتحها. عملياً يمنع إصابات منزلية أكثر ممّا يمنعه أي فحص، لأن أغلبها يبدأ بنقرة على رابط.',
      },
      {
        q: 'كيف أدير الأجهزة؟',
        a: 'من حساب McAfee واحد: تضيف جهازاً، ترسل المثبّت بالبريد، وترى أي الأجهزة محميّة وأيّها تأخّر. لبيت يصون فيه شخص واحد أجهزة الجميع، تلك الصفحة هي معظم القيمة.',
      },
    ],
    en: [
      {
        q: 'Does it cover phones and tablets, or only the PC?',
        a: 'Windows, Mac, Android and iOS on one subscription, and the protection follows each platform’s own rules — full scanning on Windows, app and web protection on Android, web and Wi-Fi checks on iOS.',
      },
      {
        q: 'What is WebAdvisor?',
        a: 'It colours search results and blocks known malicious pages and downloads before they open. In practice it stops more household infections than any scan does, because most of them start with a click on a link.',
      },
      {
        q: 'How do I manage the devices?',
        a: 'From a single McAfee account: add a device, send an installer by email, and see which machines are protected and which have fallen behind. For a household where one person maintains everyone’s computers, that page is most of the value.',
      },
    ],
  },

  'ccleaner-professional': {
    ar: [
      {
        q: 'ما الذي يضيفه على النسخة المجانية؟',
        a: 'التنظيف نفسه واحد. ما تدفع مقابله هو أن يحدث بلا تدخّلك: تنظيف مجدول يعمل وحده، ومراقبة فورية تنبّهك حين يستحقّ التنظيف، ومحدّث تعريفات، ومحدّث برامج. الأخير إجراء أمني أكثر منه راحة — أغلب هجمات التصفّح تستهدف متصفّحاً أو قارئ PDF قديماً.',
      },
      {
        q: 'هل يجعل جهازي القديم أسرع؟',
        a: 'جزئياً وبصدق: يستعيد مساحة قرص حقيقية ويقصّر زمن الإقلاع بإدارة ما يبدأ مع ويندوز. لكنه لن يُصلح قرصاً يتداعى ولن يضيف ذاكرة — على لابتوب قديم، قرص SSD يفعل أكثر ممّا يفعله أي منظّف.',
      },
    ],
    en: [
      {
        q: 'What does it add over the free version?',
        a: 'The cleaning itself is the same. What you pay for is that it happens without you: scheduled cleaning that runs on its own, real-time monitoring that prompts when it is worth clearing, a driver updater and a software updater. The last is a security measure more than a convenience — most drive-by attacks target an old browser or PDF reader.',
      },
      {
        q: 'Will it make my old machine faster?',
        a: 'Partly, and honestly: it recovers real disk space and shortens boot time by managing what starts with Windows. It will not make a failing disk healthy or add memory — on an old laptop, an SSD does more than any cleaner can.',
      },
    ],
  },

  'ccleaner-professional-plus': {
    ar: [
      {
        q: 'ما الذي يضيفه Plus على Professional؟',
        a: 'ثلاثة برامج: **Recuva** لاسترجاع الملفات المحذوفة من قرص أو بطاقة ذاكرة أو كاميرا، و**Defraggler** لإلغاء تجزئة الأقراص الميكانيكية، و**Speccy** لقراءة مكوّنات الجهاز وحرارته الحيّة.',
      },
      {
        q: 'هل أحتاج Defraggler على قرص SSD؟',
        a: 'لا، بل يُترك وشأنه — إلغاء التجزئة على SSD غير مفيد. هو للقرص الميكانيكي الدوّار في جهاز أقدم، وهناك ما زال ينفع.',
      },
      {
        q: 'هل يستحقّ الفرق عن النسخة العادية؟',
        a: 'يستحقّه لمن يصون أجهزة الآخرين، فاسترجاع ملف وقراءة العتاد هما أكثر مهمّتين تتكرّران. إن كنت تريد التنظيف المجدول والمحدّثات فقط فـ CCleaner Professional أرخص.',
      },
    ],
    en: [
      {
        q: 'What does Plus add over Professional?',
        a: 'Three applications: **Recuva** for recovering deleted files from a disk, memory card or camera, **Defraggler** for defragmenting mechanical drives, and **Speccy** for reading the machine’s components and live temperatures.',
      },
      {
        q: 'Do I need Defraggler on an SSD?',
        a: 'No — leave it alone there; defragmenting an SSD does not help. It is for the spinning disk in an older machine, where it still does.',
      },
      {
        q: 'Is it worth the difference over the plain edition?',
        a: 'It is for anyone who maintains other people’s machines, where recovering a file and reading hardware are the two jobs that come up most. If you only want scheduled cleaning and the updaters, CCleaner Professional is cheaper.',
      },
    ],
  },

  'eset-internet-security-nod32': {
    ar: [
      {
        q: 'ما الذي يضيفه على NOD32 AntiVirus؟',
        a: 'محرّك الكشف واحد. ما يضيفه هو كل ما يحرس الاتصال لا القرص: جدار ناري ثنائي الاتجاه يراقب ما يخرج كما يراقب ما يدخل، وفاحص شبكة يعرض كل جهاز على الواي فاي، ومتصفّح محصَّن لصفحات البنوك والدفع، وحماية من التصيّد، والتحكّم بالكاميرا.',
      },
      {
        q: 'هل يُبطئ جهازاً قديماً؟',
        a: 'ESET معروف تحديداً بعكس ذلك: بصمة ذاكرة صغيرة وفحوص لا تُجمّد الجهاز وتنبيهات قليلة. على لابتوب بطيء أصلاً، هذا الفارق هو سبب اختياره على حزمة أثقل.',
      },
      {
        q: 'أيّهما أشتري؟',
        a: 'خذ Internet Security إن كنت تتعامل بالبنوك أو تتسوّق من الجهاز أو تستخدم واي فاي عامّاً أو تريد رؤية ما على شبكتك. خذ NOD32 AntiVirus لجهاز شخصي خلف راوتر منزلي تريد حمايته بأخفّ بصمة ممكنة.',
      },
    ],
    en: [
      {
        q: 'What does it add over NOD32 AntiVirus?',
        a: 'The detection engine is the same. What it adds is everything that guards the connection rather than the disk: a two-way firewall watching what leaves as well as what arrives, a network inspector listing every device on the Wi-Fi, a hardened browser for banking and checkout pages, anti-phishing, and webcam control.',
      },
      {
        q: 'Will it slow an older machine down?',
        a: 'ESET is known specifically for the opposite: a small memory footprint, scans that do not stall the machine, and few interruptions. On a laptop that is already slow, that difference is usually the reason to choose it over a heavier suite.',
      },
      {
        q: 'Which one should I buy?',
        a: 'Take Internet Security if you bank or shop on the machine, use public Wi-Fi, or want to see what else is on your network. Take NOD32 AntiVirus for a personal machine behind a home router where you want protection with the lightest possible footprint.',
      },
    ],
  },

  'eset-nod32-antivirus': {
    ar: [
      {
        q: 'ما الذي لا يوجد فيه مقارنةً بـ Internet Security؟',
        a: 'الجدار الناري وفاحص الشبكة والمتصفّح المحصَّن للبنوك والرقابة الأبوية. محرّك الكشف واحد تماماً — الفرق كلّه فيما يحيط به.',
      },
      {
        q: 'هل يكفي بلا جدار ناري؟',
        a: 'جدار ويندوز Defender يغطّي ما يغطّيه جدار الحزمة لأغلب الأجهزة المنزلية خلف راوتر، وهذا سبب وجود هذا الإصدار بسعر أقلّ. إن كنت على واي فاي عامّ كثيراً أو تريد مراقبة ما يخرج من الجهاز، فالحزمة الأعلى أنسب.',
      },
      {
        q: 'ما UEFI scanner؟',
        a: 'يفحص البرنامج الثابت الذي يعمل قبل ويندوز — الطبقة التي لا يراها مضاد الفيروسات العادي أصلاً. مشمول هنا رغم أن هذا الإصدار هو الأساسي.',
      },
    ],
    en: [
      {
        q: 'What is missing compared with Internet Security?',
        a: 'The firewall, the network inspector, the hardened banking browser and parental controls. The detection engine is identical — the whole difference is in what surrounds it.',
      },
      {
        q: 'Is it enough without a firewall?',
        a: 'Windows Defender Firewall covers what the suite’s firewall covers for most home machines behind a router, which is why this edition exists at a lower price. If you are often on public Wi-Fi or want to watch what leaves the machine, the fuller suite suits better.',
      },
      {
        q: 'What is the UEFI scanner?',
        a: 'It checks the firmware that runs before Windows does — a layer ordinary antivirus cannot see into at all. Included here even though this is the base edition.',
      },
    ],
  },

  'eset-nod32-antivirus-bind-panel': {
    ar: [
      {
        q: 'لماذا لوحة بدل مفاتيح منفصلة؟',
        a: 'بعد حفنة أجهزة تصبح المفاتيح نفسها هي المشكلة: أيّ مفتاح على أيّ لابتوب، وأيّها ينتهي متى، وماذا يحدث حين يُستبدل جهاز. اللوحة تستبدل ذلك بقائمة واحدة: تُصدر مقعداً، تُسنده، تسترجعه حين يغادر جهاز. والتجديد تاريخ واحد بدل تواريخ.',
      },
      {
        q: 'هل الحماية نفسها حماية النسخة العادية؟',
        a: 'نعم، المحرّك نفسه: فحص فوري ودرع فدية ومانع ثغرات وفاحص ذاكرة متقدّم وفحص UEFI. هذا المنتج يغيّر طريقة إدارة التراخيص لا ما تحمي منه.',
      },
    ],
    en: [
      {
        q: 'Why a panel rather than separate keys?',
        a: 'Past a handful of machines the keys become the problem: which key is on which laptop, which expires when, what happens when a machine is replaced. A panel replaces that with one list — issue a seat, assign it, reclaim it when a machine leaves. Renewal becomes one date instead of many.',
      },
      {
        q: 'Is the protection the same as the retail edition?',
        a: 'Yes, the same engine: real-time scanning, ransomware shield, exploit blocker, advanced memory scanner and UEFI scanning. This product changes how the licences are administered, not what they protect against.',
      },
    ],
  },
};
