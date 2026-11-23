import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText, request } from "../api";
import { stylesApi, type WritingStyle } from "../stylesApi";
import type { ManuscriptHandle } from "./Manuscript";

// "Three ways" (plan 5.9 C, with "why it's written this way"): three versions
// of the selected passage side by side, by angle (tenser, richer, leaner) or
// by three writing styles. Picking one replaces the passage in the editor as
// an ordinary edit, so it is saved like typing and undo brings the original
// back. "Explain why" is off by default and remembered in this browser.

interface Variant {
  key: string;
  label: string;
  text: string;
  why?: string;
}

type Range = { index: number; length: number };
type Asked = { range: Range; original: string; variants: Variant[] };

const EXPLAIN_KEY = "novel-studio:explain-why";
const AROUND = 1500;

function storedExplain(): boolean {
  try {
    return window.localStorage.getItem(EXPLAIN_KEY) === "on";
  } catch {
    return false;
  }
}

export function ThreeWays({ workId, language, getEditor, disabled }: {
  workId: string;
  language: string;
  getEditor: () => ManuscriptHandle | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [by, setBy] = useState<"angles" | "styles">("angles");
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [explain, setExplain] = useState(storedExplain);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    stylesApi.list(language).then(({ styles: list }) => {
      setStyles(list);
      setChosen(list.slice(0, 3).map((style) => style.id));
    }).catch(() => setStyles([]));
  }, [language]);

  function toggleExplain(next: boolean) {
    setExplain(next);
    try {
      window.localStorage.setItem(EXPLAIN_KEY, next ? "on" : "off");
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  async function ask() {
    const editor = getEditor();
    const range = editor?.selection();
    if (!editor || !range || range.length === 0) {
      setError(t("errors.VARIANT_PASSAGE_REQUIRED"));
      return;
    }
    const original = editor.textIn(range);
    const start = Math.max(0, range.index - AROUND);
    const end = range.index + range.length;
    setBusy(true);
    setError("");
    setNotice("");
    setAsked(null);
    try {
      const { variants } = await request<{ variants: Variant[] }>(`/api/works/${encodeURIComponent(workId)}/variants`, {
        method: "POST",
        body: JSON.stringify({
          passage: original,
          before: editor.textIn({ index: start, length: range.index - start }),
          after: editor.textIn({ index: end, length: Math.min(AROUND, Math.max(0, editor.length() - end)) }),
          explain,
          ...(by === "styles" ? { styleIds: chosen } : {})
        })
      });
      setAsked({ range, original, variants });
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  function use(variant: Variant) {
    const editor = getEditor();
    if (!editor || !asked) return;
    // The passage may have been edited while the versions were being written.
    if (editor.textIn(asked.range) !== asked.original) {
      setError(t("ways.changed"));
      return;
    }
    editor.replace(asked.range, variant.text);
    setAsked(null);
    setNotice(t("ways.used", { label: variant.label }));
  }

  return (
    <section className="three-ways" aria-labelledby="three-ways-title" data-testid="three-ways">
      <h3 id="three-ways-title" className="caps spine-title">{t("ways.title")}</h3>
      <p className="muted assist-hint">{t("ways.hint")}</p>
      <div className="cast-views" role="group" aria-label={t("ways.byLabel")}>
        {(["angles", "styles"] as const).map((item) => (
          <button key={item} type="button" className={by === item ? "btn on" : "btn"} aria-pressed={by === item} onClick={() => setBy(item)} data-testid={`ways-by-${item}`}>{t(`ways.by.${item}`)}</button>
        ))}
      </div>
      {by === "styles" ? (
        <div className="ways-styles">
          {[0, 1, 2].map((index) => (
            <select key={index} className="field" aria-label={t("ways.styleLabel", { number: index + 1 })} value={chosen[index] ?? ""} onChange={(event) => {
              const next = [...chosen];
              next[index] = event.target.value;
              setChosen(next);
            }} data-testid="ways-style">
              {styles.map((style) => <option key={style.id} value={style.id} lang={style.language}>{style.name}</option>)}
            </select>
          ))}
        </div>
      ) : null}
      <label className="scene-check">
        <input type="checkbox" checked={explain} onChange={(event) => toggleExplain(event.target.checked)} data-testid="ways-explain" />
        <span>{t("ways.explain")}</span>
      </label>
      <button type="button" className="btn" onClick={() => void ask()} disabled={disabled || busy || (by === "styles" && chosen.filter(Boolean).length < 3)} data-testid="ways-ask">
        {busy ? t("ways.asking") : t("ways.ask")}
      </button>
      {error ? <p className="notice" role="alert" data-testid="ways-error">{error}</p> : null}
      {notice ? <p className="assist-done" role="status" data-testid="ways-notice">{notice}</p> : null}
      {asked ? (
        <div className="ways-list" data-testid="ways-list">
          {asked.variants.map((variant) => (
            <article key={variant.key} className="card way" data-testid="way" data-key={variant.key}>
              <span className="caps">{variant.label}</span>
              <p className="way-text" lang={language}>{variant.text}</p>
              {variant.why ? <p className="muted way-why" lang={language} data-testid="way-why">{variant.why}</p> : null}
              <button type="button" className="btn primary" onClick={() => use(variant)} data-testid="way-use">{t("ways.use")}</button>
            </article>
          ))}
          <button type="button" className="btn quiet" onClick={() => setAsked(null)} data-testid="ways-keep">{t("ways.keep")}</button>
        </div>
      ) : null}
    </section>
  );
}
