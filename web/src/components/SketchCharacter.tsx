import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../api";
import { castApi, type EntityDraft } from "../castApi";

/**
 * "Describe someone new in a sentence" (mockup Cast.dc.html): the AI sketches
 * a card, which opens in the character dialog for the writer to check. Nothing
 * is saved until they save it there.
 */
export function SketchCharacter({ workId, language, onDraft }: {
  workId: string;
  language: string;
  onDraft: (draft: EntityDraft) => void;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sketch(event: FormEvent) {
    event.preventDefault();
    const text = description.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const { draft } = await castApi.sketchCharacter(workId, { description: text });
      onDraft(draft);
      setDescription("");
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cast-sketch" onSubmit={sketch} data-testid="cast-sketch">
      <label className="caps" htmlFor="cast-sketch-input">{t("cast.sketch.label")}</label>
      <input
        id="cast-sketch-input"
        className="field"
        maxLength={2000}
        lang={language}
        value={description}
        placeholder={t("cast.sketch.placeholder")}
        onChange={(event) => setDescription(event.target.value)}
        disabled={busy}
        data-testid="cast-sketch-input"
      />
      <div className="dialog-row">
        <button type="submit" className="btn" disabled={busy || !description.trim()} data-testid="cast-sketch-submit">
          {busy ? t("cast.sketch.busy") : t("cast.sketch.submit")}
        </button>
      </div>
      {busy ? <p className="muted assist-hint" role="status">{t("cast.sketch.waiting")}</p> : null}
      {error ? <p className="notice" role="alert" data-testid="cast-sketch-error">{error}</p> : null}
    </form>
  );
}
