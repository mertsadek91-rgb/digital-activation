/**
 * FAQs for the Office 2024 line.
 *
 * These seven products raise one question the rest of the catalog does not:
 * the licence binds to a Microsoft account rather than to a machine, which
 * changes what happens when the computer is replaced and makes the address
 * given at checkout part of the purchase rather than a delivery detail. Every
 * page in this family answers it, because every buyer of these hits it.
 *
 * The rest is what separates one from the next — which applications arrive,
 * and whether the cheaper bundle is missing the one you actually need.
 */
import type { ProductFaq } from './windows-and-office.js';

export const FAQ_OFFICE_2024: Record<string, ProductFaq> = {
  'office-2024-word-bind-mac': {
    ar: [
      {
        q: 'هل أحصل على Word فقط أم على أوفيس كاملاً؟',
        a: 'Word وحده، بكامل مزاياه: الأنماط والقوالب، تعقّب التغييرات والتعليقات، دمج المراسلات، فهارس المحتويات والتسميات التي تُعيد ترقيم نفسها، الحواشي والمراجع، والتصدير إلى PDF بلا محوّل. Excel وPowerPoint وOutlook ليست ضمنه.',
      },
      {
        q: 'متى يكون شراء تطبيق واحد أفضل من الحزمة؟',
        a: 'حين لا تُفتح البقية: كاتب، مترجم، طالب على رسالة، مكتب يعيش في المستندات ويحتفظ بأرقامه في مكان آخر. أمّا إن كنت ستفتح Excel أكثر من نادراً، فحزمة Home and Student أرخص من تطبيقين يُشتريان منفصلين.',
      },
      {
        q: 'ماذا يحدث إن غيّرت جهازي؟',
        a: 'الترخيص مرتبط بحساب مايكروسوفت الذي تحدّده عند الشراء لا بالجهاز، فيتبع الحساب إلى الجهاز الجديد. لهذا أعطِ الحساب الذي تستخدمه فعلاً واحتفظ بالوصول إليه — الترخيص يعيش هناك.',
      },
    ],
    en: [
      {
        q: 'Do I get only Word, or the whole of Office?',
        a: 'Word alone, and the complete application: styles and templates, tracked changes and comments, mail merge, tables of contents and captions that renumber themselves, footnotes and citations, and PDF export without a converter. Excel, PowerPoint and Outlook are not included.',
      },
      {
        q: 'When is one application better than the bundle?',
        a: 'When the others would go unopened — a writer, a translator, a student on a dissertation, an office that lives in documents and keeps its numbers elsewhere. If you will open Excel more than occasionally, the Home and Student bundle costs less than two applications bought separately.',
      },
      {
        q: 'What happens when I change computers?',
        a: 'The licence binds to the Microsoft account you name at checkout rather than to the machine, so it follows the account to the new computer. Give the account you actually use and keep access to it — the licence lives there.',
      },
    ],
  },

  'office-2024-excel-bind-mac': {
    ar: [
      {
        q: 'هل فيه XLOOKUP والمصفوفات الديناميكية؟',
        a: 'نعم. Excel 2024 يحوي XLOOKUP والمصفوفات الديناميكية (FILTER وSORT وUNIQUE وSEQUENCE) وLAMBDA، إضافةً إلى TEXTSPLIT وTEXTBEFORE وTEXTAFTER لتفكيك البيانات المستورَدة. هذه هي الفروق الجوهرية عن أي Excel قبل 2021.',
      },
      {
        q: 'ما مقابل كونه ترخيصاً دائماً؟',
        a: 'لا تجديد ولا انتهاء — لكن أيضاً لا دوالّ جديدة بعد الإصدار. ملف يرسله إليك أحدهم مبنيّ على دالّة أُضيفت لاحقاً سيُظهر خطأ اسم بدل نتيجة. نادر في أغلب الجداول، ويستحقّ المعرفة إن كنت ضمن فريق يتبادل ملفات مع مشتركي الاشتراك.',
      },
      {
        q: 'هل يعمل على ويندوز وماك معاً؟',
        a: 'الترخيص يغطّي جهازاً واحداً، ويمكنك اختيار ويندوز أو ماك — لكن ليس الاثنين في الوقت نفسه. الاختيار يتمّ عند التثبيت وليس عند الشراء.',
      },
    ],
    en: [
      {
        q: 'Does it have XLOOKUP and dynamic arrays?',
        a: 'Yes. Excel 2024 includes XLOOKUP, dynamic arrays (FILTER, SORT, UNIQUE, SEQUENCE) and LAMBDA, plus TEXTSPLIT, TEXTBEFORE and TEXTAFTER for pulling apart imported data. Those are the substantive differences from any Excel before 2021.',
      },
      {
        q: 'What does being perpetual cost me?',
        a: 'No renewal and no expiry — but also no new functions after release. A workbook somebody sends you built on a function added later shows a name error rather than a result. Rare in most spreadsheets, and worth knowing if you are on a team that exchanges files with subscription users.',
      },
      {
        q: 'Does it run on both Windows and Mac?',
        a: 'The licence covers one device and you can choose Windows or Mac — but not both at once. The choice is made at installation rather than at purchase.',
      },
    ],
  },

  'office-2024-powerpoint-bind-mac': {
    ar: [
      {
        q: 'ما الذي يجعل PowerPoint 2024 مختلفاً عن نسخة قديمة؟',
        a: 'انتقال Morph الذي يُحرّك بين شريحتين بمطابقة الأشكال فيهما، وZoom الذي يجعل العرض قابلاً للتنقّل خارج الترتيب — وهو ما تحتاجه حين تسأل القاعة عن قسم بعده بثلاثة. وأدوات التسجيل التي تُصدّر عرضاً مسروداً كفيديو مع كاميرتك في الزاوية.',
      },
      {
        q: 'هل يشمل الترخيص حساباً أم مفتاحاً؟',
        a: 'يُربط الترخيص بحساب مايكروسوفت الذي تحدّده عند الشراء — لا مفتاح تُدخله في التثبيت. سجّل الدخول بذلك الحساب ويكون الترخيص حاضراً، ويتبع الحساب إلى أي جهاز جديد.',
      },
    ],
    en: [
      {
        q: 'What makes PowerPoint 2024 different from an older release?',
        a: 'Morph, which animates between two slides by matching the shapes on both, and Zoom, which makes a deck navigable out of order — useful when the room asks about a section three ahead. Plus the recording tools, which export a narrated presentation as video with your camera in the corner.',
      },
      {
        q: 'Is this an account or a key?',
        a: 'The licence binds to the Microsoft account you name at checkout — there is no key to type into an installation. Sign in with that account and the licence is present, and it follows the account to any new machine.',
      },
    ],
  },

  'office-2024-outlook-bind-mac': {
    ar: [
      {
        q: 'هل يعمل مع بريدي الحالي؟',
        a: 'يتصل Outlook 2024 بـ Microsoft 365 وExchange وبحسابات IMAP وPOP العادية. ما لا يستطيعه هو إضافة صندوق لا يتيحه مزوّدك — بعض خدمات البريد لا تقدّم IMAP إطلاقاً. إن لم تكن على Exchange، تأكّد أن مزوّدك يدعم IMAP قبل الشراء.',
      },
      {
        q: 'لماذا أشتري عميل بريد بدل استخدام المتصفّح؟',
        a: 'ثلاثة أسباب: بريدك على قرصك، قابل للبحث والقراءة حين لا يكون الاتصال متاحاً؛ والقواعد تعمل محلياً وتفعل ما لا تفعله واجهة الويب؛ وعدّة حسابات في نافذة واحدة — بريد عمل وبريد شخصي وصندوق مشترك جنباً إلى جنب لا في ثلاثة تبويبات.',
      },
    ],
    en: [
      {
        q: 'Will it work with my current email?',
        a: 'Outlook 2024 connects to Microsoft 365 and Exchange, and to ordinary IMAP and POP accounts. What it cannot do is add a mailbox your provider does not expose — a few webmail services offer no IMAP at all. If you are not on Exchange, confirm your provider supports IMAP before ordering.',
      },
      {
        q: 'Why buy a mail client instead of using the browser?',
        a: 'Three reasons: your mail is on your disk, searchable and readable when the connection is not; rules run locally and do things a web interface will not; and several accounts sit in one window — work, personal and a shared mailbox side by side rather than in three tabs.',
      },
    ],
  },

  'office-2024-home-and-student-bind-mac': {
    ar: [
      {
        q: 'هل Outlook ضمن هذه الحزمة؟',
        a: 'لا. الحزمة تضمّ Word وExcel وPowerPoint وOneNote. إن أردت بريداً وتقويماً على سطح المكتب فإصدار Home and Business هو هذه الأربعة زائد Outlook — وشراء Outlook منفصلاً لاحقاً يكلّف أكثر من فرق السعر بينهما.',
      },
      {
        q: 'هل يصلح للاستخدام التجاري؟',
        a: 'لا. هذا الإصدار مرخَّص للاستخدام الشخصي والمنزلي. للعمل التجاري — مستقلّ أو مكتب أو أي جهاز يُصدر فواتير — الإصدار الصحيح هو Home and Business. البرنامج نفسه، والإذن مختلف.',
      },
      {
        q: 'إلى متى يبقى مدعوماً؟',
        a: 'الإصدارات الدائمة من أوفيس تحمل خمس سنوات دعم، فـ 2024 يستقبل تحديثات أمنية حتى أكتوبر 2029 — أطول نافذة بين كل الإصدارات الدائمة المعروضة. بعدها تعمل التطبيقات وتفتح ملفاتك، ويتوقّف الترقيع الشهري.',
      },
    ],
    en: [
      {
        q: 'Is Outlook included?',
        a: 'No. This bundle is Word, Excel, PowerPoint and OneNote. If you want desktop mail and calendar, the Home and Business edition is these four plus Outlook — and buying Outlook separately afterwards costs more than the difference between the two.',
      },
      {
        q: 'Can I use it for business?',
        a: 'No. This edition is licensed for personal and household use. For commercial work — a freelancer, an office, any machine that issues invoices — Home and Business is the correct licence. The software is the same; the permission is not.',
      },
      {
        q: 'How long will it be supported?',
        a: 'Perpetual Office releases carry five years of support, so 2024 receives security updates into October 2029 — the longest window of any perpetual edition currently sold. After that the applications still run and open your files; the monthly patch is what stops.',
      },
    ],
  },

  'office-2024-home-and-business-bind-mac': {
    ar: [
      {
        q: 'ما الفرق عن Home and Student؟',
        a: 'Outlook، وهذا كلّ الفرق. الأربعة الأخرى — Word وExcel وPowerPoint وOneNote — متطابقة تماماً. والفرق الثاني ترخيصي: هذا الإصدار يسمح بالاستخدام التجاري، وذاك مقصور على الشخصي والمنزلي.',
      },
      {
        q: 'هل يشمل Access وPublisher؟',
        a: 'لا. Access وPublisher لا يأتيان إلا مع الإصدارات الاحترافية مثل Office LTSC Professional Plus، وهما متاحان على ويندوز فقط.',
      },
      {
        q: 'هل أستطيع تثبيته على ويندوز وماك؟',
        a: 'الترخيص لجهاز واحد، والاختيار بينهما لك عند التثبيت — لكن ليس الاثنين معاً. ويتبع الترخيص حساب مايكروسوفت الذي تحدّده لا الجهاز نفسه.',
      },
    ],
    en: [
      {
        q: 'What is the difference from Home and Student?',
        a: 'Outlook, and that is the whole of it. The other four — Word, Excel, PowerPoint and OneNote — are identical. The second difference is licensing: this edition permits commercial use, where Home and Student is personal and household only.',
      },
      {
        q: 'Does it include Access and Publisher?',
        a: 'No. Access and Publisher come only with the professional editions such as Office LTSC Professional Plus, and both are Windows-only.',
      },
      {
        q: 'Can I install it on Windows and on Mac?',
        a: 'The licence covers one device and the choice between them is yours at installation — but not both at once. The licence follows the Microsoft account you name rather than the machine.',
      },
    ],
  },

  'office-ltsc-professional-plus-2024-mak': {
    ar: [
      {
        q: 'ما معنى LTSC ولمن هو؟',
        a: 'نسخة الخدمة طويلة الأمد: تستقبل إصلاحات أمنية ولا شيء غيرها — لا مزايا جديدة ولا قوائم تتحرّك ولا شريط يتغيّر. وُجدت للأجهزة التي تكون فيها الواجهة المتغيّرة مشكلة لا ميزة: جهاز يشغّل عملية معتمَدة، أو طرفية في مصنع، أو محطة دُرّب مستخدموها مرّة على تخطيط واحد.',
      },
      {
        q: 'ما مفتاح MAK وكيف يُفعَّل؟',
        a: 'مفتاح تفعيل متعدّد من خطّ التراخيص الحجمية لا مفتاح تجزئة. يُفعَّل عبر الإنترنت، وإن رُفض فعبر الهاتف — بضع دقائق، وخطوات التفعيل التي نرسلها تغطّيه.',
      },
      {
        q: 'هل التثبيت مثل أوفيس العادي؟',
        a: 'لا. وسيط التثبيت هو Office Deployment Tool لا مثبّت المستهلك. إن لم تنشر أوفيس بهذه الطريقة من قبل وكان الجهاز واحداً، فـ أوفيس 2021 برو بلس أبسط.',
      },
    ],
    en: [
      {
        q: 'What does LTSC mean, and who is it for?',
        a: 'Long-term servicing: it receives security fixes and nothing else — no feature updates, no moved menus, no new ribbon. It exists for machines where a changing interface is a problem rather than a benefit: a workstation running a validated process, a terminal on a factory floor, a desk whose users were trained once on one layout.',
      },
      {
        q: 'What is a MAK key and how does it activate?',
        a: 'A Multiple Activation Key from the volume licensing line rather than a retail key. It activates against Microsoft over the internet, or by phone if that is declined — a few minutes, and the activation steps we send cover it.',
      },
      {
        q: 'Is installation the same as ordinary Office?',
        a: 'No. The media is the Office Deployment Tool rather than a consumer installer. If you have not deployed Office that way before and this is a single machine, Office 2021 Pro Plus is simpler.',
      },
    ],
  },
};
