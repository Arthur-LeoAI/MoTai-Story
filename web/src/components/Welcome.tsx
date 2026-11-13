import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { errorText, request } from "../api";
import { UI_LOCALES } from "../i18n";
import { usePreferences } from "../preferences";
import { workPath } from "../sections";
import { settingsApi, type AiConfig } from "../settingsApi";

/** Opens a copy of the built-in sample story in the given language. */
export async function openSample(language: string) {
  const { work } = await request<{ work: { id: string } }>("/api/works/samples", { method: "POST", body: JSON.stringify({ language }) });
  return work.id;
}

/**
 * First visit (plan 5.2): choose the interface language, see whether AI is
 * ready, then open the sample story or start your own. Shown once.
 */
export default function Welcome({ onStartOwn }: { onStartOwn: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale, setLocale, markWelcomed } = usePreferences();
  const [ai, setAi] = useState<AiConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    settingsApi.config().then((result) => setAi(result.config)).catch(() => undefined);
  }, []);

  async function sample() {
    setBusy(true);
    setError("");
    try {
      const workId = await openSample(locale);
      markWelcomed();
      navigate(workPath(workId, "write"));
    } catch (cause) {
      setError(errorText(t, cause));
      setBusy(false);
    }
  }

  const aiState = !ai ? "unknown" : ai.statusProvider === "test" ? "test" : ai.configured ? "ready" : "missing";

  return (
    <section className="card welcome" aria-labelledby="welcome-title" data-testid="welcome">
      <h2 id="welcome-title" className="display welcome-title">{t("welcome.title")}</h2>
      <p className="muted">{t("welcome.intro")}</p>
      <ol className="welcome-steps">
        <li>
          <div className="caps">{t("welcome.language")}</div>
          <div className="draft-actions">
            {UI_LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                className={code === locale ? "btn on" : "btn"}
                aria-pressed={code === locale}
                onClick={() => setLocale(code)}
                data-testid={`welcome-locale-${code}`}
              >
                {t(`language.names.${code}`)}
              </button>
            ))}
          </div>
        </li>
        <li>
          <div className="caps">{t("welcome.ai")}</div>
          <p className="welcome-ai" data-testid="welcome-ai" data-state={aiState}>{t(`welcome.aiState.${aiState}`)}</p>
        </li>
        <li>
          <div className="caps">{t("welcome.begin")}</div>
          <div className="draft-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void sample()} data-testid="welcome-sample">{t("welcome.sample")}</button>
            <button type="button" className="btn" onClick={() => { markWelcomed(); onStartOwn(); }} data-testid="welcome-own">{t("welcome.own")}</button>
          </div>
        </li>
      </ol>
      {error ? <p className="notice" role="alert">{error}</p> : null}
      <button type="button" className="btn quiet welcome-skip" onClick={markWelcomed} data-testid="welcome-skip">{t("welcome.skip")}</button>
    </section>
  );
}
