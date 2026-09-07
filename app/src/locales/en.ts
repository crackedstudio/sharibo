const en = {
  "lang.label": "Language",
  "lang.en": "English",
  "lang.es": "Spanish",

  "banner.testnet": "Stellar testnet — no real funds",
  "banner.limitations": "honest limitations ↗",
  "banner.limitationsShort": "limitations ↗",

  "env.setupRequired": "Setup required",
  "env.setupIntro":
    "The app cannot start because one or more environment variables are missing or invalid.",
  "env.setupHowTo":
    "Copy app/.env.example to app/.env and fill in the values below, then restart the dev server.",
  "env.setupDetails":
    "See app/.env.example for the full list of required variables and their expected format.",

  "step.create": "Create",
  "step.fund": "Fund",
  "step.proveClaim": "Prove & Claim",
  "step.unlinked": "Unlinked ✓",

  "circle.stepperAria": "Circle progress",

  "landing.tagline":
    "A private rotating savings circle on Stellar, with real zero-knowledge proofs.",
  "landing.sub.before":
    "Every round, everyone contributes. Every round, one member takes the pot. Sharibo proves",
  "landing.sub.em1": "who's entitled to claim",
  "landing.sub.middle": "without ever revealing",
  "landing.sub.em2": "who",
  "landing.sub.after": "claimed.",
  "landing.launch": "Launch a 5-member circle on testnet",
  "landing.previousCirclePrefix": "Your previous circle lives on at",
  "landing.previousCircleLink": "circle #{id} ↗",
  "landing.testnetFineprint":
    "Testnet only. Demo identities are generated fresh in your browser, never reused.",
  "landing.previousCircleLivesOn": "Your previous circle #{id} lives on-chain —",
  "landing.viewExplorer": "view on explorer ↗",

  "circle.onChainLink": "circle #{id} on-chain ↗",
  "common.startNewCircle": "Start a new circle",
  "browser.unsupportedTitle": "Browser support required",
  "browser.unsupportedIntro": "Sharibo generates the proof in your browser, so JavaScript is required.",
  "browser.unsupportedDetails": "This browser is missing one or more features needed for the zero-knowledge proof flow.",
  "browser.unsupportedMissing": "Missing browser support:",
  "browser.unsupportedSecureContext": "Open this app over HTTPS or localhost. Plain HTTP on a LAN IP is not supported.",
  "browser.unsupportedFooter": "Use a modern browser that supports WebAssembly, BigInt, and Web Crypto.",
  "browser.capability.webassembly": "WebAssembly",
  "browser.capability.bigint": "BigInt",
  "browser.capability.cryptoSubtle": "Web Crypto (crypto.subtle)",
  "browser.capability.secureContext": "Secure context (HTTPS or localhost)",
  "cancel.title": "Cancel Circle",
  "cancel.confirmation": "Cancel this circle?\n\nThis will refund {count} contributor(s) a total of {total} XLM.\n\nThis action is irreversible. The circle will be permanently closed.",
  "cancel.busy": "Cancelling circle and refunding contributors…",
  "cancel.cancelled": "Circle Cancelled",
  "cancel.cancelledMessage": "This circle has been cancelled and all contributors have been refunded.",
  "cancel.refundInfo": "The following contributors will be refunded if the circle is cancelled:",
  "cancel.willBeRefunded": "→ will be refunded",
  "wallet.networkMismatch": "Network mismatch: Your Freighter wallet is on {walletNetwork} but this app expects {appNetwork}. Please open Freighter, click the network selector in the upper right, and switch to {appNetwork}.",
  "wallet.unknownNetwork": "Unknown network configuration. Please verify your Freighter settings.",
  "ring.label.revealed":
    "{count}-member circle — pot claimed. Payout recipient is unlinkable to any member.",
  "ring.label.loading":
    "{count}-member circle, {funded} of {count} funded, pot not yet claimed.",
  "ring.caption":
    "Payout landed on the address above — cryptographically, it could be tied to any of the {count} members in the ring. An outside observer cannot tell which.",
  "ring.pot": "pot",
  "ring.check": "✓",

  "pot.label": "pot: {pot} / {total} XLM · round {round}",
  "pot.fee": "fee {feePercent}% → {feeRecipient}",
  "pot.feeUnknown": "unknown",

  "fund.heading": "Fund",
  "fund.memberLabel": "member {index}",
  "fund.memberAddressLabel": "member {index} address",
  "fund.fundedLink": "✓ funded ↗",
  "fund.demoButton": "Fund {amount} XLM (Demo)",
  "fund.freighterButton": "Fund with Freighter",
  "fund.busy": "Funding from member {index}…",
  "fund.busyFreighter": "Funding from member {index} via Freighter…",

  "claim.heading": "Claim",
  "claim.subtitle":
    "Pick which member is claiming this round — the proof will show the contract that they're a real member without revealing which one.",
  "claim.radioMember": "member {index}",
  "claim.generateButton": "Generate proof & claim",
  "claim.stage.artifacts": "Fetching proving artifacts (wasm + zkey)…",
  "claim.stage.proving": "Proving…",
  "claim.stage.verifying": "Verifying proof locally…",
  "claim.stage.funding": "Funding a fresh, unlinked recipient…",
  "claim.stage.submitting": "Submitting the claim…",
  "claim.techline":
    "Groth16 · BLS12-381 · 1,452 constraints · proving locally in your browser, nothing sent anywhere until the proof is done",
  "claim.techlineProving": "· proving… {seconds}s",
  "claim.elapsed": "{seconds}s elapsed",

  "explainer.summary": "How this claim proof works",
  "explainer.sayingTitle": "What the proof is saying",
  "explainer.sayingBody":
    "It proves the claimant knows a secret identity that is in this circle's Merkle root, and binds that proof to this exact circle and round via the round tag (external_nullifier).",
  "explainer.secretTitle": "What stays secret",
  "explainer.secretBody":
    "Which member generated the proof stays private. The transaction proves valid membership without revealing which one of the 5 members claimed.",
  "explainer.checksTitle": "What the contract checks (in order)",
  "explainer.check1": "The round is fully funded: pot equals contribution × size.",
  "explainer.check2": "The round tag matches this exact circle and round.",
  "explainer.check3": "This nullifier has never claimed before in this circle.",
  "explainer.check4": "The Groth16 proof verifies against the circle's committed root.",
  "explainer.observersTitle": "What observers can see",
  "explainer.observersBody":
    "On-chain observers see 5 deposits in and 1 payout out, but no visible link from that payout address to a specific member address.",

  "result.heading": "Payout landed",
  "result.recipientIntro": "Fresh recipient",
  "result.recipientOutro":
    "received the pot. It has never appeared anywhere else on this circle.",
  "result.recipientLabel": "recipient address",
  "result.viewClaimTx": "view claim transaction ↗",
  "result.hashLabel": "claim transaction hash",
  "result.callout":
    "Compare the 5 funding transactions above to this claim — same contract, no shared address, no visible link.",
  "result.claimAgainButton": "Try to claim again with the same proof",
  "result.claimAgainTitle": "Nullifier already claimed (has_claimed)",
  "result.nullifierClaimed":
    "has_claimed is true for this nullifier — a replay will be rejected on-chain.",
  "result.rejectedLabel": "Rejected on-chain:",
  "result.startNewCircle": "Start a new circle",
  "result.startNewCircleAlt": "↺ Start a new circle",
  "result.livesOnChain": "Circle #{id} stays on-chain forever —",
  "result.viewExplorer": "view on explorer ↗",
  "result.newCircleOutro":
    ". Starting a new circle generates fresh identities and a brand-new on-chain record.",

  "copy.aria": "Copy {label}",
  "copy.title": "Copy {label}",

  "busy.generating":
    "Generating a fresh admin + 5 member identities and funding via friendbot…",
  "busy.creating": "Creating the circle on testnet…",
  "busy.claiming": "Claiming…",
  "busy.refunding": "Refunding a new round, then replaying the same proof's nullifier…",
  "busy.replaying": "Replaying the used nullifier…",

  "rejection.unexpected":
    "Unexpected: the replayed claim was accepted (this should never happen).",

  "error.generic": "Something went wrong. Please retry.",
  "error.freighterNotTestnet":
    "Freighter is not set to Testnet. Please switch your network in Freighter.",
  "error.getAddress": "Could not get address from Freighter.",

  "reset.confirm":
    "This circle is funded but hasn't claimed yet. Start over anyway?\n\nYour current circle stays on-chain — you just won't see it here.",

  "liveRegion.help": "Help: {message}",
  "liveRegion.error": "Error: {message}",
  "liveRegion.claimResultReady": "Price update complete. The claim result is ready.",
  "liveRegion.claimStepReady": "Price update complete. The claim step is ready.",

  "resume.heading": "Resume Circle #{id}?",
  "resume.subtitle":
    "It looks like you refreshed the page while a circle was active. Do you want to resume?",
  "resume.resumeButton": "Resume Circle",
  "resume.discardButton": "Discard",


  "errorBoundary.heading": "Something broke",
  "errorBoundary.body":
    "The demo hit an unexpected error and can't continue safely from here.",
  "errorBoundary.reload": "Start over",
  "errorBoundary.fineprint": "If this keeps happening,",
  "errorBoundary.issueLink": "file a GitHub issue ↗",
} as const;

export default en;
