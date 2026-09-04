import { Component, type ErrorInfo, type ReactNode } from "react";
import { I18nContext } from "./i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render-time exceptions so a bug doesn't white-screen the demo for
// an audience that includes non-developers clicking through a ZK flow.
// Note: error boundaries only catch render-phase errors — they do NOT catch
// errors in async code or event handlers (those already flow through this
// app's own setError state in App.tsx).
//
// Uses I18nContext.Consumer rather than useI18n because error boundaries must
// be class components (React requirement), and hooks cannot be called in
// class component render methods.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const errorMessage = this.state.error.message;
      return (
        <I18nContext.Consumer>
          {(ctx) => {
            const t = ctx?.t ?? ((key: string) => key);
            return (
              <div className="page">
                <div className="card hero">
                  {/* "SHARIBO" is the product name — intentionally not translated */}
                  <h1 className="small">SHARIBO</h1>
                  <h2 className="small" style={{ color: "var(--color-error, #e55)" }}>
                    {t("errorBoundary.heading")}
                  </h2>
                  <p className="sub">{t("errorBoundary.body")}</p>
                  <p className="error">{errorMessage}</p>
                  <button
                    className="btn btn-primary"
                    onClick={() => window.location.reload()}
                  >
                    {t("errorBoundary.reload")}
                  </button>
                  <p className="fineprint">
                    {t("errorBoundary.fineprint")}{" "}
                    <a
                      className="link"
                      href="https://github.com/crackedstudio/sharibo/issues/new"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("errorBoundary.issueLink")}
                    </a>
                    .
                  </p>
                </div>
              </div>
            );
          }}
        </I18nContext.Consumer>
      );
    }
    return this.props.children;
  }
}
