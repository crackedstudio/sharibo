const es = {
  "lang.label": "Idioma",
  "lang.en": "Ingl\u00e9s",
  "lang.es": "Espa\u00f1ol",

  "banner.testnet": "Stellar testnet: sin fondos reales",
  "banner.limitations": "limitaciones honestas ↗",
  "banner.limitationsShort": "limitaciones ↗",

  "env.setupRequired": "Configuraci\u00f3n requerida",
  "env.setupIntro":
    "La app no puede iniciar porque faltan una o m\u00e1s variables de entorno o tienen un formato inv\u00e1lido.",
  "env.setupHowTo":
    "Copia app/.env.example a app/.env y completa los valores de abajo; luego reinicia el servidor de desarrollo.",
  "env.setupDetails":
    "Consulta app/.env.example para ver todas las variables requeridas y su formato esperado.",

  "step.create": "Crear",
  "step.fund": "Aportar",
  "step.proveClaim": "Probar y reclamar",
  "step.unlinked": "No vinculada ✓",

  "circle.stepperAria": "Progreso de la tanda",

  "landing.tagline":
    "Una tanda privada y rotativa en Stellar, con pruebas reales de conocimiento cero.",
  "landing.sub.before":
    "En cada ronda, todas las personas aportan. En cada ronda, una persona recibe el fondo. Sharibo demuestra",
  "landing.sub.em1": "qui\u00e9n tiene derecho a reclamar",
  "landing.sub.middle": "sin revelar jam\u00e1s",
  "landing.sub.em2": "qui\u00e9n",
  "landing.sub.after": "reclam\u00f3.",
  "landing.launch": "Lanzar una tanda de 5 miembros en testnet",
  "landing.previousCirclePrefix": "Tu tanda anterior sigue activa en",
  "landing.previousCircleLink": "tanda #{id} ↗",
  "landing.testnetFineprint":
    "Solo testnet. Las identidades de demostraci\u00f3n se generan de nuevo en tu navegador y nunca se reutilizan.",
  "landing.previousCircleLivesOn": "Tu tanda anterior #{id} sigue en la cadena —",
  "landing.viewExplorer": "ver en el explorador ↗",

  "circle.onChainLink": "tanda #{id} en cadena ↗",
  "common.startNewCircle": "Iniciar una nueva tanda",
  "browser.unsupportedTitle": "Se requiere compatibilidad del navegador",
  "browser.unsupportedIntro": "Sharibo genera la prueba en tu navegador, por lo que JavaScript es obligatorio.",
  "browser.unsupportedDetails": "Este navegador falta una o m\u00e1s funciones necesarias para el flujo de prueba de conocimiento cero.",
  "browser.unsupportedMissing": "Compatibilidad faltante:",
  "browser.unsupportedSecureContext": "Abre esta app en HTTPS o localhost. HTTP normal en una IP de LAN no es compatible.",
  "browser.unsupportedFooter": "Usa un navegador moderno que admita WebAssembly, BigInt y Web Crypto.",
  "browser.capability.webassembly": "WebAssembly",
  "browser.capability.bigint": "BigInt",
  "browser.capability.cryptoSubtle": "Web Crypto (crypto.subtle)",
  "browser.capability.secureContext": "Contexto seguro (HTTPS o localhost)",
  "cancel.title": "Cancelar Tanda",
  "cancel.confirmation": "¿Cancelar esta tanda?\n\nEsto reembolsará {count} contribuidor(es) un total de {total} XLM.\n\nEsta acción es irreversible. La tanda se cerrará permanentemente.",
  "cancel.busy": "Cancelando tanda y reembolsando contribuidores…",
  "cancel.cancelled": "Tanda Cancelada",
  "cancel.cancelledMessage": "Esta tanda ha sido cancelada y todos los contribuidores han sido reembolsados.",
  "cancel.refundInfo": "Los siguientes contribuidores serán reembolsados si la tanda es cancelada:",
  "cancel.willBeRefunded": "→ será reembolsado",
  "wallet.networkMismatch": "Desajuste de red: Tu billetera Freighter está en {walletNetwork} pero esta app espera {appNetwork}. Por favor abre Freighter, haz clic en el selector de red en la esquina superior derecha, y cambia a {appNetwork}.",
  "wallet.unknownNetwork": "Configuración de red desconocida. Por favor verifica tu configuración de Freighter.",
  "ring.label.revealed":
    "Tanda de {count} miembros: fondo reclamado. El destinatario del pago no es vinculable a ning\u00fan miembro.",
  "ring.label.loading":
    "Tanda de {count} miembros, {funded} de {count} aportaron, el fondo a\u00fan no se ha reclamado.",
  "ring.caption":
    "El pago lleg\u00f3 a la direcci\u00f3n de arriba: criptogr\u00e1ficamente, podr\u00eda estar ligado a cualquiera de los {count} miembros de la tanda. Un observador externo no puede saber a cu\u00e1l.",
  "ring.pot": "fondo",
  "ring.check": "\u2713",

  "pot.label": "fondo: {pot} / {total} XLM \u00b7 ronda {round}",

  "fund.heading": "Aportar",
  "fund.memberLabel": "miembro {index}",
  "fund.memberAddressLabel": "direcci\u00f3n del miembro {index}",
  "fund.fundedLink": "\u2713 aport\u00f3 ↗",
  "fund.demoButton": "Aportar {amount} XLM (Demo)",
  "fund.freighterButton": "Aportar con Freighter",
  "fund.busy": "Aportando desde el miembro {index}\u2026",
  "fund.busyFreighter": "Aportando desde el miembro {index} con Freighter\u2026",

  "claim.heading": "Reclamar",
  "claim.subtitle":
    "Elige qu\u00e9 miembro reclama esta ronda: la prueba le mostrar\u00e1 al contrato que es un miembro real sin revelar cu\u00e1l.",
  "claim.radioMember": "miembro {index}",
  "claim.generateButton": "Generar prueba y reclamar",
  "claim.stage.artifacts": "Descargando artefactos de prueba (wasm + zkey)\u2026",
  "claim.stage.proving": "Probando\u2026",
  "claim.stage.verifying": "Verificando la prueba localmente…",
  "claim.stage.funding": "Financiando un destinatario nuevo, no vinculado\u2026",
  "claim.stage.submitting": "Enviando la reclamaci\u00f3n\u2026",
  "claim.techline":
    "Groth16 \u00b7 BLS12-381 \u00b7 1,452 restricciones \u00b7 probando localmente en tu navegador; no se env\u00eda nada hasta que la prueba est\u00e9 lista",
  "claim.techlineProving": "· probando… {seconds}s",
  "claim.elapsed": "{seconds}s transcurridos",

  "explainer.summary": "C\u00f3mo funciona esta prueba de reclamaci\u00f3n",
  "explainer.sayingTitle": "Qu\u00e9 est\u00e1 diciendo la prueba",
  "explainer.sayingBody":
    "Prueba que la persona que reclama conoce una identidad secreta que est\u00e1 en la ra\u00edz Merkle de esta tanda, y vincula esa prueba a esta tanda y ronda exactas mediante la etiqueta de ronda (external_nullifier).",
  "explainer.secretTitle": "Qu\u00e9 permanece en secreto",
  "explainer.secretBody":
    "Qu\u00e9 miembro gener\u00f3 la prueba se mantiene privado. La transacci\u00f3n demuestra una membres\u00eda v\u00e1lida sin revelar cu\u00e1l de los 5 miembros reclam\u00f3.",
  "explainer.checksTitle": "Qu\u00e9 comprueba el contrato (en orden)",
  "explainer.check1": "La ronda est\u00e1 totalmente financiada: el fondo es igual a aportaci\u00f3n \u00d7 tama\u00f1o.",
  "explainer.check2": "La etiqueta de ronda coincide con esta tanda y ronda exactas.",
  "explainer.check3": "Este anulador nunca ha reclamado antes en esta tanda.",
  "explainer.check4": "La prueba Groth16 se verifica contra la ra\u00edz comprometida de la tanda.",
  "explainer.observersTitle": "Qu\u00e9 pueden ver los observadores",
  "explainer.observersBody":
    "Los observadores en cadena ven 5 dep\u00f3sitos de entrada y 1 pago de salida, pero ning\u00fan v\u00ednculo visible entre esa direcci\u00f3n de pago y un miembro espec\u00edfico.",

  "result.heading": "Pago recibido",
  "result.recipientIntro": "Destinatario nuevo",
  "result.recipientOutro":
    "recibi\u00f3 el fondo. Nunca apareci\u00f3 en otro lugar de esta tanda.",
  "result.recipientLabel": "direcci\u00f3n del destinatario",
  "result.viewClaimTx": "ver la transacci\u00f3n de reclamaci\u00f3n ↗",
  "result.hashLabel": "hash de la transacci\u00f3n de reclamaci\u00f3n",
  "result.callout":
    "Compara las 5 transacciones de aportaci\u00f3n de arriba con esta reclamaci\u00f3n: mismo contrato, sin direcci\u00f3n compartida, sin v\u00ednculo visible.",
  "result.claimAgainButton": "Intentar reclamar otra vez con la misma prueba",
  "result.claimAgainTitle": "El anulador ya fue reclamado (has_claimed)",
  "result.nullifierClaimed":
    "has_claimed es verdadero para este anulador: una repetici\u00f3n ser\u00e1 rechazada en cadena.",
  "result.rejectedLabel": "Rechazado en cadena:",
  "result.startNewCircle": "Iniciar una nueva tanda",
  "result.startNewCircleAlt": "\u21ba Iniciar una nueva tanda",
  "result.livesOnChain": "La tanda #{id} permanece para siempre en cadena —",
  "result.viewExplorer": "ver en el explorador ↗",
  "result.newCircleOutro":
    ". Iniciar una nueva tanda genera identidades nuevas y un registro totalmente nuevo en cadena.",

  "copy.aria": "Copiar {label}",
  "copy.title": "Copiar {label}",

  "busy.generating":
    "Generando un administrador nuevo y 5 identidades de miembro y financiando con friendbot\u2026",
  "busy.creating": "Creando la tanda en testnet\u2026",
  "busy.claiming": "Reclamando\u2026",
  "busy.refunding":
    "Refinanciando una nueva ronda y luego reproduciendo el anulador de la misma prueba\u2026",
  "busy.replaying": "Reproduciendo el anulador usado\u2026",

  "rejection.unexpected":
    "Inesperado: la reclamaci\u00f3n reproducida fue aceptada (esto nunca deber\u00eda ocurrir).",

  "error.generic": "Algo sali\u00f3 mal. Int\u00e9ntalo de nuevo.",
  "error.freighterNotTestnet":
    "Freighter no est\u00e1 en Testnet. Cambia la red en Freighter.",
  "error.getAddress": "No se pudo obtener la direcci\u00f3n de Freighter.",

  "reset.confirm":
    "Esta tanda est\u00e1 financiada pero a\u00fan no ha reclamado. \u00bfEmpezar de todos modos?\n\nTu tanda actual permanece en cadena; simplemente ya no la ver\u00e1s aqu\u00ed.",

  "liveRegion.help": "Ayuda: {message}",
  "liveRegion.error": "Error: {message}",
  "liveRegion.claimResultReady": "Actualizaci\u00f3n completada. El resultado de la reclamaci\u00f3n est\u00e1 listo.",
  "liveRegion.claimStepReady": "Actualizaci\u00f3n completada. El paso de reclamaci\u00f3n est\u00e1 listo.",

  "resume.heading": "\u00bfReanudar la tanda #{id}?",
  "resume.subtitle":
    "Parece que recargaste la p\u00e1gina mientras una tanda estaba activa. \u00bfQuieres reanudarla?",
  "resume.resumeButton": "Reanudar tanda",
  "resume.discardButton": "Descartar",


  "errorBoundary.heading": "Algo se rompió",
  "errorBoundary.body":
    "La demo encontró un error inesperado y no puede continuar de forma segura desde aquí.",
  "errorBoundary.reload": "Empezar de nuevo",
  "errorBoundary.fineprint": "Si esto sigue ocurriendo,",
  "errorBoundary.issueLink": "abre un issue en GitHub ↗",
} as const;

export default es;
