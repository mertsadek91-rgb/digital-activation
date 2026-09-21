/**
 * Sections added to the three posts that were thin once the padding came out.
 *
 * Removing the baked-in WooCommerce listings took 369 words of prose out of a
 * post that had looked like 1,100, and the audit stopped flattering them. What
 * it exposed in one case was not thinness but breakage: a how-to titled
 * "خطوات تفعيل اشتراك Microsoft Office 365 على أجهزة متعددة" that had exactly
 * one step. Step 1 was signing in. There was no step 2. The reader was then
 * sent to the conclusion.
 *
 * So these are not padding added to hit a word count. Each is the part the
 * article already promised and did not deliver:
 *
 *   The Office 365 post gets the four steps after signing in, the device limit
 *   explained as the rotation it actually is, and what to do when activation
 *   is refused — which is the question support actually receives.
 *
 *   The Word and Excel shortcut posts each had the basics twice over — copy,
 *   paste, bold, save — and nothing on the shortcuts that save real time:
 *   moving and selecting by block, and in Excel the ones that change how a
 *   sheet gets built. Both also get the Mac column, because half the readers
 *   are on one and Ctrl is not Cmd everywhere.
 *
 * Inserted before each article's closing section rather than appended after
 * it, so the conclusion stays where a conclusion belongs.
 */
import type { Block } from '../../body.js';

export interface Expansion {
  /** The opening tag of the closing section; new blocks go above it. */
  insertBefore: string;
  blocks: Block[];
}

