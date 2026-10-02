/** Redaction-safe SDK event snapshot for debug bundles and UI logs. */
export interface LoggedSdkEvent {
  type: string;
  at: string;
  detail?: Record<string, string | number | boolean | null>;
}
