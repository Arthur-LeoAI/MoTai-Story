import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { errorText, request, type StoryFocus, type StoryLanguage, type WorkSummary } from "../api";
import { UI_LOCALES } from "../i18n";
import { workPath } from "../sections";

const workBase = (workId: string) => `/api/works/${encodeURIComponent(workId)}`;
const EXPORT_FORMATS = ["docx", "markdown", "txt", "html"] as const;

/** Title, premise, genre, focus and story language; export; delete. */
export function StorySettingsDialog({ work, open, onClose, onSaved }: {
  work: WorkSummary;
  open: boolean;
  onClose: () => void;
  onSaved: (work: WorkSummary) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [form, setForm] = useState({ title: work.title, premise: work.premise, genre: work.genre, focus: work.focus, language: work.language });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setForm({ title: work.title, premise: work.premise, genre: work.genre, focus: work.focus, language: work.language });
      setError("");
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open, work]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(workBase(work.id), { method: "PATCH", body: JSON.stringify({ ...form, title: form.title.trim() || work.title }) });
      onSaved({ ...work, ...form, title: form.title.trim() || work.title });
      onClose();
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("story.deleteConfirm", { title: work.title }))) return;
    setBusy(true);
    try {
      await request(workBase(work.id), { method: "DELETE" });
      navigate("/");
    } catch (cause) {
      setError(errorText(t, cause));
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="story-settings-title" data-testid="story-settings">
      <form onSubmit={save} className="dialog-body">
        <h2 id="story-settings-title" className="display dialog-title">{t("story.title")}</h2>
        <label className="caps" htmlFor="story-name">{t("story.name")}</label>
        <input id="story-name" className="field" maxLength={100} value={form.title} lang={form.language} onChange={(event) => setForm({ ...form, title: event.target.value })} data-testid="story-name" />
        <label className="caps" htmlFor="story-premise">{t("home.premiseLabel")}</label>
        <textarea id="story-premise" className="field scene-text" rows={2} maxLength={500} value={form.premise} lang={form.language} onChange={(event) => setForm({ ...form, premise: event.target.value })} data-testid="story-premise-input" />
        <label className="caps" htmlFor="story-genre">{t("story.genre")}</label>
        <input id="story-genre" className="field" maxLength={60} value={form.genre} lang={form.language} onChange={(event) => setForm({ ...form, genre: event.target.value })} data-testid="story-genre" />

        <fieldset className="dialog-fieldset">
          <legend className="caps">{t("story.focus")}</legend>
          {(["shape", "write"] as StoryFocus[]).map((focus) => (
            <label key={focus} className="scene-check">
              <input type="radio" name="story-focus" value={focus} checked={form.focus === focus} onChange={() => setForm({ ...form, focus })} data-testid={`story-focus-${focus}`} />
              <span><strong>{t(`home.${focus}.label`)}</strong> · {t(`home.${focus}.title`)}</span>
            </label>
          ))}
          <p className="muted assist-hint">{t("home.changeLater")}</p>
        </fieldset>

        <label className="caps" htmlFor="story-language">{t("home.storyLanguage")}</label>
        <select id="story-language" className="field" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value as StoryLanguage })} data-testid="story-language">
          {UI_LOCALES.map((code) => <option key={code} value={code} lang={code}>{t(`language.names.${code}`)}</option>)}
        </select>
        <p className="muted assist-hint">{t("story.languageNote")}</p>

        {error ? <p className="notice" role="alert" data-testid="story-error">{error}</p> : null}
        <div className="draft-actions dialog-actions">
          <button type="submit" className="btn primary" disabled={busy} data-testid="story-save">{t("ideate.save")}</button>
          <button type="button" className="btn quiet" onClick={onClose}>{t("ideate.cancel")}</button>
        </div>

        <hr className="rule" />
        <div className="caps">{t("story.export")}</div>
        <div className="draft-actions">
          {EXPORT_FORMATS.map((format) => (
            <a key={format} className="btn quiet" href={`${workBase(work.id)}/export?format=${format}`} download data-testid={`story-export-${format}`}>{t(`story.formats.${format}`)}</a>
          ))}
        </div>
        <hr className="rule" />
        <button type="button" className="btn quiet danger" disabled={busy} onClick={() => void remove()} data-testid="story-delete">{t("story.delete")}</button>
      </form>
    </dialog>
  );
}

interface Hit {
  chapterId: string;
  title: string;
  excerpt: string;
}

/** Search the story's chapters. Ctrl/⌘+K focuses the field. */
export function StorySearch({ work }: { work: WorkSummary }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const timer = window.setTimeout(() => {
      request<{ hits: Hit[] }>(`${workBase(work.id)}/search?q=${encodeURIComponent(q)}`)
        .then((result) => {
          setHits(result.hits);
          setError("");
        })
        .catch((cause) => setError(errorText(t, cause)));
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, work.id]);

  return (
    <div className="story-search" role="search">
      <label className="visually-hidden" htmlFor="story-search">{t("search.label")}</label>
      <input
        ref={inputRef}
        id="story-search"
        className="field"
        type="search"
        value={query}
        placeholder={t("search.placeholder")}
        lang={work.language}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && setQuery("")}
        data-testid="search-input"
      />
      {error ? <p className="notice" role="alert">{error}</p> : null}
      {hits ? (
        <ul className="search-hits" data-testid="search-results">
          {hits.length === 0 ? <li className="muted" data-testid="search-empty">{t("search.none")}</li> : null}
          {hits.map((hit) => (
            <li key={hit.chapterId}>
              <Link to={`${workPath(work.id, "write")}?chapter=${encodeURIComponent(hit.chapterId)}`} onClick={() => setQuery("")} data-testid="search-hit">
                <span className="search-hit-title" lang={work.language}>{hit.title}</span>
                <span className="muted search-hit-excerpt" lang={work.language}>{hit.excerpt.trim()}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
