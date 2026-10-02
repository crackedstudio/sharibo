import { useState, useEffect } from "react";
import { config } from "../config.js";
import { checkContractDeployed } from "../lib/testnetHealth.js";

const REACHABILITY_CHECK_INTERVAL_MS = 30_000;

// navigator.onLine only reports link status. Confirm the configured RPC is
// reachable too, so captive portals and failed RPCs appear as degraded.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    let active = true;
    const refreshReachability = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (active) setOnline(false);
        return;
      }

      try {
        const result = await checkContractDeployed(config.rpcUrl, config.contractId);
        if (active) {
          setOnline(
            (typeof navigator === "undefined" || navigator.onLine) && result.rpcReachable,
          );
        }
      } catch {
        if (active) setOnline(false);
      }
    };
    const goOnline = () => { void refreshReachability(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    void refreshReachability();
    const intervalId = window.setInterval(
      () => { void refreshReachability(); },
      REACHABILITY_CHECK_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(intervalId);
    };
  }, []);

  return online;
}
