/**
 * FAQs for the PDF, design, virtualisation and developer products, plus the
 * two bundles and the account-delivered subscriptions.
 *
 * The recurring question across this group is which of two near-identical
 * listings to buy — Nitro online against manual activation, CorelDRAW Graphics
 * against Technical, Parallels against VMware, Visual Studio Professional
 * against Enterprise. Each page answers that directly and names the case where
 * the other one wins, because a buyer who picks wrong here asks for a refund
 * rather than a replacement.
 */
import type { ProductFaq } from './windows-and-office.js';

export const FAQ_TOOLS: Record<string, ProductFaq> = {
  'adobe-acrobat-pro-dc': {
    ar: [
      {
        q: 'ما الذي يفعله ولا يفعله قارئ PDF مجاني؟',
        a: 'أربعة أعمال: تحرير النصّ والصور داخل ملف PDF جاهز بلا ملف أصلي، وOCR يحوّل عقداً ممسوحاً ضوئياً إلى نصّ قابل للبحث والنسخ، وتنقيح يحذف المعلومة فعلاً بدل رسم مربّع أسود فوقها، ومقارنة نسختين وسرد الفروق بدل البحث عنها.',
      },
      {
        q: 'لماذا يطلب مني بريداً إلكترونياً عند الشراء؟',
        a: 'لأن الترخيص كود استرداد يُربط بحساب Adobe. أعطِ البريد الذي تستخدمه مع Adobe أو الذي تنوي استخدامه — الترخيص يعيش على ذلك الحساب ويتحرّك معه، فلا يمكن نقل الكود إلى شخص آخر بعد الاسترداد.',
      },
      {
        q: 'هل يشمل النسخة على الهاتف والويب؟',
        a: 'نعم. بعد الاسترداد يغطّي الترخيص Acrobat على سطح المكتب وعلى الويب وعلى تطبيقات الجوال، وملفاتك متوافقة بينها.',
      },
    ],
    en: [
      {
        q: 'What does it do that a free PDF reader cannot?',
        a: 'Four jobs: editing text and images inside a finished PDF with no original to go back to; OCR, which turns a scanned contract into searchable, selectable text; redaction, which removes information rather than drawing a black box over it; and compare, which lists the differences between two revisions instead of making you hunt them.',
      },
      {
        q: 'Why does checkout ask for an email address?',
        a: 'Because the licence is a redeem code tied to an Adobe account. Give the address you already use with Adobe, or intend to — the licence lives on that account and travels with it, so the code cannot be moved to another person after redemption.',
      },
      {
        q: 'Does it cover the mobile and web versions?',
        a: 'Yes. Once redeemed it covers Acrobat on desktop, on the web and on the mobile apps, and your files stay in step across them.',
      },
    ],
  },

  'adobe-creative-cloud': {
    ar: [
      {
        q: 'ما التطبيقات المشمولة؟',
        a: 'المجموعة الكاملة: Photoshop وIllustrator وInDesign وPremiere Pro وAfter Effects وLightroom وLightroom Classic وAudition وAnimate وDreamweaver وبقيّة الكتالوج — مع Adobe Fonts وسعة تخزين سحابية.',
      },
      {
        q: 'كيف أختار بين المدد؟',
        a: 'شهر يناسب تسليماً واحداً — هوية بصرية، فيديو، كتالوج — حيث يكون شراء سنة دفعاً لأحد عشر شهراً من لا شيء. وسنة هي اختيار العمل المستمرّ، وتكلفة الشهر فيها تنخفض تبعاً لذلك.',
      },
      {
        q: 'لماذا يُطلب بريدي عند الشراء؟',
        a: 'لأنه كود استرداد على حساب Adobe. ملفاتك وإعداداتك وخطوطك تتبع ذلك الحساب إلى أي جهاز تسجّل الدخول منه — فأعطِ الحساب الذي تعمل به فعلاً.',
      },
    ],
    en: [
      {
        q: 'Which applications are included?',
        a: 'The complete set: Photoshop, Illustrator, InDesign, Premiere Pro, After Effects, Lightroom and Lightroom Classic, Audition, Animate, Dreamweaver and the rest of the catalogue — with Adobe Fonts and cloud storage.',
      },
      {
        q: 'How do I choose a term?',
        a: 'A month suits a single delivery — a brand identity, one video, a catalogue — where a year would be paying for eleven months of nothing. A year is the choice for continuous work, and the per-month cost falls accordingly.',
      },
      {
        q: 'Why does checkout ask for my email?',
        a: 'Because it is a redeem code against an Adobe account. Your files, settings and fonts follow that account to any machine you sign in on — so give the account you actually work under.',
      },
    ],
  },

  'autodesk-all-apps': {
    ar: [
      {
        q: 'لماذا الحزمة بدل منتج واحد؟',
        a: 'لأن مشروعاً حقيقياً نادراً ما يستخدم واحداً: مبنى يمرّ بـ Revit للنموذج وAutoCAD للمخطّطات وCivil 3D للموقع وNavisworks لكشف التعارضات. اثنان منها مشتريان منفصلين يكلّفان أكثر من الحزمة كاملة — وهذه هي الحسبة كلها.',
      },
      {
        q: 'كيف يصل الترخيص؟',
        a: 'كود استرداد على حساب Autodesk، ولهذا يطلب الشراء بريداً إلكترونياً. بعد الاسترداد تتاح كل تطبيقات الحزمة للتنزيل من ذلك الحساب، والترخيص يتبع الحساب لا الجهاز.',
      },
    ],
    en: [
      {
        q: 'Why the collection rather than a single product?',
        a: 'Because a real project rarely uses only one: a building goes through Revit for the model, AutoCAD for the drawings, Civil 3D for the site and Navisworks for clash detection. Any two of those bought separately cost more than the whole collection — that is the entire arithmetic.',
      },
      {
        q: 'How does the licence arrive?',
        a: 'As a redeem code against an Autodesk account, which is why checkout asks for an email address. Once redeemed, every application in the collection is available to download from that account, and the licence follows the account rather than the machine.',
      },
    ],
  },

  'canva-pro': {
    ar: [
      {
        q: 'ما الذي يفتحه الاشتراك المدفوع؟',
        a: 'ثلاثة تحمل الاشتراك عند أغلب الناس: مزيل الخلفية بنقرة، وحقيبة الهوية التي تُثبّت شعاراً ولوحة ألوان وخطّين على كل تصميم، وMagic Resize الذي يحوّل تصميماً واحداً إلى كل المقاسات الأخرى. ومعها المكتبة المدفوعة كاملة ومجلّدات بلا حدّ وجدولة النشر.',
      },
      {
        q: 'ما الفرق عن Canva Edu؟',
        a: 'Edu تضيف الجانب الصفّي — مساحة عمل للصفّ ومهام تُسند وتُجمع وتعاون بين الطلاب. لا قيمة لها خارج التعليم، وهي الخطّة الصحيحة داخله.',
      },
    ],
    en: [
      {
        q: 'What does the paid tier unlock?',
        a: 'Three features carry it for most people: one-click background removal, brand kits that fix a logo, palette and fonts across every design, and Magic Resize, which turns one finished design into every other size it is needed in. Plus the full premium library, unlimited folders and post scheduling.',
      },
      {
        q: 'How does it differ from Canva Edu?',
        a: 'Edu adds the classroom side — a shared class workspace, assignments you set and collect, and student collaboration. That is worth nothing outside teaching and is the right plan inside it.',
      },
    ],
  },

  'canva-edu': {
    ar: [
      {
        q: 'ماذا يصلني — مفتاح أم حساب؟',
        a: 'بيانات دخول. تسجّل الدخول على canva.com وتكون الخطّة على الحساب أصلاً. لا شيء يُثبَّت، فيعمل كما هو على لابتوب وجهاز لوحي وهاتف.',
      },
      {
        q: 'ما الذي تضيفه خطّة التعليم على Pro؟',
        a: 'مساحة عمل للصفّ، ومهام تُسند وتُجمع، وتعاون بين الطلاب دون أن يحتاج كل طالب خطّة مدفوعة خاصة به. أمّا مزايا التصميم — المكتبة المدفوعة ومزيل الخلفية وحقائب الهوية — فهي نفسها.',
      },
      {
        q: 'هل أغيّر كلمة المرور؟',
        a: 'نعم، بعد أوّل تسجيل دخول، واحتفظ بتصاميمك في مجلّد خاصّ بك ليسهل إيجادها.',
      },
    ],
    en: [
      {
        q: 'What arrives — a key or an account?',
        a: 'Sign-in credentials. You sign in at canva.com and the plan is already on the account. Nothing is installed, so it behaves the same on a laptop, a tablet and a phone.',
      },
      {
        q: 'What does the Education plan add over Pro?',
        a: 'A class workspace, assignments you can set and collect back, and student collaboration without each student needing a paid plan of their own. The design features — premium library, background remover, brand kits — are the same.',
      },
      {
        q: 'Should I change the password?',
        a: 'Yes, after the first sign-in — and keep your designs in a folder of your own so they stay easy to find.',
      },
    ],
  },

  'elementor-pro': {
    ar: [
      {
        q: 'ما الذي يضيفه على Elementor المجاني؟',
        a: 'المجاني يبني صفحات؛ Pro يبني **الموقع**. الفاصل هو Theme Builder: الهيدر والفوتر وقالب المقال وقالب الأرشيف وصفحة 404 تُصمَّم بصرياً. ومعه المحتوى الديناميكي الذي يجعل قالباً واحداً يخدم خمسمئة منتج، ومنشئ النماذج، ومنشئ النوافذ المنبثقة، وعناصر WooCommerce.',
      },
      {
        q: 'ماذا يحدث إن انتهى الترخيص ولم أجدّده؟',
        a: 'الموقع يبقى يعمل وتتوقّف التحديثات ومكتبة القوالب. ولأن الأمر يتعلّق بإضافة حسّاسة أمنياً، فبقاؤها بلا تحديث سبب وجيه للتجديد.',
      },
    ],
    en: [
      {
        q: 'What does it add over free Elementor?',
        a: 'Free builds pages; Pro builds the **site**. The dividing line is the Theme Builder: header, footer, single post template, archive template and 404 page designed visually. With it come dynamic content, which makes one template serve five hundred products, plus the form builder, popup builder and WooCommerce widgets.',
      },
      {
        q: 'What happens if the licence lapses?',
        a: 'The site keeps working and updates and the template library stop. Because this is a security-sensitive plugin, leaving it un-updated is a sound reason to renew.',
      },
    ],
  },

  'nitro-pdf-pro-14-activate-online': {
    ar: [
      {
        q: 'ما الفرق بين نسخة التفعيل أونلاين والنسخة اليدوية؟',
        a: 'البرنامج متطابق؛ مسار التفعيل فقط مختلف. هذه النسخة تُفعَّل عبر الإنترنت في ثوانٍ وهي الصحيحة لجهاز متّصل عادي. النسخة اليدوية موجودة للأجهزة المعزولة أو خلف شبكة تحجب فحص الترخيص، وسعرها أقلّ.',
      },
      {
        q: 'هل هو بديل عن Acrobat؟',
        a: 'يؤدّي أغلب ما يُفتح Acrobat من أجله — تحرير وOCR وتحويل من وإلى Word وExcel وتنقيح وتجميع صفحات ونماذج وتوقيع — لكن **كشراء لمرّة واحدة** بلا اشتراك شهري. وواجهته شريط أوفيس لا لوحات Acrobat، وهو ما يعني شرحاً أقلّ على مكتب ويندوز.',
      },
    ],
    en: [
      {
        q: 'What is the difference between the online and manual editions?',
        a: 'The software is identical; only the activation path differs. This edition activates over the internet in seconds and is the right choice for an ordinary connected machine. The manual edition exists for isolated machines or networks that block the licensing check, and costs less.',
      },
      {
        q: 'Is it a replacement for Acrobat?',
        a: 'It does most of what Acrobat is opened for — editing, OCR, conversion to and from Word and Excel, redaction, page assembly, forms and signatures — as a **one-time purchase** with no monthly bill. Its interface is an Office ribbon rather than Acrobat’s panels, which usually means less explaining on a Windows desk.',
      },
    ],
  },

  'nitro-pdf-pro-14-manual': {
    ar: [
      {
        q: 'ماذا يعني التفعيل اليدوي عملياً؟',
        a: 'يُنتج البرنامج كود طلب، ويُستبدل بردّ تفعيل تُدخله فيُرخَّص النسخة. دقائق إضافية مرّة واحدة، وبلا اتصال خارجي لحظة التفعيل.',
      },
      {
        q: 'متى أختاره بدل نسخة الإنترنت؟',
        a: 'لمحطّة معزولة عن الشبكة، أو جهاز خلف شبكة تحجب حركة الترخيص، أو بيئة شركة مقيّدة ترفض الفحوص الخارجة. على جهاز متّصل عادي، نسخة التفعيل أونلاين أبسط.',
      },
      {
        q: 'هل البرنامج ناقص شيئاً؟',
        a: 'لا. تحرير النصّ والصور داخل PDF، وOCR، والتحويل من وإلى أوفيس، والتجميع والتقسيم، والتنقيح، وإنشاء النماذج وتعبئتها، والحماية بكلمة مرور، والتوقيع الإلكتروني — كلّها موجودة.',
      },
    ],
    en: [
      {
        q: 'What does manual activation mean in practice?',
        a: 'The application produces a request code; that is exchanged for an activation response, which you enter to license the copy. A few extra minutes, once, and no outbound connection at the moment of activation.',
      },
      {
        q: 'When should I choose it over the online edition?',
        a: 'For an air-gapped workstation, a machine behind a network that blocks licensing traffic, or a locked-down corporate environment where outbound checks are refused. On an ordinary connected PC, the online edition is simpler.',
      },
      {
        q: 'Is anything missing from the software?',
        a: 'No. Text and image editing inside PDFs, OCR, conversion to and from Office, combining and splitting, redaction, form creation and filling, password protection and electronic signatures are all present.',
      },
    ],
  },

  'nitro-pdf-pro-13-activate-online': {
    ar: [
      {
        q: 'لماذا 13 بدل 14؟',
        a: 'للاتّساق غالباً: مكتب يشغّل Nitro 13 على عشرة أجهزة له تعليمات واحدة وواجهة يعرفها موظّفوه، وإضافة جهاز حادي عشر بالإصدار نفسه قرار أرخص. والسبب الثاني عتاد: 13 يعمل بارتياح على أجهزة ويندوز أقدم ممّا يطلبه 14.',
      },
      {
        q: 'هل أشتريه لجهاز جديد منفرد؟',
        a: 'لا، إن لم تكن تطابق بيئة قائمة. Nitro PDF Pro 14 هو الإصدار الحالي.',
      },
    ],
    en: [
      {
        q: 'Why 13 rather than 14?',
        a: 'Consistency, usually: an office running Nitro 13 on ten machines has one set of instructions and an interface its staff know, so a eleventh machine at the same version is the cheaper decision. The second reason is hardware — 13 runs comfortably on older Windows machines than 14 asks for.',
      },
      {
        q: 'Should I buy it for a single new machine?',
        a: 'Not unless you are matching an existing estate. Nitro PDF Pro 14 is the current release.',
      },
    ],
  },

  'nitro-pdf-pro-13-12-11-10-9': {
    ar: [
      {
        q: 'ما الإصدارات التي تغطّيها هذه الرخصة؟',
        a: 'الإصدارات من 9 إلى 13، برخصة واحدة — فبيئة مختلطة لا تحتاج شراءً مختلفاً لكل جهاز.',
      },
      {
        q: 'لمن هي؟',
        a: 'لمكتب موحَّد على إصدار أقدم: سير عمل مستندات بُني عليه، أو موظّفون دُرّبوا على واجهته، أو أجهزة قديمة بما يكفي ألّا يعمل عليها إصدار حديث بارتياح. لا أحد يختار Nitro 9 لجهاز جديد.',
      },
      {
        q: 'هل هذه الإصدارات مدعومة؟',
        a: 'لا تتلقّى تحديثات من Nitro. على جهاز يفتح مستندات قادمة من خارج الشركة، الإصدار 14 هو الرخصة الأسلم.',
      },
    ],
    en: [
      {
        q: 'Which versions does this licence cover?',
        a: 'Versions 9 through 13 in one licence, so a mixed estate does not need a different purchase per machine.',
      },
      {
        q: 'Who is it for?',
        a: 'An office standardised on an older release — a document workflow built against it, staff trained on its interface, or machines old enough that a current version would not run well. Nobody chooses Nitro 9 for a new machine.',
      },
      {
        q: 'Are these versions still supported?',
        a: 'They receive no updates from Nitro. On a machine that opens documents from outside the business, version 14 is the safer licence.',
      },
    ],
  },

  'corelddraw-graphics-suit-2026': {
    ar: [
      {
        q: 'ما الفرق عن إصدارات 2024 و2025؟',
        a: 'هذا الأحدث، وأهميّته في أمر واحد: يفتح ملفات كل الإصدارات الأقدم، والأقدم لا تفتح ملفاته بثبات. إن كنت تتبادل تصاميم مع عملاء أو مطابع، فالبقاء على الإصدار الحالي هو الموضع الذي لا يعطّل عملاً أبداً.',
      },
      {
        q: 'هل هو اشتراك؟',
        a: 'لا، ترخيص دائم يُشترى مرّة ويبقى يعمل. هذه هي الحجّة الأساسية مقابل الحزمة المنافسة التي تُستأجر شهرياً وتتوقّف بتوقّف الدفع.',
      },
    ],
    en: [
      {
        q: 'How does it differ from the 2024 and 2025 releases?',
        a: 'This is the newest, and that matters in one specific way: it opens files from every earlier version, and earlier versions do not reliably open its files. If you exchange artwork with clients or print shops, being on the current release is the position that never blocks a job.',
      },
      {
        q: 'Is it a subscription?',
        a: 'No — a perpetual licence, bought once and kept. That is the main argument against the competing suite, which is rented monthly and stops when payment does.',
      },
    ],
  },

  'coreldraw-graphics-suite-2025-for-mac': {
    ar: [
      {
        q: 'ما التطبيقات في الحزمة؟',
        a: 'CorelDRAW للرسم المتّجه والتنسيق والمستندات متعدّدة الصفحات، وCorel PHOTO-PAINT لتحرير الصور، وFont Manager لتنظيم الخطوط وتفعيلها بلا تثبيتها كلها، وCorel CAPTURE لالتقاط الشاشة.',
      },
      {
        q: 'لماذا CorelDRAW بدل Illustrator؟',
        a: 'أمران دائماً: نموذج **المستند متعدّد الصفحات** الذي يناسب كتالوجاً أو مجموعة لافتات، وتصدير تقبله مطابع وورش القصّ بلا جدال. هو تقليدياً أداة العمل الذي ينتهي مقصوصاً أو مطبوعاً أو محفوراً.',
      },
    ],
    en: [
      {
        q: 'What applications are in the suite?',
        a: 'CorelDRAW for vector illustration, layout and multi-page documents; Corel PHOTO-PAINT for image editing; Font Manager for organising and activating typefaces without installing every one; and Corel CAPTURE for screen capture.',
      },
      {
        q: 'Why CorelDRAW rather than Illustrator?',
        a: 'Two things, consistently: the **multi-page document** model that suits a catalogue or a set of signs, and export that print and cutting shops accept without argument. It is traditionally the tool for work that ends up cut, printed or engraved.',
      },
    ],
  },

  'coreldraw-graphics-suite-2024-for-mac': {
    ar: [
      {
        q: 'ما الذي أفقده مقابل الإصدار الأحدث؟',
        a: 'قليل عملياً — الفارق بين إصدارَي CorelDRAW متتاليين تحسين لا إعادة اختراع. ما يهمّ هو التبادل: إن أرسلت إليك مطبعة أو عميل ملفات 2025 أو 2026 فقد يظهر تنبيه إصدار. إن كنت تعمل وحدك أو ترسل ولا تستقبل، فهذا لا يحدث.',
      },
      {
        q: 'هل هو ترخيص دائم؟',
        a: 'نعم، يُشترى مرّة ويبقى — وبسعر أقلّ من الإصدار الحالي.',
      },
    ],
    en: [
      {
        q: 'What am I giving up against the newer release?',
        a: 'Little in practice — the gap between consecutive CorelDRAW releases is refinement rather than reinvention. What matters is exchange: if a print shop or client sends you 2025 or 2026 files, you can meet a version prompt. Working alone, or sending rather than receiving, it never arises.',
      },
      {
        q: 'Is it a perpetual licence?',
        a: 'Yes — bought once and kept, at a lower price than the current release.',
      },
    ],
  },

  'coreldraw-technical-suite-2025-for-windows': {
    ar: [
      {
        q: 'ما الفرق بينه وبين Graphics Suite؟',
        a: 'عمل مختلف تماماً. هذه حزمة **التوثيق** لا التصميم: Corel DESIGNER يستورد تجميعات CAD ثلاثية الأبعاد ويحوّلها إلى مشاهد تقنية ثنائية — رسوم مفكّكة ومقاطع وخطوات تركيب — مع بقاء الهندسة دقيقة لا مرسومة بالعين. إن كان عملك شعاراً أو لافتة أو طباعة قماش، فـ Graphics Suite هو الصحيح وأرخص.',
      },
      {
        q: 'لمن هي؟',
        a: 'مصنّعون يُنتجون أدلّة صيانة، ومكاتب هندسية ترسم كتالوجات قطع غيار، ومؤلّفون تقنيّون يوثّقون التركيب والصيانة.',
      },
    ],
    en: [
      {
        q: 'How does it differ from the Graphics Suite?',
        a: 'Entirely different work. This is the **documentation** suite, not the design one: Corel DESIGNER imports 3D CAD assemblies and turns them into accurate 2D technical views — exploded diagrams, sections, assembly steps — keeping the geometry true rather than drawn by eye. If your work is a logo, a sign or a garment print, the Graphics Suite is correct and costs less.',
      },
      {
        q: 'Who buys it?',
        a: 'Manufacturers producing service manuals, engineering firms drawing parts catalogues, and technical authors documenting assembly and maintenance.',
      },
    ],
  },

  'coreldraw-technical-suite-2024-for-windows': {
    ar: [
      {
        q: 'هل يستحقّ توفير السعر مقابل الإصدار الأحدث؟',
        a: 'غالباً نعم. التوثيق التقني يتغيّر ببطء، ودليل مؤلَّف في 2024 لا يستفيد من صيغة ملفّ أحدث. الاستثناء أن تستقبل ملفات مصدرية ممّن هو على الإصدار الحالي.',
      },
      {
        q: 'هل Corel DESIGNER كامل في هذا الإصدار؟',
        a: 'نعم. استيراد CAD، والإسقاط المتساوي القياس، والتسميات الديناميكية التي تبقى مرتبطة بقطعها عبر المراجعات، والتصدير إلى صيغ النشر التقني ومنها WebCGM.',
      },
    ],
    en: [
      {
        q: 'Is the saving worth it against the newer release?',
        a: 'Usually yes. Technical documentation changes slowly, and a manual authored in 2024 does not benefit from a newer file format. The exception is receiving source files from somebody on the current release.',
      },
      {
        q: 'Is Corel DESIGNER complete in this edition?',
        a: 'Yes. CAD import, isometric projection, dynamic callouts that stay bound to their components through revisions, and export to the technical publishing formats including WebCGM.',
      },
    ],
  },

  'parallels-desktop-26-standard': {
    ar: [
      {
        q: 'هل يعمل على أجهزة Apple Silicon؟',
        a: 'نعم، ويشغّل نسخة ARM من ويندوز. Boot Camp غير موجود على معالجات Apple أصلاً، فالمحاكاة هي الطريق الوحيد إلى ويندوز على ماك حديث.',
      },
      {
        q: 'ما حدود النسخة Standard؟',
        a: 'حتى 8 جيجابايت ذاكرة و4 أنوية للجهاز الافتراضي، وجهاز واحد يعمل في المرّة. يكفي تماماً لأوفيس أو تطبيق محاسبة أو برنامج عمل لا يعمل إلا على ويندوز. لا يكفي لبيئة تطوير أو قاعدة بيانات أو تشغيل نظامين معاً.',
      },
      {
        q: 'ما Coherence؟',
        a: 'وضع يُخفي نافذة ويندوز تماماً فتظهر تطبيقاته في Dock وMission Control كتطبيقات ماك أصلية، مع مشاركة الملفات والحافظة والطابعات بين النظامين.',
      },
    ],
    en: [
      {
        q: 'Does it work on Apple Silicon?',
        a: 'Yes, running the ARM build of Windows. Boot Camp does not exist on Apple Silicon at all, so virtualisation is the only route to Windows on a modern Mac.',
      },
      {
        q: 'What are the Standard limits?',
        a: 'Up to 8 GB of memory and 4 cores assigned to a virtual machine, and one running at a time. Ample for Office, an accounting package or a Windows-only line-of-business application. Not enough for a development environment, a database, or two systems at once.',
      },
      {
        q: 'What is Coherence?',
        a: 'A mode that hides the Windows window entirely, so Windows applications appear in the Dock and Mission Control like native ones, with files, clipboard and printers shared between the two systems.',
      },
    ],
  },

  'parallels-desktop-26-pro': {
    ar: [
      {
        q: 'ما الذي يرفعه Pro عن Standard؟',
        a: 'حدود الجهاز الافتراضي: حتى 128 جيجابايت ذاكرة و32 نواة بدل 8 و4. ومعها أدوات المطوّر: اللقطات (snapshots)، ومحاكي ظروف الشبكة، وتكامل Visual Studio وJetBrains، وواجهة سطر أوامر.',
      },
      {
        q: 'ما فائدة اللقطات؟',
        a: 'تلتقط حالة الجهاز بالضبط، فتكسره عمداً وتعود ثوانٍ. اختبار مثبّت أو تعريف أو ترقية يتوقّف عن كونه شيئاً تفعله بحذر.',
      },
      {
        q: 'Pro أم Business؟',
        a: 'Pro مرخَّص للشخص وهو الصحيح لمطوّر أو مختبِر يعمل وحده. Business يضيف الإدارة المركزية ومفتاح ترخيص حجمي وواجهة إدارة موحّدة — يستحقّ حين ينشر قسم تقنية على فريق، ولا يستحقّ شيئاً حين لا يفعل.',
      },
    ],
    en: [
      {
        q: 'What does Pro raise over Standard?',
        a: 'The virtual machine limits: up to 128 GB of memory and 32 cores instead of 8 and 4. With them come the developer tools — snapshots, a network conditioner, Visual Studio and JetBrains integration, and a command-line interface.',
      },
      {
        q: 'What are snapshots for?',
        a: 'They capture a machine’s exact state, so you can break it deliberately and roll back in seconds. Testing an installer, a driver or an upgrade stops being something you do carefully.',
      },
      {
        q: 'Pro or Business?',
        a: 'Pro is licensed per person and is right for a developer or tester working alone. Business adds centralised management, a volume licence key and a unified console — worth it when an IT department deploys to a team, and worth nothing when it does not.',
      },
    ],
  },

  'parallels-desktop-26-business': {
    ar: [
      {
        q: 'ما الذي يضيفه على Pro؟',
        a: 'طبقة الإدارة: مفتاح ترخيص حجمي واحد للمنشأة بدل رخصة لكل جهاز، وبوّابة إدارة تعرض كل تثبيت وترخيصه وأجهزته الافتراضية، ونشر جهاز افتراضي مُعدّ مسبقاً على أسطول كامل، وسياسات تقيّد ما يغيّره المستخدمون.',
      },
      {
        q: 'هل يشمل كل مزايا Pro؟',
        a: 'نعم: نفس الحدود المرتفعة — حتى 128 جيجابايت و32 نواة — مع اللقطات ومحاكي الشبكة وتكامل بيئات التطوير وسطر الأوامر.',
      },
    ],
    en: [
      {
        q: 'What does it add over Pro?',
        a: 'The management layer: one volume licence key for the organisation rather than a licence per machine, a portal showing every installation with its licence and virtual machines, deployment of a prepared virtual machine to a whole fleet, and policies that limit what users may change.',
      },
      {
        q: 'Does it include everything in Pro?',
        a: 'Yes — the same raised limits of up to 128 GB and 32 cores, plus snapshots, the network conditioner, IDE integration and the command line.',
      },
    ],
  },

  'vmware-workstation-pro-17-for-windows-linux': {
    ar: [
      {
        q: 'ما الفرق بينه وبين أداة محاكاة عادية؟',
        a: 'أنه يتوقّع أكثر من جهاز واحد. الشبكات الافتراضية تتيح بناء بنية كاملة على حاسب واحد — متحكّم دومين وخادم وجهازا عميل على شبكة خاصّة بهم — وهي الطريقة التي يتعلّم بها ويختبر بها أغلب الناس بلا شراء عتاد.',
      },
      {
        q: 'ما النسخ المستنسخة المرتبطة (linked clones)؟',
        a: 'نسخة تتشارك قرص الأصل، فعشرون جهازاً تكلّف مساحة جهاز واحد والفروق فقط. هي ما يجعل بناء مختبر من عشرين آلة ممكناً على لابتوب.',
      },
      {
        q: 'هل يعمل على ماك؟',
        a: 'لا. هذا لويندوز ولينكس. على الماك النظير هو VMware Fusion Pro.',
      },
    ],
    en: [
      {
        q: 'How does it differ from an ordinary virtualisation tool?',
        a: 'It expects more than one guest. Virtual networks let you build a whole topology on one PC — a domain controller, a server and two clients on their own subnet — which is how most people learn and test infrastructure without buying any.',
      },
      {
        q: 'What are linked clones?',
        a: 'A copy that shares the parent’s disk, so twenty machines cost the space of one and the differences. That is what makes a twenty-machine lab possible on a laptop.',
      },
      {
        q: 'Does it run on a Mac?',
        a: 'No — this is for Windows and Linux. On a Mac the equivalent is VMware Fusion Pro.',
      },
    ],
  },

  'vmware-fusion-pro-13-for-mac': {
    ar: [
      {
        q: 'هل يشغّل ويندوز 11 على Apple Silicon؟',
        a: 'نعم. Fusion Pro 13 يدعم ويندوز 11 على معالجات Apple مع TPM افتراضي، وهو ما يجعل تشغيل ويندوز مرخَّص ومدعوم ممكناً على ماك من سلسلة M.',
      },
      {
        q: 'Fusion أم Parallels؟',
        a: 'Parallels أسلس لتشغيل تطبيق ويندوز بجانب macOS — وضع Coherence والتكامل مع سطح المكتب أفضل. Fusion هو الاختيار حين تكون الأجهزة الافتراضية نفسها هي العمل: عدّة أجهزة معاً، على شبكتها الخاصّة، بشجرة لقطات، ومُعدّة بنفس طريقة بنية VMware في مكان آخر.',
      },
    ],
    en: [
      {
        q: 'Does it run Windows 11 on Apple Silicon?',
        a: 'Yes. Fusion Pro 13 supports Windows 11 on Apple Silicon with a virtual TPM, which is what makes a licensed, supported Windows possible on an M-series Mac.',
      },
      {
        q: 'Fusion or Parallels?',
        a: 'Parallels is smoother for running a Windows application beside macOS — Coherence mode and the desktop integration are better. Fusion is the choice when the virtual machines themselves are the work: several at once, on their own network, with snapshot trees, configured the same way as VMware infrastructure elsewhere.',
      },
    ],
  },

  'visual-studio-2022-professional': {
    ar: [
      {
        q: 'ما أهمّية كونه أوّل إصدار 64-بت؟',
        a: 'كل Visual Studio قبل 2022 كان عملية 32-بت محدودة بنحو 4 جيجابايت مهما كانت ذاكرة الجهاز، وعلى حلّ فيه مئات المشاريع كان ذلك السقف يُبلَغ يومياً. 2022 أزاله — ولقواعد الشيفرة الكبيرة هذا وحده سبب الترقية.',
      },
      {
        q: 'ما الذي يضيفه Enterprise؟',
        a: 'طبقة الاختبار والتحليل: Live Unit Testing وIntelliTest وCode Map والتحقّق من البنية المعمارية. أدوات على مقياس الفريق — ولمطوّر منفرد أو فريق صغير، Professional هو الترخيص الصحيح.',
      },
    ],
    en: [
      {
        q: 'Why does being the first 64-bit release matter?',
        a: 'Every Visual Studio before 2022 was a 32-bit process capped at roughly 4 GB however much memory the machine had, and on a solution with hundreds of projects that ceiling was reached daily. 2022 removed it — for large codebases that alone is the reason to upgrade.',
      },
      {
        q: 'What does Enterprise add?',
        a: 'The testing and analysis tier: Live Unit Testing, IntelliTest, Code Map and architectural validation. Those are team-scale tools — for an individual developer or a small team, Professional is the correct licence.',
      },
    ],
  },

  'visual-studio-2022-enterprise': {
    ar: [
      {
        q: 'ما الذي لا يوجد إلا في Enterprise؟',
        a: '**Live Unit Testing** يشغّل الاختبارات المتأثّرة أثناء الكتابة ويعلّم كل سطر في المحرّر بأنه مغطّى أو ناجح أو فاشل. و**IntelliTest** يولّد حالات اختبار ومدخلات من الشيفرة نفسها. و**Code Map** والتحقّق من الاعتماديات يرسمان البنية الحقيقية للحلّ ويُفشلان البناء عند خرق طبقة.',
      },
      {
        q: 'من يحتاج هذه الطبقة؟',
        a: 'فرق تصون قاعدة شيفرة كبيرة طويلة العمر، ومن عليه التزام تغطية أو التزام معماري يجب إثباته لا ادّعاؤه. لكتابة البرمجيات وشحنها بلا هذه الالتزامات، Professional هو نفس المحرّر والمصحّح بسعر أقلّ بكثير.',
      },
    ],
    en: [
      {
        q: 'What exists only in Enterprise?',
        a: '**Live Unit Testing** runs the affected tests as you type and marks each line in the editor as covered, passing or failing. **IntelliTest** generates test cases and inputs from the code itself. **Code Map** and dependency validation draw the real structure of a solution and fail the build when a layer is violated.',
      },
      {
        q: 'Who needs this tier?',
        a: 'Teams maintaining a large long-lived codebase, and anyone under a coverage or architectural requirement they must demonstrate rather than assert. For writing and shipping software without those obligations, Professional is the same editor and debugger for much less.',
      },
    ],
  },

  'visual-studio-2026-professional': {
    ar: [
      {
        q: 'لماذا الإصدار الحالي وليس 2022؟',
        a: 'لأن سلسلة الأدوات تتحرّك معه: أحدث أهداف .NET وC++، وحِزم SDK الحالية، وعمل المصحّح والمحلّل الذي يأتي مع كل إصدار. مشروع يبدأ على الإصدار الحالي لن يحتاج ترقية بيئة التطوير قبل أن يتبنّى إطاراً جديداً.',
      },
      {
        q: 'كيف يُرخَّص؟',
        a: 'يُربط بحساب مايكروسوفت الذي تحدّده عند الشراء لا بمفتاح تُدخله. سجّل الدخول بذلك الحساب في Visual Studio ويكون الترخيص حاضراً، ويتبع الحساب إلى جهاز جديد بدل أن يبقى على القديم.',
      },
    ],
    en: [
      {
        q: 'Why the current release rather than 2022?',
        a: 'Because the toolchain moves with it: the newest .NET and C++ targets, current SDKs, and the debugger and profiler work each release brings. A project started on the current version will not need the IDE upgraded before it can adopt a new framework.',
      },
      {
        q: 'How is it licensed?',
        a: 'It binds to the Microsoft account you name at checkout rather than to a key you type. Sign in to Visual Studio with that account and the licence is present, and it follows the account to a new machine rather than staying with the old one.',
      },
    ],
  },

  'starter-bundle-windows-11-pro-office-365': {
    ar: [
      {
        q: 'ماذا يصلني بالضبط؟',
        a: 'شيئان مختلفان: **مفتاح تفعيل** لويندوز تُدخله في الإعدادات، و**اسم مستخدم وكلمة مرور** لأوفيس تسجّل بهما الدخول. يُفعَّلان في مكانين مختلفين ولا يُغني أحدهما عن الآخر.',
      },
      {
        q: 'لماذا أشتريهما معاً؟',
        a: 'لأنهما الشراءان اللذان يتبعان كل تجميع جهاز أو إعادة تثبيت تقريباً، وشراؤهما معاً أرخص من شرائهما منفصلين.',
      },
      {
        q: 'هل يعمل على أي جهاز؟',
        a: 'تحقّق من العتاد أولاً: ويندوز 11 يتطلّب TPM 2.0 وSecure Boot. شغّل PC Health Check قبل الطلب.',
      },
    ],
    en: [
      {
        q: 'What exactly arrives?',
        a: 'Two different things: an **activation key** for Windows that you enter in Settings, and a **username and password** for Office that you sign in with. They are activated in different places and neither substitutes for the other.',
      },
      {
        q: 'Why buy them together?',
        a: 'Because they are the two purchases that follow almost every PC build or reinstall, and buying them together costs less than buying them apart.',
      },
      {
        q: 'Will it work on any machine?',
        a: 'Check the hardware first: Windows 11 requires TPM 2.0 and Secure Boot. Run PC Health Check before ordering.',
      },
    ],
  },

  'protection-bundle-windows-11-pro-office-365-mcafee': {
    ar: [
      {
        q: 'ما الفرق عن الحزمة المبدئية؟',
        a: 'إضافة McAfee — وهو الجزء الوحيد في الشراء الذي يحمي شيئاً غير هذا الجهاز: يغطّي ويندوز وماك وأندرويد وiOS، أي الهواتف والأجهزة اللوحية حول الكمبيوتر أيضاً.',
      },
      {
        q: 'بأي ترتيب أُعدّها؟',
        a: 'فعّل ويندوز أولاً، ثم سجّل الدخول إلى أوفيس، وثبّت McAfee أخيراً. مضاد فيروسات يُثبَّت قبل تفعيل النظام وتحديثه هو السبب المعتاد لتعارض اليوم الأول.',
      },
      {
        q: 'كم شيئاً يصلني؟',
        a: 'ثلاثة: مفتاح ويندوز، واسم مستخدم وكلمة مرور لأوفيس، واشتراك McAfee. كلّ منها يُفعَّل في مكانه.',
      },
    ],
    en: [
      {
        q: 'How does it differ from the Starter Bundle?',
        a: 'McAfee is added — the only part of the purchase that protects anything other than this machine. It covers Windows, Mac, Android and iOS, so the phones and tablets around the PC as well.',
      },
      {
        q: 'In what order should I set it up?',
        a: 'Activate Windows first, sign in to Office second, install McAfee last. Antivirus installed before the system is activated and updated is the usual cause of a first-day conflict.',
      },
      {
        q: 'How many things arrive?',
        a: 'Three: a Windows key, an Office username and password, and a McAfee subscription. Each is activated in its own place.',
      },
    ],
  },
};
