import { useEffect } from "react";
import { LanguageSwitcher, useI18n } from "./i18n.js";
import { config, configError } from "./config.js";
import { useCircleFlow } from "./hooks/useCircleFlow.js";
import { usePoliteLiveRegion, LiveRegion } from "./usePoliteLiveRegion.js";
import { explorerContract } from "./lib/explorer.js";
import { Landing } from "./components/Landing.js";
import { Stepper } from "./components/Stepper.js";
import { MemberRing } from "./components/MemberRing.js";
import { FundingList } from "./components/FundingList.js";
import { ClaimSection } from "./components/ClaimSection.js";
import { ResultCard } from "./components/ResultCard.js";

const CIRCLE_SIZE = 5;

function NetworkBanner() {
  const isTestnet = config.networkPassphrase.toLowerCase().includes("test");
  if (!isTestnet) return null;
  return (
    <div className="network-banner">
      Stellar testnet — no real funds ·{" "}
      <a
        href="https://github.com/crackedstudio/sharibo#honest-limitations"
        target="_blank"
        rel="noreferrer"
      >
        limitations ↗
      </a>
    </div>
  );
}

// Rendered when the VITE_* environment variables are missing or malformed.
// config.ts validates everything at module load and dumps every problem here.
function EnvSetupScreen({ errors }: { errors: string[] }) {
  const { t } = useI18n();

  return (
    <div className="page">
      <div className="card hero">
        <LanguageSwitcher className="language-switcher-hero" />
        <h1>SHARIBO</h1>
        <h2 style={{ color: "var(--color-error, #e55)" }}>{t("env.setupRequired")}</h2>
        <p className="sub">
          {t("env.setupIntro")} {t("env.setupHowTo")}
        </p>
        <ul style={{ textAlign: "left", margin: "1rem 0", padding: "0 1.25rem" }}>
          {errors.map((err) => (
            <li key={err} style={{ marginBottom: "0.5rem" }}>
              <code>{err}</code>
            </li>
          ))}
        </ul>
        <p className="fineprint">{t("env.setupDetails")}</p>
      </div>
    </div>
  );
}

export default function App() {
  const flow = useCircleFlow();
  const { t } = useI18n();
  const { announce, message } = usePoliteLiveRegion(120);

  useEffect(() => {
    if (flow.busy) {
      announce(`Help: ${flow.busy}`);
      return;
    }
    if (flow.claimResult) {
      announce("Price update complete. The claim result is ready.");
      return;
    }
    if (flow.error) {
      announce(`Error: ${flow.error}`);
      return;
    }
    if (flow.fullyFunded) {
      announce("Price update complete. The claim step is ready.");
    }
  }, [announce, flow.busy, flow.claimResult, flow.error, flow.fullyFunded]);

  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

  if (flow.screen === "landing") {
    return (
      <div className="page">
        <NetworkBanner />
        <Landing
          busy={flow.busy}
          error={flow.error}
          previousCircleId={flow.previousCircleId}
          onLaunch={flow.startCircle}
        />
        <LiveRegion message={message} />
      </div>
    );
  }

  const step: 0 | 1 | 2 | 3 = flow.claimResult ? 3 : flow.fullyFunded ? 2 : 1;

  return (
    <div className="page">
      <NetworkBanner />
      <div className="card">
        <div className="row space-between">
          <h1 className="small">SHARIBO</h1>
          <div className="row">
            <LanguageSwitcher />
            <a className="link" href={explorerContract()} target="_blank" rel="noreferrer">
              {t("circle.onChainLink", { id: flow.circleId?.toString() ?? "?" })}
            </a>
            <button
              className="btn btn-small"
              disabled={!!flow.busy}
              onClick={flow.resetToLanding}
              title={`Start over. Your current circle (#${flow.circleId?.toString()}) keeps living on-chain.`}
            >
              {t("common.startNewCircle")}
            </button>
          </div>
        </div>

        <Stepper step={step} />
        <MemberRing members={flow.members} revealed={!!flow.claimResult} />

        <div className="pot-bar-wrap">
          <div
            className="pot-bar"
            style={{ width: `${(flow.fundedCount / CIRCLE_SIZE) * 100}%` }}
          />
        </div>
        <p className="pot-label">
          pot: {(Number(flow.pot) / 1e7).toFixed(1)} / {flow.contributionXlm * CIRCLE_SIZE} XLM ·
          round {flow.round}
        </p>

        <FundingList
          members={flow.members}
          busy={flow.busy}
          round={flow.round}
          contributionXlm={flow.contributionXlm}
          onFund={flow.fundMember}
        />

        {flow.fullyFunded && !flow.claimResult && (
          <ClaimSection
            members={flow.members}
            claimantIndex={flow.claimantIndex}
            onSelectClaimant={flow.setClaimantIndex}
            busy={flow.busy}
            onClaim={flow.doClaim}
          />
        )}

        {flow.claimResult && (
          <ResultCard
            claimResult={flow.claimResult}
            rejection={flow.rejection}
            busy={flow.busy}
            onClaimAgain={flow.claimAgain}
            onReset={flow.resetToLanding}
          />
        )}

        {flow.error && <p className="error">{flow.error}</p>}
        <LiveRegion message={message} />
      </div>
    </div>
  );
}