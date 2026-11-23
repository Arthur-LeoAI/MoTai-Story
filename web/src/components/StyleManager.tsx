import { useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorText } from "../api";
import { stylesApi, type StyleDraft, type WritingStyle } from "../stylesApi";

// "Your styles" (plan 5.9.1): the writer's own style cards for this story's
// language. A new card starts from a few words, from a passage the writer
// likes (the AI describes how it is written; the passage is not kept), or
// from nothing. Cards can be exported to a file and imported again.

type Start = "describe" | "passage" | "hand";
type Editing = { style: WritingStyle | null; draft: StyleDraft };

const EXPORT_FORMAT = "sumitale-style";
const empty = (language: string): StyleDraft => ({ language: language === "en" ? "en" : "zh-CN", name: "", description: "", guidance: "", samples: [] });
const fileName = (name: string) => `${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "style"}.style.json`;

export function StyleManager({ open, language, onClose, onChanged }: {
  open: boolean;
  language: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [start, setStart] = useState<Start>("describe");
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const { styles: mine } = await stylesApi.mine();
    setStyles(mine.filter((style) => style.language === (language === "en" ? "en" : "zh-CN")));
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setEditing(null);
      setSource("");
      setError("");
      setNotice("");
      void load().catch((cause) => setError(errorText(t, cause)));
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(errorText(t, cause));
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const draftFrom = () =>
    run(async () => {
      const text = source.trim();
      const { draft } = await stylesApi.draft({ language, ...(start === "passage" ? { passage: text } : { description: text }) });
      setEditing({ style: null, draft });
    });

  const save = (submit: FormEvent) => {
    submit.preventDefault();
    if (!editing) return;
    void run(async () => {
      const draft = { ...editing.draft, samples: editing.draft.samples.map((sample) => sample.trim()).filter(Boolean) };
      if (editing.style) await stylesApi.update(editing.style, draft);
      else await stylesApi.create(draft);
      setEditing(null);
      setSource("");
      await load();
      onChanged();
      setNotice(t("styles.manage.saved"));
    });
  };

  const remove = (style: WritingStyle) => {
    if (!window.confirm(t("styles.manage.deleteConfirm", { name: style.name }))) return;
    void run(async () => {
      await stylesApi.remove(style);
      await load();
      onChanged();
    });
  };

  function exportStyle(style: WritingStyle) {
    const card = { format: EXPORT_FORMAT, version: 1, language: style.language, name: style.name, description: style.description, guidance: style.guidance, samples: style.samples };
    const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(style.name);
    link.click();
    URL.revokeObjectURL(url);
  }

  function importStyle(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void run(async () => {
      let card: Partial<StyleDraft> & { format?: string };
      try {
        card = JSON.parse(await file.text());
      } catch {
        throw new Error(t("styles.manage.importInvalid"));
      }
      if (card.format !== EXPORT_FORMAT || typeof card.name !== "string" || typeof card.guidance !== "string") throw new Error(t("styles.manage.importInvalid"));
      await stylesApi.create({ language: card.language === "en" ? "en" : "zh-CN", name: card.name, description: card.description ?? "", guidance: card.guidance, samples: Array.isArray(card.samples) ? card.samples : [] }, "imported");
      await load();
      onChanged();
      setNotice(card.language === (language === "en" ? "en" : "zh-CN") ? t("styles.manage.imported", { name: card.name }) : t("styles.manage.importedOther", { name: card.name }));
    });
  }

  const set = (patch: Partial<StyleDraft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });
  const samples = editing ? [...editing.draft.samples, "", "", ""].slice(0, 3) : [];

  return (
    <dialog ref={dialogRef} className="dialog cast-dialog style-manager" onClose={onClose} aria-labelledby="style-manager-title" data-testid="style-manager">
      <div className="dialog-body">
        <h2 id="style-manager-title" className="display dialog-title">{t("styles.manage.title")}</h2>
        <p className="muted assist-hint">{t("styles.manage.intro")}</p>

        {styles.length ? (
          <ul className="style-list">
            {styles.map((style) => (
              <li key={style.id} className="style-item" data-testid="own-style" data-style-id={style.id}>
                <div>
                  <strong lang={style.language}>{style.name}</strong>
                  {style.source === "imported" ? <span className="muted"> · {t("styles.manage.importedTag")}</span> : null}
                  {style.description ? <div className="muted" lang={style.language}>{style.description}</div> : null}
                </div>
                <div className="style-item-actions">
                  <button type="button" className="btn quiet" onClick={() => setEditing({ style, draft: { language: style.language, name: style.name, description: style.description, guidance: style.guidance, samples: style.samples } })} disabled={busy} data-testid="own-style-edit">{t("styles.manage.edit")}</button>
                  <button type="button" className="btn quiet" onClick={() => exportStyle(style)} data-testid="own-style-export">{t("styles.manage.export")}</button>
                  <button type="button" className="btn quiet cast-delete" onClick={() => remove(style)} disabled={busy} data-testid="own-style-delete">{t("styles.manage.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted cast-empty" data-testid="own-styles-empty">{t("styles.manage.empty")}</p>}

        {!editing ? (
          <section className="style-new" aria-labelledby="style-new-title">
            <h3 id="style-new-title" className="caps spine-title">{t("styles.manage.newTitle")}</h3>
            <div className="cast-views" role="group" aria-label={t("styles.manage.howLabel")}>
              {(["describe", "passage", "hand"] as const).map((item) => (
                <button key={item} type="button" className={start === item ? "btn on" : "btn"} aria-pressed={start === item} onClick={() => setStart(item)} data-testid={`style-start-${item}`}>{t(`styles.manage.start.${item}`)}</button>
              ))}
            </div>
            {start === "hand" ? (
              <button type="button" className="btn primary" onClick={() => setEditing({ style: null, draft: empty(language) })} data-testid="style-by-hand">{t("styles.manage.blank")}</button>
            ) : (
              <>
                <label className="caps" htmlFor="style-source">{t(`styles.manage.sourceLabel.${start}`)}</label>
                <textarea id="style-source" className="field" rows={start === "passage" ? 8 : 3} maxLength={start === "passage" ? 6000 : 1000} lang={language} value={source} placeholder={t(`styles.manage.sourceHint.${start}`)} onChange={(change) => setSource(change.target.value)} data-testid="style-source" />
                {start === "passage" ? <p className="muted assist-hint">{t("styles.manage.passageNote")}</p> : null}
                <button type="button" className="btn primary" onClick={() => void draftFrom()} disabled={busy || !source.trim()} data-testid="style-draft">{busy ? t("styles.manage.drafting") : t("styles.manage.draft")}</button>
              </>
            )}
          </section>
        ) : (
          <form className="style-form" onSubmit={save} noValidate data-testid="style-form">
            <h3 className="caps spine-title">{editing.style ? t("styles.manage.editTitle") : t("styles.manage.draftTitle")}</h3>
            {!editing.style ? <p className="muted assist-hint">{t("styles.manage.draftNote")}</p> : null}
            <div className="dialog-field">
              <label className="caps" htmlFor="style-name">{t("styles.manage.fields.name")}</label>
              <input id="style-name" className="field" maxLength={80} lang={language} value={editing.draft.name} onChange={(change) => set({ name: change.target.value })} data-testid="style-name" />
            </div>
            <div className="dialog-field">
              <label className="caps" htmlFor="style-description-field">{t("styles.manage.fields.description")}</label>
              <input id="style-description-field" className="field" maxLength={300} lang={language} value={editing.draft.description} onChange={(change) => set({ description: change.target.value })} data-testid="style-description-field" />
            </div>
            <div className="dialog-field">
              <label className="caps" htmlFor="style-guidance">{t("styles.manage.fields.guidance")}</label>
              <textarea id="style-guidance" className="field" rows={6} maxLength={3000} lang={language} value={editing.draft.guidance} placeholder={t("styles.manage.guidanceHint")} onChange={(change) => set({ guidance: change.target.value })} data-testid="style-guidance" />
            </div>
            {samples.map((sample, index) => (
              <div key={index} className="dialog-field">
                <label className="caps" htmlFor={`style-sample-${index}`}>{t("styles.manage.fields.sample", { number: index + 1 })}</label>
                <textarea id={`style-sample-${index}`} className="field" rows={3} maxLength={2000} lang={language} value={sample} onChange={(change) => {
                  const next = [...samples];
                  next[index] = change.target.value;
                  set({ samples: next });
                }} data-testid="style-sample" />
              </div>
            ))}
            <div className="draft-actions">
              <button type="submit" className="btn primary" disabled={busy} data-testid="style-save">{busy ? t("write.saving") : t("ideate.save")}</button>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy} data-testid="style-form-cancel">{t("ideate.cancel")}</button>
            </div>
          </form>
        )}

        {error ? <p className="notice" role="alert" data-testid="style-manager-error">{error}</p> : null}
        {notice ? <p className="assist-done" role="status" data-testid="style-manager-notice">{notice}</p> : null}
        <div className="dialog-row dialog-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="style-import">{t("styles.manage.import")}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importStyle} data-testid="style-import-file" />
          <button type="button" className="btn" onClick={onClose} data-testid="style-manager-close">{t("styles.manage.close")}</button>
        </div>
      </div>
    </dialog>
  );
}
