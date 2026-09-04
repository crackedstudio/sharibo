import type { FeeEstimate } from "@sharibo/client";
import type { Member } from "../types.js";

const STROOPS_PER_XLM = 10_000_000n;

/** Format a stroop amount as a human-readable XLM string, e.g. "0.0123456 XLM". */
function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole}.${frac.toString().padStart(7, "0")} XLM`;
}

export function ClaimSection({
  members,
  claimantIndex,
  onSelectClaimant,
  busy,
  onClaim,
  feeEstimate,
}: {
  members: Member[];
  claimantIndex: number;
  onSelectClaimant: (i: number) => void;
  busy: string | null;
  onClaim: () => void;
  feeEstimate?: FeeEstimate | null;
}) {
  return (
    <>
      <h2>Claim</h2>
      <p className="sub">
        Pick which member is claiming this round — the proof will show the contract that they're a
        real member <em>without</em> revealing which one.
      </p>
      <div className="row">
        {members.map((_, i) => (
          <label key={i} className="radio">
            <input
              type="radio"
              checked={claimantIndex === i}
              onChange={() => onSelectClaimant(i)}
              disabled={!!busy}
            />
            member {i + 1}
          </label>
        ))}
      </div>
      {feeEstimate && (
        <p className="techline fee-estimate">
          Estimated claim fee:{" "}
          <strong>{formatXlm(feeEstimate.totalFee)}</strong>
          {" "}·{" "}
          resource fee {formatXlm(feeEstimate.minResourceFee)}
          {" "}· the BLS12-381 pairing check makes this higher than a typical Soroban call
        </p>
      )}
      <button className="btn btn-primary" disabled={!!busy} onClick={onClaim}>
        {busy ?? "Generate proof & claim"}
      </button>
      {busy && (
        <p className="techline">
          Groth16 · BLS12-381 · 1,452 constraints · proving locally in your browser, nothing sent
          anywhere until the proof is done
        </p>
      )}
    </>
  );
}
