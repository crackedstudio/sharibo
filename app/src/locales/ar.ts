const ar = {
  "lang.label": "اللغة",
  "lang.en": "الإنجليزية",
  "lang.es": "الإسبانية",
  "lang.ar": "العربية",
  "lang.fr": "الفرنسية",
  "lang.hi": "الهندية",
  "lang.pt": "البرتغالية",
  "lang.tl": "التاغالوغية",
  "lang.yo": "اليوروبية",
  "lang.zh": "الصينية",

  "banner.testnet": "شبكة Stellar التجريبية — بدون أموال حقيقية",
  "banner.limitations": "قيود صريحة ↗",
  "banner.limitationsShort": "القيود ↗",

  "env.setupRequired": "الإعداد مطلوب",
  "env.setupIntro": "لا يمكن تشغيل التطبيق لأن متغير بيئة واحد أو أكثر مفقود أو غير صالح.",
  "env.setupHowTo":
    "انسخ app/.env.example إلى app/.env واملأ القيم أدناه، ثم أعد تشغيل خادم التطوير.",
  "env.setupDetails":
    "راجع app/.env.example للاطلاع على القائمة الكاملة للمتغيرات المطلوبة وصيغتها المتوقعة.",

  "step.create": "إنشاء",
  "step.fund": "تمويل",
  "step.proveClaim": "إثبات ومطالبة",
  "step.unlinked": "غير مرتبط ✓",

  "circle.stepperAria": "تقدم الدائرة",

  "landing.tagline": "جمعية ادخار دوّارة خاصة على Stellar، مع براهين معرفة صفرية حقيقية.",
  "landing.sub.before": "في كل جولة، يساهم الجميع. في كل جولة، يأخذ عضو واحد الوعاء. يثبت Sharibo",
  "landing.sub.em1": "من يحق له المطالبة",
  "landing.sub.middle": "دون أن يكشف أبدًا",
  "landing.sub.em2": "من",
  "landing.sub.after": "طالب.",
  "landing.launch": "أطلق دائرة من 5 أعضاء على الشبكة التجريبية",
  "landing.previousCirclePrefix": "دائرتك السابقة لا تزال موجودة على",
  "landing.previousCircleLink": "الدائرة #{id} ↗",
  "landing.testnetFineprint":
    "الشبكة التجريبية فقط. تُنشأ هويات العرض من جديد في متصفحك ولا تُعاد استخدامها أبدًا.",
  "landing.previousCircleLivesOn": "دائرتك السابقة #{id} موجودة على السلسلة —",
  "landing.viewExplorer": "عرض في المستكشف ↗",

  "circle.onChainLink": "الدائرة #{id} على السلسلة ↗",
  "common.startNewCircle": "ابدأ دائرة جديدة",
  "browser.unsupportedTitle": "يتطلب دعم المتصفح",
  "browser.unsupportedIntro": "يُنشئ Sharibo البرهان في متصفحك، لذا يلزم JavaScript.",
  "browser.unsupportedDetails":
    "يفتقر هذا المتصفح إلى ميزة واحدة أو أكثر لازمة لتدفق برهان المعرفة الصفرية.",
  "browser.unsupportedMissing": "دعم المتصفح المفقود:",
  "browser.unsupportedSecureContext":
    "افتح هذا التطبيق عبر HTTPS أو localhost. HTTP العادي على عنوان IP في الشبكة المحلية غير مدعوم.",
  "browser.unsupportedFooter": "استخدم متصفحًا حديثًا يدعم WebAssembly وBigInt وWeb Crypto.",
  "browser.capability.webassembly": "WebAssembly",
  "browser.capability.bigint": "BigInt",
  "browser.capability.cryptoSubtle": "Web Crypto (crypto.subtle)",
  "browser.capability.secureContext": "سياق آمن (HTTPS أو localhost)",
  "cancel.title": "إلغاء الدائرة",
  "cancel.confirmation":
    "إلغاء هذه الدائرة؟\n\nسيُسترد {count} مساهم(ين) بمبلغ إجمالي {total} XLM.\n\nهذا الإجراء لا رجعة فيه. ستُغلق الدائرة نهائيًا.",
  "cancel.busy": "جارٍ إلغاء الدائرة واسترداد المساهمين…",
  "cancel.cancelled": "أُلغيت الدائرة",
  "cancel.cancelledMessage": "أُلغيت هذه الدائرة واستُردت أموال جميع المساهمين.",
  "cancel.refundInfo": "سيُسترد المساهمون التاليون إذا أُلغيت الدائرة:",
  "cancel.willBeRefunded": "→ سيُسترد",
  "wallet.networkMismatch":
    "عدم تطابق الشبكة: محفظة Freighter لديك على {walletNetwork} لكن هذا التطبيق يتوقع {appNetwork}. افتح Freighter، وانقر على محدد الشبكة في أعلى اليمين، وبدّل إلى {appNetwork}.",
  "wallet.unknownNetwork": "تكوين شبكة غير معروف. يُرجى التحقق من إعدادات Freighter.",
  "ring.label.revealed":
    "دائرة من {count} أعضاء — تمت المطالبة بالوعاء. مستلم الدفع غير قابل للربط بأي عضو.",
  "ring.label.loading":
    "دائرة من {count} أعضاء، موّل {funded} من {count}، الوعاء لم يُطالب به بعد.",
  "ring.caption":
    "وصل الدفع إلى العنوان أعلاه — من الناحية التشفيرية، يمكن ربطه بأي من الأعضاء الـ {count} في الحلقة. لا يستطيع مراقب خارجي معرفة أيهم.",
  "ring.pot": "الوعاء",
  "ring.check": "✓",

  "pot.label": "الوعاء: {pot} / {total} XLM · الجولة {round}",
  "pot.fee": "رسوم {feePercent}% → {feeRecipient}",
  "pot.feeUnknown": "غير معروف",

  "fund.heading": "تمويل",
  "fund.memberLabel": "العضو {index}",
  "fund.memberAddressLabel": "عنوان العضو {index}",
  "fund.fundedLink": "✓ تم التمويل ↗",
  "fund.demoButton": "موّل {amount} XLM (عرض)",
  "fund.freighterButton": "موّل عبر Freighter",
  "fund.busy": "جارٍ التمويل من العضو {index}…",
  "fund.busyFreighter": "جارٍ التمويل من العضو {index} عبر Freighter…",

  "claim.heading": "مطالبة",
  "claim.subtitle":
    "اختر أي عضو يطالب في هذه الجولة — سيُظهر البرهان للعقد أنه عضو حقيقي دون كشف أيهم.",
  "claim.radioMember": "العضو {index}",
  "claim.generateButton": "أنشئ البرهان واطلب",
  "claim.stage.artifacts": "جارٍ جلب أدوات الإثبات (wasm + zkey)…",
  "claim.stage.proving": "جارٍ الإثبات…",
  "claim.stage.verifying": "جارٍ التحقق من البرهان محليًا…",
  "claim.stage.funding": "جارٍ تمويل مستلم جديد غير مرتبط…",
  "claim.stage.submitting": "جارٍ إرسال المطالبة…",
  "claim.techline":
    "Groth16 · BLS12-381 · 1,452 قيدًا · الإثبات محليًا في متصفحك، لا يُرسل شيء إلى أي مكان حتى يكتمل البرهان",
  "claim.techlineProving": "· جارٍ الإثبات… {seconds}ث",
  "claim.elapsed": "مضى {seconds}ث",

  "explainer.summary": "كيف يعمل برهان المطالبة هذا",
  "explainer.sayingTitle": "ماذا يقول البرهان",
  "explainer.sayingBody":
    "يثبت أن المطالب يعرف هوية سرية موجودة في جذر Merkle لهذه الدائرة، ويربط ذلك البرهان بهذه الدائرة والجولة تحديدًا عبر وسم الجولة (external_nullifier).",
  "explainer.secretTitle": "ما يبقى سريًا",
  "explainer.secretBody":
    "أي عضو أنشأ البرهان يبقى خاصًا. تثبت المعاملة عضوية صالحة دون كشف أي من الأعضاء الخمسة طالب.",
  "explainer.checksTitle": "ما يتحقق منه العقد (بالترتيب)",
  "explainer.check1": "الجولة ممولة بالكامل: الوعاء يساوي المساهمة × الحجم.",
  "explainer.check2": "وسم الجولة يطابق هذه الدائرة والجولة تحديدًا.",
  "explainer.check3": "لم يُطالب بهذا الـ nullifier من قبل في هذه الدائرة.",
  "explainer.check4": "يتحقق برهان Groth16 مقابل الجذر الملتزم للدائرة.",
  "explainer.observersTitle": "ما يراه المراقبون",
  "explainer.observersBody":
    "يرى المراقبون على السلسلة 5 إيداعات داخلة ودفعًا واحدًا خارجًا، لكن بلا رابط ظاهر من عنوان الدفع إلى عنوان عضو محدد.",

  "result.heading": "وصل الدفع",
  "result.recipientIntro": "مستلم جديد",
  "result.recipientOutro": "استلم الوعاء. لم يظهر في أي مكان آخر في هذه الدائرة.",
  "result.recipientLabel": "عنوان المستلم",
  "result.viewClaimTx": "عرض معاملة المطالبة ↗",
  "result.hashLabel": "تجزئة معاملة المطالبة",
  "result.callout":
    "قارن معاملات التمويل الخمس أعلاه بهذه المطالبة — نفس العقد، بلا عنوان مشترك، بلا رابط ظاهر.",
  "result.claimAgainButton": "حاول المطالبة مجددًا بنفس البرهان",
  "result.claimAgainTitle": "الـ nullifier سبق أن طولب به (has_claimed)",
  "result.nullifierClaimed":
    "has_claimed صحيح لهذا الـ nullifier — ستُرفض إعادة التشغيل على السلسلة.",
  "result.rejectedLabel": "مرفوض على السلسلة:",
  "result.startNewCircle": "ابدأ دائرة جديدة",
  "result.startNewCircleAlt": "↺ ابدأ دائرة جديدة",
  "result.livesOnChain": "الدائرة #{id} تبقى على السلسلة إلى الأبد —",
  "result.viewExplorer": "عرض في المستكشف ↗",
  "result.newCircleOutro": ". بدء دائرة جديدة يُنشئ هويات جديدة وسجلًا جديدًا تمامًا على السلسلة.",

  "copy.aria": "نسخ {label}",
  "copy.title": "نسخ {label}",

  "busy.generating": "جارٍ إنشاء مسؤول جديد + 5 هويات أعضاء والتمويل عبر friendbot…",
  "busy.creating": "جارٍ إنشاء الدائرة على الشبكة التجريبية…",
  "busy.claiming": "جارٍ المطالبة…",
  "busy.refunding": "جارٍ استرداد جولة جديدة، ثم إعادة تشغيل نفس nullifier البرهان…",
  "busy.replaying": "جارٍ إعادة تشغيل الـ nullifier المستخدم…",

  "rejection.unexpected": "غير متوقع: قُبلت المطالبة المعاد تشغيلها (هذا لا ينبغي أن يحدث أبدًا).",

  "error.generic": "حدث خطأ ما. يُرجى إعادة المحاولة.",
  "error.freighterNotTestnet":
    "Freighter غير مضبوط على الشبكة التجريبية. يُرجى تبديل شبكتك في Freighter.",
  "error.getAddress": "تعذر الحصول على العنوان من Freighter.",

  "reset.confirm":
    "هذه الدائرة ممولة لكن لم تُطالب بعد. البدء من جديد على أي حال؟\n\nدائرتك الحالية تبقى على السلسلة — لن تراها هنا فقط.",

  "liveRegion.help": "مساعدة: {message}",
  "liveRegion.error": "خطأ: {message}",
  "liveRegion.claimResultReady": "اكتمل تحديث السعر. نتيجة المطالبة جاهزة.",
  "liveRegion.claimStepReady": "اكتمل تحديث السعر. خطوة المطالبة جاهزة.",

  "resume.heading": "استئناف الدائرة #{id}؟",
  "resume.subtitle": "يبدو أنك حدّثت الصفحة أثناء نشاط دائرة. هل تريد الاستئناف؟",
  "resume.resumeButton": "استئناف الدائرة",
  "resume.discardButton": "تجاهل",

  "errorBoundary.heading": "حدث خلل ما",
  "errorBoundary.body": "واجه العرض خطأ غير متوقع ولا يمكنه المتابعة بأمان من هنا.",
  "errorBoundary.reload": "البدء من جديد",
  "errorBoundary.fineprint": "إذا استمر هذا،",
  "errorBoundary.issueLink": "افتح مشكلة على GitHub ↗",
} as const;

export default ar;
