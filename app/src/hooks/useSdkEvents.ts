import { useCallback, useEffect, useRef, useState } from "react";
import type { OnEventFn, SdkEvent } from "@sharibo/client";
import { setArtifactOnEvent } from "@sharibo/client";
import type { LoggedSdkEvent } from "../lib/sdkEventLog";
import type { ClaimStage } from "../types.js";

/** Max retained SDK events — unbounded growth from retries is a leak. */
export const SDK_EVENT_BUFFER_LIMIT = 100;

export type { LoggedSdkEvent };

function stageFromEvent(event: SdkEvent): ClaimStage | null {
  switch (event.type) {
    case "artifact:started":
    case "artifact:progress":
      return "artifacts";
    case "proof:started":
      return "proving";
    case "proof:finished":
      return "verifying";
    case "tx:submitted":
    case "tx:confirmed":
      return "submitting";
    default:
      return null;
  }
}

function toLogged(event: SdkEvent): LoggedSdkEvent {
  const at = new Date().toISOString();
  switch (event.type) {
    case "rpc:retry":
      return {
        type: event.type,
        at,
        detail: {
          attempt: event.attempt,
          delay: Math.round(event.delay),
          error: event.error instanceof Error ? event.error.message : String(event.error),
        },
      };
    case "rpc:success":
      return { type: event.type, at, detail: { duration: event.duration } };
    case "rpc:failure":
      return {
        type: event.type,
        at,
        detail: {
          attempt: event.attempt,
          error: event.error instanceof Error ? event.error.message : String(event.error),
        },
      };
    case "tx:submitted":
    case "tx:confirmed":
      return { type: event.type, at, detail: { hash: event.hash } };
    case "artifact:progress":
      return {
        type: event.type,
        at,
        detail: {
          loaded: event.loaded,
          total: event.total,
          fraction: event.fraction,
        },
      };
    case "artifact:ready":
      return {
        type: event.type,
        at,
        detail: { loaded: event.loaded, total: event.total },
      };
    case "artifact:error":
      return { type: event.type, at, detail: { message: event.message } };
    default:
      return { type: event.type, at };
  }
}

/**
 * Single stable SDK event handler for the demo app.
 *
 * Owns a bounded event log, bridges artifact prefetch into the same stream,
 * and derives ClaimProgress stage from proof / artifact / tx events.
 */
export function useSdkEvents() {
  const [events, setEvents] = useState<LoggedSdkEvent[]>([]);
  const [claimStage, setClaimStage] = useState<ClaimStage | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const push = useCallback((event: SdkEvent) => {
    const logged = toLogged(event);
    setEvents((prev) => {
      const next = [...prev, logged];
      return next.length > SDK_EVENT_BUFFER_LIMIT
        ? next.slice(next.length - SDK_EVENT_BUFFER_LIMIT)
        : next;
    });
    const stage = stageFromEvent(event);
    if (stage) setClaimStage(stage);
  }, []);

  const onEvent: OnEventFn = useCallback(
    (event) => {
      push(event);
    },
    [push],
  );

  useEffect(() => {
    setArtifactOnEvent(onEvent);
    return () => setArtifactOnEvent(undefined);
  }, [onEvent]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const resetClaimStage = useCallback(() => {
    setClaimStage(null);
  }, []);

  /** Snapshot for the debug bundle (already stringified detail fields). */
  const recentEvents = useCallback((): LoggedSdkEvent[] => {
    return eventsRef.current.slice();
  }, []);

  return {
    events,
    onEvent,
    claimStage,
    setClaimStage,
    clearEvents,
    resetClaimStage,
    recentEvents,
  };
}
