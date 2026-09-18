/**
 * FAQs for the seven RDS client access licence products.
 *
 * These pages exist to stop three expensive mistakes, and every one of them is
 * made by somebody who believed they had already bought what they needed.
 *
 *   The licensing server runs for 120 days without CALs and then refuses every
 *   connection. There is no warning proportional to the disruption.
 *
 *   A CAL never licenses upward. A 2019 CAL will not cover a 2022 session
 *   host, so the CAL to buy is the one matching the newest host you run.
 *
 *   An RDS CAL is a third purchase, not a second. Server licence, Windows
 *   Server CAL, then RDS CAL — and the middle one is the one people miss.
 *
 * The 2008 and 2012 pages answer a fourth question rather than leaving it to be
 * discovered: those platforms stopped receiving security updates in January
 * 2020 and October 2023, and a remote desktop host is reachable from outside by
 * definition.
 */
import type { ProductFaq } from './windows-and-office.js';

const perDeviceOrUser: ProductFaq['ar'][number] = {
  q: 'أيهما أختار: Per Device أم Per User؟',
  a: 'Per Device يُرخّص الجهاز ومن يستخدمه كائناً من كان — الأنسب حين تُشارَك الأجهزة ولا يُشارَك الناس، كأرضية متجر أو مكتب إرسال يعمل بنوبات. وPer User يُرخّص الشخص عبر كل ما يتصل منه — الأنسب لموظّف له مكتب ولابتوب وجهاز في البيت. احسب العددين وخذ الأصغر.',
};
const perDeviceOrUserEn: ProductFaq['en'][number] = {
  q: 'Per Device or Per User — which do I need?',
  a: 'Per Device licenses the machine and everyone who uses it, which suits shared terminals worked in shifts — a shop floor, a dispatch desk. Per User licenses the person across every machine they connect from, which suits staff with a desk, a laptop and a home machine. Count both and take the smaller number.',
};

const gracePeriod: ProductFaq['ar'][number] = {
  q: 'هل أستطيع تشغيل سطح المكتب البعيد بلا رخص CAL؟',
  a: 'لمدّة 120 يوماً فقط. ويندوز سيرفر يسمح بجلستين إداريتين فقط بلا ترخيص إضافي؛ وأي استخدام أبعد يحتاج رخصة RDS لكل مستخدم أو جهاز. إن ثبّتّ دور ترخيص سطح المكتب البعيد بلا رخص فسيعمل 120 يوماً ثم يرفض الاتصالات — والمهلة لا تُستأنف.',
};
const gracePeriodEn: ProductFaq['en'][number] = {
  q: 'Can I run Remote Desktop without CALs?',
  a: 'For 120 days only. Windows Server permits two administrative sessions with no extra licence; anything beyond that needs an RDS CAL per user or device. Install the Remote Desktop Licensing role without CALs and it works for 120 days, then refuses connections — and the grace period cannot be restarted.',
};

const versionRule: ProductFaq['ar'][number] = {
  q: 'هل تُرخّص رخصة CAL إصداراً أحدث من الخادم؟',
  a: 'لا. رخص CAL تُرخّص إصدارها وكل ما هو أقدم منه، ولا شيء أحدث — رخصة 2019 تغطّي مضيف 2019 و2016 ولن تغطّي 2022. لذا اشترِ الرخصة على أحدث مضيف تشغّله، فهي تغطّي الأقدم مجاناً.',
};
const versionRuleEn: ProductFaq['en'][number] = {
  q: 'Does a CAL license a newer server version?',
  a: 'No. CALs license their own version and every version below it, and nothing above — a 2019 CAL covers a 2019 or 2016 session host and will not cover a 2022 one. So buy at the newest host version you run; it covers the older ones for free.',
};

