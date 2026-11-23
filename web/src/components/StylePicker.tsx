import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../api";
import { stylesApi, type WritingStyle } from "../stylesApi";
import { StyleManager } from "./StyleManager";

/** The story's writing style: every AI writing request for this story uses it. */
export function StylePicker({ workId, language }: { workId: string; language: string }) {
  const { t } = useTranslation();
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [styleId, setStyleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([stylesApi.list(language), stylesApi.storyStyle(workId)])
      .then(([list, current]) => {
        if (!active) return;
        setStyles(list.styles);
        // A style that was deleted reads as none.
        setStyleId(list.styles.some((style) => style.id === current.styleId) ? current.styleId : "");
      })
      .catch((cause) => active && setError(errorText(t, cause)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, language, version]);

  async function choose(next: string) {
    const before = styleId;
    setStyleId(next);
    setBusy(true);
    setError("");
    try {
      setStyleId((await stylesApi.setStoryStyle(workId, next)).styleId);
    } catch (cause) {
      setStyleId(before);
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  const chosen = styles.find((style) => style.id === styleId);
  const builtin = styles.filter((style) => style.source === "builtin");
  const own = styles.filter((style) => style.source !== "builtin");
  return (
    <div className="style-picker" data-testid="style-picker">
      <label className="caps" htmlFor="story-style">{t("styles.label")}</label>
      <select id="story-style" className="field" value={styleId} onChange={(event) => void choose(event.target.value)} disabled={busy} data-testid="style-select">
        <option value="">{t("styles.none")}</option>
        {builtin.length ? (
          <optgroup label={t("styles.builtin")}>
            {builtin.map((style) => <option key={style.id} value={style.id} lang={style.language}>{style.name}</option>)}
          </optgroup>
        ) : null}
        {own.length ? (
          <optgroup label={t("styles.own")}>
            {own.map((style) => <option key={style.id} value={style.id} lang={style.language}>{style.name}</option>)}
          </optgroup>
        ) : null}
      </select>
      <p className="muted assist-hint" lang={chosen?.language} data-testid="style-description">{chosen ? chosen.description : t("styles.noneHint")}</p>
      <button type="button" className="btn quiet style-manage" onClick={() => setManaging(true)} data-testid="style-manage">{t("styles.manage.open")}</button>
      <StyleManager open={managing} language={language} onClose={() => setManaging(false)} onChanged={() => setVersion((value) => value + 1)} />
      {error ? <p className="notice" role="alert" data-testid="style-error">{error}</p> : null}
    </div>
  );
}
