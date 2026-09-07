// Small connection indicator driven by useOnlineStatus. Renders a colored dot
// plus a label so the user always knows whether network actions are live.
export function ConnectionStatus({ online }: { online: boolean }) {
  return (
    <span
      className={`connection-status ${online ? "is-online" : "is-offline"}`}
      role="status"
      aria-live="polite"
      title={online ? "Network is online" : "You are offline — network actions are paused"}
    >
      <span className="connection-dot" aria-hidden="true" />
      {online ? "Online" : "Offline"}
    </span>
  );
}
