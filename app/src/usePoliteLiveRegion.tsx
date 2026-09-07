import { useCallback, useEffect, useRef, useState } from "react";

export function usePoliteLiveRegion(debounceMs = 100) {
  const [message, setMessage] = useState("");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const announce = useCallback((nextMessage: string) => {
    if (!nextMessage) {
      setMessage("");
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setMessage(nextMessage);
    }, debounceMs);
  }, [debounceMs]);

  return { announce, message };
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}
