import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { request, errorText, type StoryLanguage } from "../api";
import { UI_LOCALES } from "../i18n";

interface Preview {
  id: string;
  title: string;
  encoding: string;
  warningCodes?: string[];
  chapters: Array<{ title: string; content: string }>;
}

const ENCODINGS = ["auto", "utf-8", "gb18030"] as const;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Import a manuscript (TXT, Markdown, DOCX): preview the chapters, then create the story. */
export default function ImportDialog({ open, defaultLanguage, onClose, onImported }: {
  open: boolean;
  defaultLanguage: StoryLanguage;
  onClose: () => void;
  onImported: (workId: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>("auto");
  const [language, setLanguage] = useState<StoryLanguage>(defaultLanguage);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFile(null);
      setPreview(null);
      setError("");
      setLanguage(defaultLanguage);
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open, defaultLanguage]);

  async function read(nextFile: File | null, nextEncoding = encoding, nextLanguage = language) {
    if (!nextFile) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const base64 = await toBase64(nextFile);
      const { preview: parsed } = await request<{ preview: Preview }>("/api/imports", {
        method: "POST",
        body: JSON.stringify({ fileName: nextFile.name, base64, encoding: nextEncoding, language: nextLanguage })
      });
      setPreview(parsed);
      setTitle(parsed.title || nextFile.name.replace(/\.[^.]+$/, ""));
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    void read(next);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const { work } = await request<{ work: { id: string } }>(`/api/imports/${encodeURIComponent(preview.id)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), language, focus: "write" })
      });
      onImported(work.id);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="import-title" data-testid="import-dialog">
      <form onSubmit={confirm} className="dialog-body">
        <h2 id="import-title" className="display dialog-title">{t("import.title")}</h2>
        <p className="muted assist-hint">{t("import.intro")}</p>

        <label className="caps" htmlFor="import-file">{t("import.file")}</label>
        <input id="import-file" type="file" accept=".txt,.md,.markdown,.docx" onChange={pick} disabled={busy} data-testid="import-file" />

        <div className="dialog-row">
          <label className="dialog-field">
            <span className="caps">{t("home.storyLanguage")}</span>
            <select className="field" value={language} onChange={(event) => {
              const next = event.target.value as StoryLanguage;
              setLanguage(next);
              void read(file, encoding, next);
            }} data-testid="import-language">
              {UI_LOCALES.map((code) => <option key={code} value={code} lang={code}>{t(`language.names.${code}`)}</option>)}
            </select>
          </label>
          <label className="dialog-field">
            <span className="caps">{t("import.encoding")}</span>
            <select className="field" value={encoding} onChange={(event) => {
              const next = event.target.value as (typeof ENCODINGS)[number];
              setEncoding(next);
              void read(file, next);
            }} data-testid="import-encoding">
              {ENCODINGS.map((code) => <option key={code} value={code}>{t(`import.encodings.${code}`)}</option>)}
            </select>
          </label>
        </div>

        {busy && !preview ? <p className="muted">{t("import.reading")}</p> : null}
        {error ? <p className="notice" role="alert" data-testid="import-error">{error}</p> : null}

        {preview ? (
          <section className="import-preview" data-testid="import-preview">
            <label className="caps" htmlFor="import-name">{t("import.storyTitle")}</label>
            <input id="import-name" className="field" value={title} maxLength={100} lang={language} onChange={(event) => setTitle(event.target.value)} data-testid="import-name" />
            {(preview.warningCodes ?? []).map((code) => <p key={code} className="muted assist-hint">{t(`import.warnings.${code}`)}</p>)}
            <div className="caps">{t("import.chapters", { count: preview.chapters.length })}</div>
            <ol className="import-chapters">
              {preview.chapters.slice(0, 200).map((chapter, index) => (
                <li key={index} data-testid="import-chapter" lang={language}>
                  <span className="import-chapter-title">{chapter.title}</span>
                  <span className="muted import-excerpt">{chapter.content.trim().slice(0, 80)}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <div className="draft-actions dialog-actions">
          <button type="submit" className="btn primary" disabled={busy || !preview} data-testid="import-confirm">{t("import.confirm")}</button>
          <button type="button" className="btn quiet" onClick={onClose} data-testid="import-cancel">{t("ideate.cancel")}</button>
        </div>
      </form>
    </dialog>
  );
}
