/**
 * Product FAQs — Windows and the Office lines, in both languages.
 *
 * What is deliberately *not* here: delivery time, the warranty, the refund
 * policy, how to pay. Those are the same answer for all 71 products, they are
 * already on the page in the specification table and in the trust block, and
 * repeating them seventy-one times would rebuild in the FAQ exactly the
 * duplication the bodies were just rewritten to remove.
 *
 * What is here is the question this product raises and its neighbour does not
 * — the one somebody types into a search box before buying, or asks support
 * afterwards. "Will it run on my PC" for Windows 11. "Can I move it to a new
 * computer" for a retail key. "Will my file open" for a perpetual Office.
 *
 * Both locales are written rather than one translated from the other: the
 * Arabic market asks some of these differently, and one of them — whether a
 * key bought online is genuine — is asked far more often in Arabic than in
 * English and deserves a direct answer rather than a translated aside.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export interface ProductFaq {
  ar: FaqItem[];
  en: FaqItem[];
}

export const WINDOWS_AND_OFFICE: Record<string, ProductFaq> = {
  'windows-11-pro': {
    ar: [
      {
        q: 'كيف أعرف أن جهازي يقبل ويندوز 11 قبل الشراء؟',
        a: 'شغّل أداة PC Health Check من مايكروسوفت، وهي مجانية. المطلوب شريحة TPM 2.0 وتشغيل Secure Boot ومعالج 64-بت ضمن قائمة مايكروسوفت المعتمدة، مع 4 جيجابايت ذاكرة و64 جيجابايت تخزين. كثير من أجهزة 2016 و2017 تملك TPM لكنها معطّلة من إعدادات BIOS — وهذا ضبط لا شراء.',
      },
      {
        q: 'ما الفرق العملي بين Pro وHome؟',
        a: 'أربعة أمور تغيّر ما يمكن فعله بالجهاز: تشفير القرص كاملاً بـ BitLocker، وتشغيل أجهزة افتراضية عبر Hyper-V، واستقبال اتصال سطح مكتب بعيد (كل النسخ تتصل للخارج، وPro وحدها يُتصل بها)، وسياسات المجموعة والانضمام لدومين الشركة. إن لم تكن تحتاج أياً منها فـ Home هي الصحيحة.',
      },
      {
        q: 'هل أستطيع نقل الترخيص إلى جهاز آخر لاحقاً؟',
        a: 'مفاتيح Retail قابلة للنقل بعد إلغاء تفعيلها من الجهاز القديم؛ مفاتيح OEM تبقى مرتبطة باللوحة الأم التي فُعّلت عليها أول مرة. نوع المفتاح مذكور في جدول المواصفات على هذه الصفحة — راجعه قبل الشراء إن كنت تخطّط لترقية الجهاز.',
      },
    ],
    en: [
      {
        q: 'How do I know my PC will accept Windows 11 before buying?',
        a: 'Run Microsoft’s free PC Health Check tool. It needs TPM 2.0, Secure Boot, a 64-bit processor on Microsoft’s supported list, 4 GB of RAM and 64 GB of storage. Many 2016 and 2017 machines have a TPM that is switched off in firmware rather than absent — a BIOS setting, not a purchase.',
      },
      {
        q: 'What is the practical difference between Pro and Home?',
        a: 'Four things that change what the machine can do: BitLocker full-drive encryption, Hyper-V virtual machines, Remote Desktop as the host you connect to (every edition connects out, only Pro can be connected to), and Group Policy with domain join. If none of those describes something you need, Home is the right edition.',
      },
      {
        q: 'Can I move the licence to a different computer later?',
        a: 'A retail key can be transferred once it is deactivated on the old machine. An OEM key stays bound to the motherboard it first activated on. Which type this is appears in the specification table on this page — check it before buying if you plan to upgrade the hardware.',
      },
    ],
  },

  'windows-10-pro': {
    ar: [
      {
        q: 'هل ما زال ويندوز 10 يعمل بعد انتهاء الدعم؟',
        a: 'نعم. توقّفت التحديثات الأمنية المجانية في 14 أكتوبر 2025، لكن النظام يقلع ويُفعَّل ويشغّل كل ما كان يشغّله. ما توقّف هو الترقيع الشهري للثغرات الجديدة. هذا خطر حقيقي على جهاز يتصفّح ويحمل بيانات عملاء، ولا يكاد يُذكر على جهاز يشغّل تطبيقاً واحداً على شبكة معزولة.',
      },
      {
        q: 'لماذا أشتري ويندوز 10 بدل 11؟',
        a: 'السبب الأشيع هو العتاد: جهاز بلا TPM 2.0 لا يقبل ويندوز 11 إطلاقاً، واستبداله لمجرد تغيير النظام أغلى. السبب الثاني برمجي: أنظمة التحكّم الصناعي وأجهزة المختبرات وبعض برامج المحاسبة معتمَدة على ويندوز 10 دون 11، والاعتماد ليس شيئاً يتجاوزه المستخدم.',
      },
      {
        q: 'هل ترقية ويندوز 10 إلى 11 مجانية بهذا المفتاح؟',
        a: 'إن كان جهازك يستوفي متطلّبات ويندوز 11، فترقية جهاز مفعَّل بويندوز 10 إلى 11 لا تحتاج مفتاحاً جديداً — الترخيص ينتقل. أما إن كان الجهاز لا يستوفي المتطلّبات فالترقية غير متاحة أصلاً، بمفتاح أو بغيره.',
      },
    ],
    en: [
      {
        q: 'Does Windows 10 still work now that support has ended?',
        a: 'Yes. Free security updates stopped on 14 October 2025, but the system boots, activates and runs everything it ran before. What stopped is the monthly patch for new vulnerabilities — a real risk on a machine that browses the web and holds customer data, and close to none on one running a single application on an isolated network.',
      },
      {
        q: 'Why would I buy Windows 10 rather than 11?',
        a: 'Hardware, usually: a machine with no TPM 2.0 cannot run Windows 11 at all, and replacing it to chase an operating system is the more expensive answer. Then software — industrial control systems, laboratory instruments and some accounting suites are certified against 10 and not 11, and a certification is not something a user can override.',
      },
      {
        q: 'Does this key also cover an upgrade to Windows 11?',
        a: 'If your hardware meets the Windows 11 requirements, upgrading an activated Windows 10 machine does not need a new key — the licence carries across. If the hardware does not meet them, the upgrade is not available at all, with this key or any other.',
      },
    ],
  },

  'windows-11-home': {
    ar: [
      {
        q: 'هل أحتاج حساب مايكروسوفت لإكمال التثبيت؟',
        a: 'نعم. ويندوز 11 Home يطلب اتصالاً بالإنترنت وحساب مايكروسوفت لإنهاء الإعداد الأول، بخلاف Pro التي ما زالت تسمح بحساب محلّي. إن كان الحساب المحلّي شرطاً عندك فاختر Pro.',
      },
      {
        q: 'ما الذي سأفتقده مقارنة بـ Pro؟',
        a: 'أربعة أشياء تحديداً: تشفير القرص كاملاً بـ BitLocker، وأجهزة Hyper-V الافتراضية، واستقبال اتصال سطح مكتب بعيد، وسياسات المجموعة مع الانضمام لدومين. لا شيء غيرها. إن لم تكن واحدة منها تصف حاجة لديك فـ Home هي الاختيار الصحيح وPro مال في مزايا لن تُستخدم.',
      },
      {
        q: 'هل أستطيع الترقية من Home إلى Pro لاحقاً؟',
        a: 'نعم، الترقية متاحة داخل ويندوز نفسه بشراء مفتاح Pro وإدخاله في الإعدادات — بلا إعادة تثبيت وبلا فقدان ملفات أو برامج.',
      },
    ],
    en: [
      {
        q: 'Do I need a Microsoft account to finish setup?',
        a: 'Yes. Windows 11 Home requires an internet connection and a Microsoft account to complete first-time setup, where Pro still allows a local account. If a local account is a requirement for you, choose Pro.',
      },
      {
        q: 'What am I giving up compared with Pro?',
        a: 'Four specific things: BitLocker full-drive encryption, Hyper-V virtual machines, Remote Desktop hosting, and Group Policy with domain join. Nothing else. If none of those describes a need, Home is the right edition and Pro is money spent on features that will sit idle.',
      },
      {
        q: 'Can I upgrade from Home to Pro later?',
        a: 'Yes. The upgrade happens inside Windows by buying a Pro key and entering it in Settings — no reinstall, and no loss of files or installed applications.',
      },
    ],
  },

  'windows-10-home': {
    ar: [
      {
        q: 'جهازي لا يقبل ويندوز 11 — هل هذا هو الحل؟',
        a: 'نعم، هذه هي النسخة المخصّصة لعتاد لا يستوفي شروط ويندوز 11: لا TPM 2.0، أو معالج خارج القائمة المعتمدة، أو جهاز لم تُصدر له الشركة تحديث البرنامج الثابت. الترخيص دائم ويُفعّل النظام تفعيلاً كاملاً.',
      },
      {
        q: 'انتهى الدعم في 2025 — هل ما زال آمناً؟',
        a: 'يعتمد على الاستخدام. توقّفت التحديثات الأمنية في 14 أكتوبر 2025، فجهاز يتصفّح ويستقبل بريداً ويدخل على حسابات بنكية يحمل تعرّضاً حقيقياً. جهاز يشغّل ماكينة أو نقطة بيع على شبكة بلا إنترنت لا يكاد يحمل شيئاً. أبقِ المتصفّح ومضاد الفيروسات محدَّثين — كلاهما يتحدّث على جدوله الخاص.',
      },
      {
        q: 'ما الفرق بين Home وPro هنا؟',
        a: 'نفس الفروق في أي إصدار ويندوز: Pro تضيف BitLocker وHyper-V واستقبال سطح المكتب البعيد وسياسات المجموعة. للاستخدام الشخصي والعائلي لا تُستعمل أيّ منها عادةً.',
      },
    ],
    en: [
      {
        q: 'My PC will not take Windows 11 — is this the answer?',
        a: 'Yes. This is the edition for hardware that does not meet the Windows 11 requirements: no TPM 2.0, a processor outside the supported list, or a machine whose manufacturer never shipped the firmware update. The licence is permanent and activates the system fully.',
      },
      {
        q: 'Support ended in 2025 — is it still safe?',
        a: 'It depends on the machine. Security updates stopped on 14 October 2025, so a PC that browses, receives mail and signs into bank accounts carries real exposure. One driving a machine tool or a till on a network with no internet carries almost none. Keep the browser and a third-party antivirus current — both update on their own schedules.',
      },
      {
        q: 'What is the difference between Home and Pro here?',
        a: 'The same as in any Windows release: Pro adds BitLocker, Hyper-V, Remote Desktop hosting and Group Policy. For personal and family use, none of those is normally touched.',
      },
    ],
  },

  'office-2021-pro-plus': {
    ar: [
      {
        q: 'هل ينتهي هذا الترخيص أم يبقى؟',
        a: 'يبقى. هذا شراء لمرّة واحدة بلا تجديد وبلا اشتراك شهري — تُثبّته على الجهاز ويظلّ يعمل. الوجه الآخر أنه لا يتغيّر: يستقبل إصلاحات أمنية لا مزايا جديدة، فالنسخة التي تثبّتها اليوم هي نسخة 2021.',
      },
      {
        q: 'ما الذي أضافه 2021 على 2019؟',
        a: 'في Excel أهمّها XLOOKUP التي تُغني عن VLOOKUP، والمصفوفات الديناميكية مع LET وXMATCH حيث تملأ معادلة واحدة المدى الذي تحتاجه بدل نسخها عبر عمود. وأُضيف Sheet View فلا يُحرّك اثنان صفوف بعضهما في ملف مشترك. وعلى مستوى الحزمة: وضع داكن حقيقي، وبحث أسرع، وتبويب الرسم في كل التطبيقات.',
      },
      {
        q: 'هل تُفتح ملفاتي القادمة من مايكروسوفت 365؟',
        a: 'نعم، صيغ الملفات واحدة. الاستثناء الوحيد معادلة بُنيت على دالّة أُضيفت بعد إصدار 2021 — ستظهر كخطأ اسم بدل نتيجة. نادر في أغلب الملفات، لكنه يستحقّ المعرفة إن كنت تتبادل جداول مع مشتركين في 365.',
      },
    ],
    en: [
      {
        q: 'Does this licence expire, or is it permanent?',
        a: 'Permanent. It is a one-time purchase with no renewal and no monthly charge — install it and it keeps working on that PC. The other side of that is that it does not change: it receives security fixes rather than new features, so the version you install today is the 2021 release.',
      },
      {
        q: 'What did 2021 add over 2019?',
        a: 'In Excel, mainly XLOOKUP in place of VLOOKUP, and dynamic arrays with LET and XMATCH — one formula fills the range it needs instead of being copied down a column. Excel also gained Sheet View, so two people sorting a shared sheet stop moving rows under each other. Across the suite: a real dark mode, a faster search box, and the Draw tab everywhere.',
      },
      {
        q: 'Will it open files from Microsoft 365?',
        a: 'Yes — the file formats are the same. The one exception is a formula built on a function added after the 2021 release, which shows a name error rather than a result. Rare in most workbooks, but worth knowing if you exchange spreadsheets with 365 subscribers.',
      },
    ],
  },

  'office-2019-pro-plus': {
    ar: [
      {
        q: 'انتهى دعم أوفيس 2019 — هل ما زال يعمل؟',
        a: 'نعم. توقّفت التحديثات الأمنية في 14 أكتوبر 2025، والتطبيقات تعمل وتفتح كل ملفاتك كما كانت. ما توقّف هو الإصلاح الشهري — وهو يهمّ أكثر ما يهمّ في Outlook وفي أي عمل تصل إليه مستندات من خارج الشركة، لأن مستند أوفيس طريق شائع لوصول ما لا تريده.',
      },
      {
        q: 'هل فيه XLOOKUP والمصفوفات الديناميكية؟',
        a: 'لا. هاتان جاءتا مع 2021. أوفيس 2019 يحوي IFS وTEXTJOIN وCONCAT وMAXIFS. إن ورثت جداول تستخدم XLOOKUP فلن تُحسَب هنا — وهذا سبب وجيه لاختيار 2021 بدلاً منه.',
      },
      {
        q: 'ما الذي يميّز 2019 إذن؟',
        a: 'هو الإصدار الذي أدخل أنواع الرسوم الحديثة إلى الخطّ الدائم: مخطّطات القمع والخرائط ثنائية الأبعاد ودعم SVG الذي يُبقي الرسوم حادّة على شاشة العرض. وفي PowerPoint جاء Morph وZoom، وهما أفضل انتقالين حتى اليوم.',
      },
    ],
    en: [
      {
        q: 'Office 2019 is out of support — does it still work?',
        a: 'Yes. Security updates stopped on 14 October 2025; the applications run and open every file they always did. What stopped is the monthly fix — which matters most in Outlook and in any workflow where documents arrive from outside the business, because an Office document is a common way for something unwanted to arrive.',
      },
      {
        q: 'Does it have XLOOKUP and dynamic arrays?',
        a: 'No — both arrived with Office 2021. Office 2019 has IFS, TEXTJOIN, CONCAT and MAXIFS. If you have inherited workbooks built on XLOOKUP they will not calculate here, which is a sound reason to choose 2021 instead.',
      },
      {
        q: 'So what does 2019 have going for it?',
        a: 'It was the release that brought the modern chart types to the perpetual line — funnel charts, 2D maps, and SVG support that keeps diagrams sharp when a slide is projected. PowerPoint gained Morph and Zoom, which remain the two transitions worth using.',
      },
    ],
  },

  'office-2016-pro-plus': {
    ar: [
      {
        q: 'لماذا يشتري أحد 2016 اليوم؟',
        a: 'للتوافق، في كل الحالات تقريباً. قواعد بيانات Access قديمة وجداول Excel مبنية حول إضافة معيّنة أو مرجع VBA قد تتعطّل على إصدار أحدث، وشركة لديها جدول ماكرو يعمل تختار النسخة التي تشغّله لا النسخة الحديثة. وبعض برامج المحاسبة وERP تعتمد تكاملها مع أوفيس على 2016 دون ما بعده.',
      },
      {
        q: 'هل يعمل على جهاز قديم؟',
        a: 'نعم، وهذا سبب ثانٍ لاختياره: متطلّباته أخفّ ممّا يطلبه 2021، فيُبقي جهازاً صالحاً في الخدمة بدل استبداله.',
      },
      {
        q: 'انتهى دعمه — ما معنى ذلك عملياً؟',
        a: 'توقّفت التحديثات الأمنية في 14 أكتوبر 2025. التطبيقات تعمل وملفاتك تُفتح، ولا يُرقَّع جديد. إن كنت تختار إصداراً للعمل العام لا لمطابقة اعتماد معيّن، فـ أوفيس 2021 برو بلس هو الإصدار الدائم الحالي وبسعر قريب.',
      },
    ],
    en: [
      {
        q: 'Why would anyone buy 2016 today?',
        a: 'Compatibility, in nearly every case. Older Access databases and Excel workbooks built around a specific add-in or VBA reference can break on a newer release, and a business with a working macro-driven workbook chooses the version that runs it. Some accounting and ERP packages certify their Office integration against 2016 and nothing later.',
      },
      {
        q: 'Will it run on an older machine?',
        a: 'Yes, and that is the second reason people choose it: it asks less of the hardware than 2021 does, which keeps a serviceable machine in use rather than replacing it.',
      },
      {
        q: 'It is out of support — what does that mean in practice?',
        a: 'Security updates stopped on 14 October 2025. The applications run and your files open; nothing new gets patched. If you are choosing an Office version for general work rather than to match a specific dependency, Office 2021 Pro Plus is the current perpetual edition at a similar price.',
      },
    ],
  },

  'office-365-pro-plus': {
    ar: [
      {
        q: 'ما الذي يصلني بالضبط — مفتاح أم حساب؟',
        a: 'حساب. يصلك اسم مستخدم وكلمة مرور تسجّل بهما الدخول إلى أوفيس، والاشتراك المرتبط بالحساب هو ما يُرخّص التطبيقات. هذا يختلف عن التراخيص الدائمة التي تُدخل فيها مفتاحاً في التثبيت.',
      },
      {
        q: 'ماذا يحدث إن سجّلت الدخول على جهاز سادس؟',
        a: 'يُخرَج أقدم جهاز تلقائياً بدل أن يُرفض الدخول. حدّ الأجهزة دورة لا جدار، وهذا ما يجعله عملياً بين مكتب ولابتوب وهاتف.',
      },
      {
        q: 'هل له تاريخ انتهاء دعم كالإصدارات الدائمة؟',
        a: 'لا. هذا الخطّ يتغيّر باستمرار: تصل المزايا عبر السنة ويتحرّك رقم الإصدار معها، فلا يوجد تاريخ إيقاف تخطّط له. المقايضة معكوسة تماماً مقابل أوفيس 2021 — هناك لا شيء ينتهي ولا شيء يتحسّن، وهنا العكس.',
      },
    ],
    en: [
      {
        q: 'What exactly arrives — a key or an account?',
        a: 'An account. You receive a username and a password, sign in to Office with them, and the subscription attached to the account licenses the applications. That is different from the perpetual editions, where you type a key into an installation.',
      },
      {
        q: 'What happens if I sign in on a sixth device?',
        a: 'The oldest one is signed out rather than the new one refused. The device limit is a rotation, not a wall, which is what makes it workable across a desk, a laptop and a phone.',
      },
      {
        q: 'Does it have an end-of-support date like the perpetual editions?',
        a: 'No. This line keeps changing — features arrive through the year and the version number moves with them, so there is no cut-off to plan around. The trade is the exact opposite of Office 2021: there, nothing expires and nothing improves; here, the reverse.',
      },
    ],
  },
};
