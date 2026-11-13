import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError, errorText } from "../api";
import { Notice, PreferenceControls, Wordmark, useDocumentTitle } from "../components/common";
import { formatCount, formatRelativeTime } from "../format";
import { usePreferences } from "../preferences";
import { settingsApi, type AiConfig, type BackupStatus, type ModelChoice, type TaskSummary, type Usage } from "../settingsApi";

const choiceValue = (provider: string, id: string) => `${provider}::${id}`;

function AiSection() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [status, setStatus] = useState<{ state: "idle" | "checking" | "ok" | "failed"; text: string }>({ state: "idle", text: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([settingsApi.config(), settingsApi.models()])
      .then(([configResult, modelResult]) => {
        if (!active) return;
        setConfig(configResult.config);
        setModels(modelResult.models);
      })
      .catch((cause) => active && setError(errorText(t, cause)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(provider?: string) {
    setStatus({ state: "checking", text: t("settings.ai.checking") });
    try {
      const result = await settingsApi.test(provider);
      setStatus(result.ok
        ? { state: "ok", text: t("settings.ai.connected", { model: result.model }) }
        : { state: "failed", text: errorText(t, new ApiError(0, result.code ?? "AI_UNAVAILABLE", result.message ?? "", result.params ?? {})) });
    } catch (cause) {
      setStatus({ state: "failed", text: errorText(t, cause) });
    }
  }

  async function choose(event: ChangeEvent<HTMLSelectElement>) {
    const [provider, model] = event.target.value.split("::");
    setBusy(true);
    setError("");
    try {
      const result = await settingsApi.chooseModel(provider, model);
      setConfig(result.config);
      await check(provider);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const testMode = config?.statusProvider === "test";
  return (
    <section className="card settings-section" aria-labelledby="settings-ai" data-testid="settings-ai">
      <h2 id="settings-ai" className="caps">{t("settings.ai.heading")}</h2>
      <p className="muted assist-hint">{t("settings.ai.intro")}</p>
      {testMode ? <p className="notice" data-testid="settings-test-ai">{t("settings.ai.testMode")}</p> : null}
      {config ? (
        <>
          <label className="caps" htmlFor="ai-model">{t("settings.ai.model")}</label>
          <select
            id="ai-model"
            className="field"
            value={choiceValue(config.provider, config.model)}
            disabled={busy || models.length === 0}
            onChange={(event) => void choose(event)}
            data-testid="settings-model"
          >
            {models.some((item) => item.provider === config.provider && item.id === config.model) ? null : (
              <option value={choiceValue(config.provider, config.model)}>{config.providerLabel} · {config.model}</option>
            )}
            {models.map((item) => (
              <option key={choiceValue(item.provider, item.id)} value={choiceValue(item.provider, item.id)}>{item.providerLabel} · {item.id}</option>
            ))}
          </select>
          {models.length === 0 ? <p className="muted assist-hint">{t("settings.ai.noModels")}</p> : null}
          <ul className="provider-list" data-testid="settings-providers">
            {config.providerStatuses.map((item) => (
              <li key={item.provider} className="provider" data-testid="settings-provider" data-provider={item.provider} data-configured={item.hasApiKey}>
                <span>{item.label}</span>
                <span className="muted">{item.hasApiKey ? t("settings.ai.configured") : t("settings.ai.notConfigured")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="draft-actions">
        <button type="button" className="btn" disabled={status.state === "checking"} onClick={() => void check()} data-testid="settings-test">{t("settings.ai.test")}</button>
        {status.text ? <span role="status" className={status.state === "failed" ? "settings-status failed" : "settings-status"} data-testid="settings-ai-status" data-state={status.state}>{status.text}</span> : null}
      </div>
      <p className="muted assist-hint">{t("settings.ai.keysNote")}</p>
      {error ? <p className="notice" role="alert" data-testid="settings-ai-error">{error}</p> : null}
    </section>
  );
}

function UsageSection() {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([settingsApi.usage(), settingsApi.tasks()])
      .then(([usageResult, taskResult]) => {
        setUsage(usageResult);
        setTasks(taskResult.tasks.slice(0, 10));
      })
      .catch((cause) => setError(errorText(t, cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card settings-section" aria-labelledby="settings-usage" data-testid="settings-usage">
      <h2 id="settings-usage" className="caps">{t("settings.usage.heading")}</h2>
      {usage ? (
        <p data-testid="settings-usage-total" data-tokens={usage.totalTokens}>
          {t("settings.usage.total", { used: formatCount(usage.totalTokens, locale), limit: formatCount(usage.dailyTokenLimit, locale) })}
          {usage.unknownCalls ? ` ${t("settings.usage.unknown", { count: usage.unknownCalls })}` : ""}
        </p>
      ) : null}
      <p className="muted assist-hint">{t("settings.usage.noPrices")}</p>
      <h3 className="caps">{t("settings.usage.recent")}</h3>
      {tasks.length === 0 ? <p className="muted" data-testid="settings-tasks-empty">{t("settings.usage.noTasks")}</p> : null}
      <ul className="version-list" data-testid="settings-tasks">
        {tasks.map((task) => (
          <li key={task.id} className="version" data-testid="settings-task" data-status={task.status}>
            <span>
              <span className="version-name">{t(`assist.status.${task.status}`, { defaultValue: task.status })}</span>
              <span className="muted version-meta">{formatRelativeTime(task.createdAt, locale)}</span>
            </span>
            {task.errorCode && task.status !== "completed" ? (
              <span className="muted">{errorText(t, new ApiError(0, task.errorCode, task.message ?? "", task.errorParams ?? {}))}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </section>
  );
}

function BackupSection() {
  const { t } = useTranslation();
  const { locale } = usePreferences();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    settingsApi.backupStatus().then((result) => setStatus(result.automatic)).catch(() => undefined);
  }, []);

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(null);
    let data: { database?: { works?: unknown[] } };
    try {
      data = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: "error", text: t("errors.BACKUP_FORMAT_INVALID") });
      return;
    }
    const count = Array.isArray(data?.database?.works) ? data.database.works.length : 0;
    if (!window.confirm(t("settings.backup.confirm", { count }))) return;
    setBusy(true);
    try {
      await settingsApi.restore(data);
      setMessage({ kind: "ok", text: t("settings.backup.restored", { count }) });
    } catch (cause) {
      setMessage({ kind: "error", text: errorText(t, cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section" aria-labelledby="settings-backup" data-testid="settings-backup">
      <h2 id="settings-backup" className="caps">{t("settings.backup.heading")}</h2>
      <p className="muted assist-hint">{t("settings.backup.intro")}</p>
      {status ? (
        <p data-testid="settings-backup-status">
          {status.lastBackup
            ? t("settings.backup.last", { when: formatRelativeTime(status.lastBackup.createdAt, locale), hours: status.intervalHours, count: status.retention })
            : t("settings.backup.none", { hours: status.intervalHours })}
        </p>
      ) : null}
      <div className="draft-actions">
        <a className="btn" href="/api/backup" download data-testid="settings-backup-download">{t("settings.backup.download")}</a>
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="settings-backup-restore">{t("settings.backup.restore")}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(event) => void restore(event)} data-testid="settings-backup-file" />
      </div>
      <p className="muted assist-hint">{t("settings.backup.replaceNote")}</p>
      {message ? <p className={message.kind === "error" ? "notice" : "assist-done"} role={message.kind === "error" ? "alert" : "status"} data-testid="settings-backup-message" data-kind={message.kind}>{message.text}</p> : null}
    </section>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  useDocumentTitle(t("settings.title"));
  return (
    <div className="shell" data-testid="settings">
      <a className="skip-link" href="#main">{t("app.skipToContent")}</a>
      <header className="shell-header">
        <Wordmark />
        <PreferenceControls />
      </header>
      <main id="main" className="shell-main settings-main">
        <div>
          <Link to="/" className="back-link" data-testid="back-home">{t("app.backHome")}</Link>
          <h1 className="display page-title">{t("settings.title")}</h1>
        </div>
        <p className="muted assist-hint">{t("settings.general")} {t("language.storyLanguageNote")}</p>
        <AiSection />
        <UsageSection />
        <BackupSection />
        <Notice />
      </main>
    </div>
  );
}