export const FAQ_RDS_CALS: Record<string, ProductFaq> = {
  'windows-server-2025-rds-device-user': {
    ar: [
      gracePeriod,
      {
        q: 'كم رخصة أحتاج فعلاً — ثلاثة أنواع؟',
        a: 'نعم، ثلاثة معاً. رخصة **الخادم** لويندوز سيرفر نفسه، ورخصة **Windows Server CAL** لكل مستخدم أو جهاز يتّصل بالخادم أصلاً، ورخصة **RDS CAL** فوقها لكل من يتّصل كسطح مكتب. الوسطى هي التي يغفل عنها الناس.',
      },
      perDeviceOrUser,
    ],
    en: [
      gracePeriodEn,
      {
        q: 'How many licences do I actually need — three kinds?',
        a: 'Yes, three at once. The **server licence** for Windows Server itself, a **Windows Server CAL** for each user or device that touches the server at all, and an **RDS CAL** on top for each one connecting as a desktop. The middle one is what people miss.',
      },
      perDeviceOrUserEn,
    ],
  },

  'windows-server-2022-rds-device-user': {
    ar: [gracePeriod, versionRule, perDeviceOrUser],
    en: [gracePeriodEn, versionRuleEn, perDeviceOrUserEn],
  },

  'windows-server-2019-rds-device-user': {
    ar: [
      versionRule,
      {
        q: 'ما الإصدارات التي تغطّيها هذه الرخصة؟',
        a: 'مضيف 2019 وكل ما هو أقدم منه. لن تغطّي مضيف 2022 أو 2025 — إن كان أي مضيف لديك على أحدهما فاشترِ رخصة ذلك الإصدار، فهي تغطّي 2019 أيضاً.',
      },
      perDeviceOrUser,
    ],
    en: [
      versionRuleEn,
      {
        q: 'Which server versions does this licence cover?',
        a: 'A 2019 session host and every older one. It will not cover 2022 or 2025 — if any host of yours is on either, buy the CAL for that version instead, since it covers 2019 as well.',
      },
      perDeviceOrUserEn,
    ],
  },

  'windows-server-2016-rds-device-user': {
    ar: [
      versionRule,
      {
        q: 'هل أشتريه لنشر جديد؟',
        a: 'الأرجح لا. ينتهي دعم ويندوز سيرفر 2016 الممتدّ في 12 يناير 2027، ورخصة 2022 أو 2025 تغطّي مضيف 2016 أيضاً ولا تحتاج شراءً جديداً عند الترقية. اشترِ هذه حين يكون 2016 أحدث مضيف تشغّله وتنوي البقاء عليه.',
      },
      perDeviceOrUser,
    ],
    en: [
      versionRuleEn,
      {
        q: 'Should I buy this for a new deployment?',
        a: 'Probably not. Windows Server 2016 leaves extended support on 12 January 2027, and a 2022 or 2025 CAL covers a 2016 host as well without needing to be bought again at the upgrade. Buy this when 2016 is the newest host you run and intend to stay on.',
      },
      perDeviceOrUserEn,
    ],
  },

  'windows-server-2012-rds-device-user': {
    ar: [
      {
        q: 'ويندوز سيرفر 2012 خارج الدعم — هل ما زال شراء الرخصة منطقياً؟',
        a: 'توقّفت تحديثاته الأمنية في 10 أكتوبر 2023. الخادم يعمل والرخصة صالحة، لكن مضيف سطح مكتب بعيد **مكشوف من خارج الشبكة بحكم تعريفه** — فبقاؤه بلا ترقيع أصعب دفاعاً من خادم ملفات. اشترِ هذه حين يكون النشر ثابتاً: تطبيق لا يعمل على أحدث، أو جهاز على شبكة معزولة، أو نظام يُبقى حيّاً حتى تكتمل هجرة.',
      },
      versionRule,
      perDeviceOrUser,
    ],
    en: [
      {
        q: 'Windows Server 2012 is out of support — does buying a CAL still make sense?',
        a: 'Its security updates stopped on 10 October 2023. The server runs and the licence is valid, but a remote desktop host is by definition reachable from outside the network — so an unpatched one is harder to defend than an unpatched file server. Buy this where the deployment is fixed: an application that will not run on anything newer, a machine on an isolated network, or a system being kept alive until a migration completes.',
      },
      versionRuleEn,
      perDeviceOrUserEn,
    ],
  },

  'windows-server-2012-r2-rds-device': {
    ar: [
      {
        q: 'لماذا Per Device تحديداً؟',
        a: 'لأن الرخصة تتبع الجهاز لا الشخص. عشر طرفيات يستخدمها ثلاثون موظّفاً على ثلاث نوبات تحتاج عشر رخص Device، بينما Per User كانت ستحتاج ثلاثين. والعكس صحيح: شخص واحد يتّصل من مكتب ولابتوب وجهاز لوحي يستهلك ثلاث رخص Device وكان يكفيه رخصة User واحدة.',
      },
      {
        q: 'ما حال الدعم على 2012 R2؟',
        a: 'انتهى في 10 أكتوبر 2023، فلا تحديثات أمنية بعده. لمضيف سطح مكتب بعيد يمكن الوصول إليه من خارج الشبكة، هذا تعرّض حقيقي. إن كان النشر قابلاً للنقل فرخصة 2022 تغطّي هذا المضيف ومضيفاً حديثاً معاً.',
      },
    ],
    en: [
      {
        q: 'Why Per Device specifically?',
        a: 'Because the licence follows the machine rather than the person. Ten terminals used by thirty staff across three shifts need ten Device CALs where Per User would need thirty. The reverse is also true: one person connecting from a desktop, a laptop and a tablet consumes three Device CALs and would have needed one User CAL.',
      },
      {
        q: 'What is the support position on 2012 R2?',
        a: 'It ended on 10 October 2023, so there are no further security updates. For a remote desktop host reachable from outside the network, that is a real exposure. Where the deployment can move, a 2022 CAL covers both this host and a current one.',
      },
    ],
  },

  'windows-server-2008-rds-user': {
    ar: [
      {
        q: 'ويندوز سيرفر 2008 خارج الدعم منذ 2020 — لمن هذه الرخصة إذن؟',
        a: 'لمنشآت ما زال لديها خادم يعمل، غالباً لأن تطبيقاً واحداً لا يمكن نقله ولم تعد الشركة التي كتبته موجودة لتنقله. إن كان هذا وضعك فهذه الرخصة الصحيحة والسبب الصادق لشرائها. وإن لم يكن، فلا شيء في 2008 يوصي به.',
      },
      {
        q: 'ما معنى Per User هنا؟',
        a: 'رخصة واحدة تتبع الشخص عبر كل ما يتّصل منه — مكتب ولابتوب وجهاز في البيت. هي الجانب الصحيح من الاختيار حيثما كان عدد الموظّفين أكبر من عدد الطرفيات، والجانب الخاطئ حين تحمل أجهزة قليلة مشتركة أشخاصاً كثيرين.',
      },
    ],
    en: [
      {
        q: 'Windows Server 2008 has been out of support since 2020 — who is this for?',
        a: 'Estates that still have one running, usually because a single application will not move and its vendor no longer exists to port it. If that is the situation, this is the correct CAL and the honest reason to buy it. If it is not, nothing about 2008 recommends it.',
      },
      {
        q: 'What does Per User mean here?',
        a: 'One licence follows the person across every machine they connect from — a desktop, a laptop, a machine at home. It is the right side of the choice wherever staff outnumber the terminals they use, and the wrong one where a few shared machines carry many people.',
      },
    ],
  },
};
