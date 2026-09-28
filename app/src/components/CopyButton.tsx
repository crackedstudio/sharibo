import { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";

// Every truncated value on screen (addresses, tx hashes) needs to be
// pasteable in full somewhere else — a CLI call, an explorer search — so
// this pairs with each `short(...)` display. Falls back to a prompt() (which
// itself is trivially copyable) when the async Clipboard API isn't
// available, e.g. non-secure contexts.
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const tmr = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(tmr);
  }, [copied]);

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      window.prompt(`Clipboard unavailable — copy ${label} manually:`, value);
    }
  }

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={t("copy.aria", { label })}
      title={t("copy.title", { label })}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}