export const EXPANSIONS: Record<string, Expansion> = {
  'activate-office-365-on-multiple-devices': {
    insertBefore: '<h2>استمتع بتجربة Office 365 على كل أجهزتك</h2>',
    blocks: [
      { type: 'heading', level: 3, text: '2. تنزيل التطبيقات من صفحة حسابك' },
      {
        type: 'richText',
        html: '<p>بعد تسجيل الدخول على <strong>office.com</strong> تجد زرّ <em>تثبيت التطبيقات</em> (Install apps) أعلى يمين الصفحة. اختر <em>تطبيقات Microsoft 365</em> ليبدأ تنزيل مُثبِّت صغير — هو ليس البرامج نفسها، بل أداة تجلبها بعد التشغيل، فلا تقلق من صغر حجمه.</p><p>على ويندوز شغّل الملف واتركه؛ التثبيت يجلب Word وExcel وPowerPoint وOutlook معاً ولا يمكن اختيار بعضها دون بعض من هذه الشاشة. على الماك تُنزَّل حزمة <code>.pkg</code> تمرّ بخطوات التثبيت المعتادة. لا تحتاج مفتاحاً في أي من الحالتين — وهذا هو الفرق الجوهري بين الاشتراك والترخيص الدائم.</p>',
      },
      { type: 'heading', level: 3, text: '3. التفعيل يحدث من داخل التطبيق' },
      {
        type: 'richText',
        html: '<p>افتح Word — أو أي تطبيق من الحزمة — بعد انتهاء التثبيت. سيطلب تسجيل الدخول. أدخل نفس بيانات الحساب التي استخدمتها على office.com، وسيظهر اسم الاشتراك في <em>ملف ← الحساب</em> (File ← Account) عند نجاح التفعيل.</p><p>هنا يتوقّف كثير من الناس بسبب خطأ شائع: تثبيت التطبيقات وحده لا يُفعّلها. النسخة غير المفعَّلة تفتح الملفات وتعرضها لكنها ترفض الحفظ والتحرير بعد مدّة، وتُظهر شريطاً أصفر أعلى النافذة. تسجيل الدخول داخل التطبيق هو خطوة التفعيل، لا خطوة إضافية.</p>',
      },
      { type: 'heading', level: 3, text: '4. أعد الخطوتين على كل جهاز' },
      {
        type: 'richText',
        html: '<p>لا شيء يختلف على الجهاز الثاني: افتح office.com، سجّل الدخول بالحساب نفسه، نزّل، ثبّت، وسجّل الدخول داخل التطبيق. لا يوجد «نقل ترخيص» ولا إلغاء تفعيل الجهاز الأول.</p><p>على الهاتف والجهاز اللوحي نزّل التطبيقات من App Store أو Google Play وسجّل الدخول بالحساب نفسه. تطبيقات الهاتف تعمل بقدرات محدودة على الحساب المجاني، ويفتح الاشتراك مزاياها الكاملة بمجرّد تسجيل الدخول.</p>',
      },
      { type: 'heading', level: 3, text: '5. إدارة الأجهزة وحدّها' },
      {
        type: 'richText',
        html: '<p>حدّ الأجهزة <strong>دورة لا جدار</strong>: تسجيل الدخول على جهاز يتجاوز الحدّ يُخرج أقدم جهاز تلقائياً بدل أن يرفض الجهاز الجديد. لن ترى رسالة «وصلت للحدّ الأقصى» تمنعك — سترى أن جهازاً قديماً طلب تسجيل الدخول من جديد.</p><p>لرؤية القائمة وإدارتها، افتح <strong>account.microsoft.com/devices</strong> وسجّل الدخول. من هناك تستطيع إخراج جهاز بعينه — وهو ما تفعله قبل بيع لابتوب أو تسليمه، لأن إزالة التطبيقات من الجهاز لا تُخرج الحساب منه.</p>',
      },
      { type: 'heading', level: 2, text: 'إذا رفض التفعيل: ثلاثة أسباب شائعة' },
      {
        type: 'richText',
        html: '<p><strong>حساب مختلف.</strong> أكثر سبب يتكرّر: التثبيت من حساب وتسجيل الدخول داخل التطبيق بحساب آخر — بريد شخصي مثلاً بدل بريد الاشتراك. افتح <em>ملف ← الحساب</em> وانظر أي بريد ظاهر هناك قبل أي شيء آخر.</p><p><strong>نسخة أوفيس قديمة على الجهاز.</strong> وجود Office 2016 أو 2019 مثبَّتاً بجانب الاشتراك يُربك التفعيل كثيراً. أزل النسخة القديمة من «إضافة أو إزالة البرامج» ثم أعد تشغيل الجهاز.</p><p><strong>ساعة الجهاز.</strong> تفعيل الاشتراك يتحقّق من تاريخ صالح، وجهاز ساعته متأخّرة أو متقدّمة بأشهر يُرفض تفعيله دون سبب واضح. صحّح التاريخ والمنطقة الزمنية ثم أعد المحاولة — تبدو تافهة وهي سبب حقيقي متكرّر.</p>',
      },
      {
        type: 'specTable',
        title: 'خلاصة الخطوات',
        rows: [
          { label: '١ — الحساب', value: 'سجّل الدخول على office.com ببيانات الاشتراك' },
          { label: '٢ — التنزيل', value: 'زرّ «تثبيت التطبيقات» ← تطبيقات Microsoft 365' },
          { label: '٣ — التفعيل', value: 'افتح Word وسجّل الدخول بالحساب نفسه' },
          { label: '٤ — بقية الأجهزة', value: 'الخطوات نفسها، بلا نقل ترخيص' },
          { label: '٥ — الإدارة', value: 'account.microsoft.com/devices لإخراج جهاز' },
          { label: 'عند التجاوز', value: 'يُخرَج أقدم جهاز، ولا يُرفض الجديد' },
        ],
      },
    ],
  },

  'word-keyboard-shortcuts': {
    insertBefore: '<h2>اجعل العمل على Word أكثر سهولة وكفاءة</h2>',
    blocks: [
      { type: 'heading', level: 2, text: 'التنقّل في مستند طويل' },
      {
        type: 'richText',
        html: '<p>هذه هي الاختصارات التي توفّر وقتاً حقيقياً، لأن التمرير بالماوس في مستند من ثمانين صفحة هو ما يستهلك الوقت فعلاً — لا النسخ واللصق.</p><ul><li><strong>Ctrl + Home</strong> / <strong>Ctrl + End</strong>: أول المستند وآخره.</li><li><strong>Ctrl + ←</strong> / <strong>Ctrl + →</strong>: كلمة كاملة في كل ضغطة بدل حرف.</li><li><strong>Ctrl + ↑</strong> / <strong>Ctrl + ↓</strong>: فقرة كاملة.</li><li><strong>Ctrl + G</strong>: الانتقال إلى صفحة برقمها.</li><li><strong>Shift + F5</strong>: العودة إلى آخر موضع حرّرته — الأكثر إهمالاً وأكثرها نفعاً، خاصةً بعد فتح مستند من جديد.</li><li><strong>Ctrl + F</strong>: جزء التنقّل، ومنه تتحرّك بين العناوين بدل التمرير.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'التحديد بلا ماوس' },
      {
        type: 'richText',
        html: '<p>كل اختصار تنقّل يصبح اختصار تحديد بإضافة <strong>Shift</strong> — وهذا مبدأ واحد يغني عن حفظ قائمة ثانية.</p><ul><li><strong>Shift + Ctrl + ←/→</strong>: تحديد كلمة كلمة.</li><li><strong>Shift + Ctrl + ↓</strong>: تحديد فقرة فقرة.</li><li><strong>Shift + Ctrl + End</strong>: من موضع المؤشّر إلى نهاية المستند.</li><li><strong>Ctrl + A</strong>: المستند كله.</li><li><strong>Ctrl + Shift + F8</strong> ثم الأسهم: تحديد عمودي — لحذف ترقيم أو مسافات بادئة من عدّة أسطر معاً.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'المراجعة والتعليقات' },
      {
        type: 'richText',
        html: '<p>إن كانت مستنداتك تذهب وتعود بين أكثر من شخص، فهذه الأربعة هي عملك اليومي.</p><ul><li><strong>Ctrl + Shift + E</strong>: تشغيل «تتبّع التغييرات» وإيقافه.</li><li><strong>Ctrl + Alt + M</strong>: إضافة تعليق جديد.</li><li><strong>Alt + Ctrl + N</strong>: التنقّل إلى التغيير أو التعليق التالي.</li><li><strong>Ctrl + Shift + C</strong> ثم <strong>Ctrl + Shift + V</strong>: نسخ التنسيق ولصقه — بديل فرشاة التنسيق، وأسرع منها.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'الأنماط والجداول' },
      {
        type: 'richText',
        html: '<p>الأنماط هي ما يجعل فهرس المحتويات يبني نفسه، والاختصارات تجعل استخدامها أسرع من قائمة الأنماط.</p><ul><li><strong>Ctrl + Alt + 1</strong> / <strong>2</strong> / <strong>3</strong>: تطبيق العنوان الأول والثاني والثالث.</li><li><strong>Ctrl + Shift + N</strong>: إعادة الفقرة إلى النمط العادي.</li><li>داخل جدول: <strong>Tab</strong> للخلية التالية، و<strong>Shift + Tab</strong> للسابقة، و<strong>Tab</strong> في الخلية الأخيرة يُنشئ صفاً جديداً.</li><li><strong>Alt + Shift + ↑/↓</strong>: تحريك الصفّ — أو الفقرة خارج الجدول — لأعلى وأسفل بلا قصّ ولصق.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'على الماك: ما يتغيّر وما لا يتغيّر' },
      {
        type: 'richText',
        html: '<p>القاعدة العامة أن <strong>Cmd</strong> تحلّ محلّ <strong>Ctrl</strong>: النسخ Cmd + C، والحفظ Cmd + S، والعريض Cmd + B. لكن ثلاثة تختلف بما يستحقّ الحفظ:</p><ul><li>الانتقال إلى أول المستند وآخره: <strong>Cmd + ↑</strong> و<strong>Cmd + ↓</strong>.</li><li>تتبّع التغييرات: <strong>Cmd + Shift + E</strong>.</li><li>جزء البحث: <strong>Cmd + F</strong>، لكن «الانتقال إلى» هو <strong>Cmd + Option + G</strong>.</li></ul><p>ومفتاح <strong>Option</strong> على الماك يقوم بدور <strong>Alt</strong> في أغلب الاختصارات المركّبة.</p>',
      },
    ],
  },

  'excel-keyboard-shortcuts': {
    insertBefore: '<h2>اجعل العمل على Excel أسهل وأسرع باستخدام الاختصارات</h2>',
    blocks: [
      { type: 'heading', level: 2, text: 'التنقّل والتحديد في جدول كبير' },
      {
        type: 'richText',
        html: '<p>في ملف من عشرة آلاف صفّ، هذه الاختصارات هي الفرق بين ثانية ودقيقة.</p><ul><li><strong>Ctrl + ↓</strong> / <strong>Ctrl + ↑</strong>: القفز إلى آخر خلية مملوءة في العمود — أسرع طريقة لمعرفة حجم البيانات.</li><li><strong>Ctrl + Home</strong>: العودة إلى A1. و<strong>Ctrl + End</strong>: آخر خلية مستخدمة في الورقة.</li><li><strong>Ctrl + Shift + ↓</strong>: تحديد العمود من المؤشّر إلى آخر بياناته — الاختصار الذي يُستعمل قبل كل عملية تنسيق أو نسخ.</li><li><strong>Ctrl + Space</strong>: تحديد العمود كاملاً. <strong>Shift + Space</strong>: الصفّ كاملاً.</li><li><strong>Ctrl + Page Down</strong> / <strong>Page Up</strong>: التنقّل بين أوراق الملف.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'الإدخال والتعبئة' },
      {
        type: 'richText',
        html: '<ul><li><strong>Alt + Enter</strong>: سطر جديد <em>داخل</em> الخلية بدل الانتقال إلى ما تحتها.</li><li><strong>Ctrl + Enter</strong>: تأكيد الإدخال والبقاء في الخلية نفسها — مفيد عند مراجعة معادلة.</li><li><strong>Ctrl + D</strong> / <strong>Ctrl + R</strong>: تعبئة لأسفل ولليمين من الخلية المجاورة، بديل السحب بالماوس.</li><li><strong>Ctrl + ;</strong>: إدراج تاريخ اليوم كقيمة ثابتة لا كدالّة تتغيّر غداً.</li><li><strong>Ctrl + Shift + V</strong> أو <strong>Ctrl + Alt + V</strong>: لصق خاص — قيم فقط، أو تنسيق فقط، أو نقل الصفوف إلى أعمدة.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'المعادلات' },
      {
        type: 'richText',
        html: '<ul><li><strong>F2</strong>: تحرير الخلية في مكانها ورؤية المراجع ملوّنة.</li><li><strong>F4</strong>: تثبيت المرجع — يتنقّل بين A1 و$A$1 وA$1 و$A1 بالضغط المتكرّر. هذا هو الاختصار الذي يمنع أخطاء النسخ.</li><li><strong>Alt + =</strong>: جمع تلقائي للمدى أعلى الخلية أو على يسارها.</li><li><strong>Ctrl + `</strong> (المفتاح أعلى Tab): إظهار المعادلات بدل نتائجها في الورقة كلها — أسرع طريقة لتفقّد جدول ورثته عن شخص آخر.</li><li><strong>F9</strong> على جزء محدّد من معادلة: حساب ذلك الجزء وحده لمعرفة أين الخطأ.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'التنسيق والجداول' },
      {
        type: 'richText',
        html: '<ul><li><strong>Ctrl + 1</strong>: نافذة تنسيق الخلايا — الاختصار الواحد الذي يغني عن نصف الشريط.</li><li><strong>Ctrl + Shift + 1</strong>: تنسيق رقمي بفاصلتين عشريتين. و<strong>Ctrl + Shift + 5</strong>: نسبة مئوية.</li><li><strong>Ctrl + T</strong>: تحويل المدى إلى جدول — فتُضاف الفلاتر وتتمدّد المعادلات تلقائياً مع الصفوف الجديدة.</li><li><strong>Ctrl + Shift + L</strong>: تشغيل الفلاتر وإيقافها.</li><li><strong>Alt + ↓</strong> على خلية مفلترة: فتح قائمة الفلتر بلوحة المفاتيح.</li></ul>',
      },
      { type: 'heading', level: 2, text: 'على الماك: ما يتغيّر' },
      {
        type: 'richText',
        html: '<p><strong>Cmd</strong> تحلّ محلّ <strong>Ctrl</strong> في الأساسيات، لكن Excel على الماك يخالف في مواضع تستحقّ المعرفة:</p><ul><li>تنسيق الخلايا: <strong>Cmd + 1</strong>.</li><li>تثبيت المرجع: <strong>Cmd + T</strong> بدل F4 في كثير من الإصدارات.</li><li>التعبئة لأسفل: <strong>Cmd + D</strong>.</li><li>إدراج تاريخ اليوم: <strong>Cmd + ;</strong>.</li><li>وللوصول إلى مفاتيح الدوالّ F1–F12 على لوحة ماك حديثة قد تحتاج الضغط مع <strong>fn</strong>.</li></ul>',
      },
    ],
  },
};
