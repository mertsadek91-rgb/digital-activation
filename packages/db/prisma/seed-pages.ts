/**
 * Editorial pages.
 *
 * The Golden Warranty text is the store's own, carried over from the legacy
 * site rather than rewritten: it is a commercial promise the owner has already
 * made to customers, and it is not mine to reword. Two corrections only, both
 * of which the source argues for itself —
 *
 *   - the second warranty type was headed "ضمان ما قبل التفعيل", the same as
 *     the first, while its own body says it covers keys that have already been
 *     activated successfully. It reads "ما بعد التفعيل" here.
 *   - the closing call to action appeared three times in a row, which is what
 *     a page builder leaves behind when a section is duplicated. Once.
 *
 * One claim from the original is deliberately absent: "نسبة نجاح تفعيل
 * المفاتيح 98%". A number that precise needs a source, and the store has just
 * finished deleting 565 fabricated reviews — putting an unverifiable
 * statistic back on a trust page would undo the point of that.
 *
 * Written as blocks rather than HTML, and the two warranty types are a table:
 * a table is what a skimming reader takes in and what an answer engine quotes.
 */
export const PAGES = [
  {
    slug: 'golden-warranty',
    ar: {
      title: 'الضمان الذهبي',
      seo: {
        title: 'الضمان الذهبي — استبدال مجاني للمفاتيح | متجر التفعيل الرقمي',
        description:
          'ضمان شامل على كل المفاتيح والتراخيص: استبدال مجاني قبل التفعيل خلال 7 أيام، وتغطية بعد التفعيل طوال مدّة الاشتراك.',
      },
      blocks: [
        {
          type: 'answerFirst',
          text: 'الضمان الذهبي ضمان مجاني على كل منتجات المتجر: إن لم يعمل المفتاح خلال 7 أيام من الشراء استبدلناه دون تكلفة، وبعد التفعيل تبقى التغطية سارية طوال مدّة اشتراك المنتج. الضمان مدرج تلقائياً مع رقم طلبك ولا يحتاج تسجيلاً.',
        },
        {
          type: 'richText',
          html: '<p>حرصاً منّا على تجربة شراء مطمئنة، نقدّم الضمان الذهبي على جميع المنتجات والخدمات في المتجر. صُمّم هذا الضمان ليناسب طبيعة المنتجات الرقمية، وينقسم إلى نوعين بحسب حالة المفتاح.</p>',
        },
        { type: 'heading', level: 2, text: 'نوعا الضمان', id: 'types' },
        {
          type: 'comparison',
          columns: ['ضمان ما قبل التفعيل', 'ضمان ما بعد التفعيل'],
          rows: [
            {
              label: 'يشمل',
              cells: [
                'المنتجات التي لم تُفعَّل مفاتيحها بعد',
                'المنتجات التي فُعِّلت مفاتيحها بنجاح',
              ],
            },
            { label: 'المدّة', cells: ['7 أيام من تاريخ الشراء', 'طوال مدّة اشتراك المنتج'] },
            {
              label: 'التغطية',
              cells: [
                'إن لم يعمل المفتاح خلال هذه المدّة، يُستبدَل دون أي تكلفة إضافية',
                'اشتراك سنة يعني ضماناً لسنة، ومنتج مدى الحياة يعني ضماناً مدى الحياة — وبحدّ أدنى سنة',
              ],
            },
          ],
        },
        {
          type: 'richText',
          html: '<p>للحصول على أفضل دعم ممكن، يُنصح بتفعيل المفتاح خلال الأيام السبعة الأولى.</p>',
        },
        { type: 'heading', level: 2, text: 'كيف تحصل على الضمان؟', id: 'how' },
        {
          type: 'steps',
          steps: [
            { text: 'الضمان مدرج تلقائياً مع فاتورتك الإلكترونية ورقم طلبك — لا تسجيل ولا رسوم.' },
            { text: 'فعّل المفتاح خلال 7 أيام من تاريخ الشراء.' },
            { text: 'إن واجهت مشكلة، راسِلنا برقم الطلب ونتولّى الباقي.' },
          ],
        },
        { type: 'heading', level: 2, text: 'ماذا يغطّي الضمان؟', id: 'covers' },
        {
          type: 'faq',
          items: [
            {
              q: 'المفتاح لا يُفعَّل، ماذا أفعل؟',
              a: 'راسِل الدعم برقم طلبك قبل أن تعيد المحاولة مراراً. يتولّى الفريق حل المشكلة إمّا باستبدال المفتاح أو بمتابعتها مع الشركة المنتجة.',
            },
            {
              q: 'كيف أتواصل مع الدعم؟',
              a: 'عبر رقم الطلب أو البريد الإلكتروني المسجّل في الطلب. ردّنا يصل على البريد نفسه الذي استلمت عليه المفتاح.',
            },
            {
              q: 'هل يشمل الضمان مشاكل جهازي؟',
              a: 'إن كانت المشكلة تقنية في جهازك وتمنع التفعيل، يمكن لفريق الدعم مساعدتك عبر التحكّم عن بُعد ببرنامج مثل AnyDesk، دون رسوم.',
            },
            { q: 'هل هناك استثناءات؟', a: 'نعم: الضمان الذهبي لا يشمل حسابات Office 365 A1 Plus.' },
          ],
        },
        {
          type: 'cta',
          heading: 'اطلب وأنت مطمئن',
          body: 'تجربة الشراء لديك محمية بالكامل بالضمان الذهبي من متجر التفعيل الرقمي.',
          buttonLabel: 'تسوّق الآن',
          buttonHref: '/store',
          tone: 'brand',
        },
      ],
    },
    en: {
      title: 'The Golden Warranty',
      seo: {
        title: 'The Golden Warranty — free key replacement | Digital Activation',
        description:
          'Every key and licence is covered: free replacement within 7 days if a key does not activate, and cover for the whole subscription term once it does.',
      },
      blocks: [
        {
          type: 'answerFirst',
          text: 'The Golden Warranty covers every product in the store at no cost: if a key does not work within 7 days of purchase we replace it free, and once it is activated the cover runs for the whole term of the product. It is attached to your order number automatically — there is nothing to register.',
        },
        {
          type: 'richText',
          html: '<p>The warranty is built around what digital products actually are, and it comes in two kinds depending on whether the key has been activated yet.</p>',
        },
        { type: 'heading', level: 2, text: 'The two kinds', id: 'types' },
        {
          type: 'comparison',
          columns: ['Before activation', 'After activation'],
          rows: [
            {
              label: 'Applies to',
              cells: ['Keys that have not been activated yet', 'Keys that activated successfully'],
            },
            { label: 'Period', cells: ['7 days from purchase', 'The whole term of the product'] },
            {
              label: 'Cover',
              cells: [
                'If the key does not work in that window it is replaced at no extra cost',
                'A one-year subscription is covered for a year; a lifetime product is covered for life — and never less than a year',
              ],
            },
          ],
        },
        {
          type: 'richText',
          html: '<p>Activating within the first seven days is what lets us help you fastest.</p>',
        },
        { type: 'heading', level: 2, text: 'How to claim it', id: 'how' },
        {
          type: 'steps',
          steps: [
            {
              text: 'The warranty is attached to your invoice and order number automatically — no registration, no fee.',
            },
            { text: 'Activate the key within 7 days of purchase.' },
            {
              text: 'If something goes wrong, write to us with your order number and we take it from there.',
            },
          ],
        },
        { type: 'heading', level: 2, text: 'What it covers', id: 'covers' },
        {
          type: 'faq',
          items: [
            {
              q: 'The key will not activate. What now?',
              a: 'Write to support with your order number rather than retrying the activation. The team either replaces the key or takes it up with the vendor.',
            },
            {
              q: 'How do I reach support?',
              a: 'By order number, or from the email address on the order. The reply goes to the same address the key was delivered to.',
            },
            {
              q: 'Does it cover problems with my own computer?',
              a: 'If a technical problem on your machine is blocking the activation, the team can help over a remote session with a tool like AnyDesk, at no charge.',
            },
            {
              q: 'Are there exceptions?',
              a: 'Yes: the Golden Warranty does not cover Office 365 A1 Plus accounts.',
            },
          ],
        },
        {
          type: 'cta',
          heading: 'Order with confidence',
          body: 'Your purchase is fully covered by the Golden Warranty from Digital Activation.',
          buttonLabel: 'Shop now',
          buttonHref: '/store',
          tone: 'brand',
        },
      ],
    },
  },
];
