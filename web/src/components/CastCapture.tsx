import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { errorText, type WorkSummary } from "../api";
import { castApi, type Entity } from "../castApi";
import { workPath } from "../sections";
import { CharacterDialog, type CharacterEditing } from "./CharacterDialog";

type Candidate = { name: string; summary: string };

/**
 * Capture from conversation (plan 5.4): under the latest reply, the people
 * named in that exchange who are not in the Cast yet, each with
 * `+ Add "Mira" to Cast`. Choosing one has the AI sketch a card, which opens
 * in the character dialog; nothing is saved until the writer saves it.
 */
export function CastCapture({ work, chatId, messageId }: { work: WorkSummary; chatId: string; messageId: string }) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sketching, setSketching] = useState("");
  const [editing, setEditing] = useState<CharacterEditing>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Finding new names is a help, not a step: if it fails, nothing is shown.
    castApi.castCandidates(work.id, chatId, messageId)
      .then(({ candidates: found }) => active && setCandidates(found))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [work.id, chatId, messageId]);

  async function sketch(candidate: Candidate) {
    setSketching(candidate.name);
    setError("");
    try {
      const description = candidate.summary ? `${candidate.name} — ${candidate.summary}` : candidate.name;
      const { draft } = await castApi.sketchCharacter(work.id, { description, chatId, messageId });
      setEditing({ mode: "new", draft: { ...draft, name: draft.name || candidate.name } });
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setSketching("");
    }
  }

  function saved(entity: Entity, from: string) {
    setCandidates((current) => current.filter((item) => item.name !== from && item.name !== entity.name));
    setAdded((current) => [...current, entity.name]);
  }

  const [from, setFrom] = useState("");

  if (!candidates.length && !added.length && !error) return null;

  return (
    <div className="capture" data-testid="cast-capture">
      {candidates.length ? (
        <div className="capture-chips">
          {candidates.map((candidate) => (
            <button
              key={candidate.name}
              type="button"
              className="btn capture-chip"
              disabled={Boolean(sketching)}
              title={candidate.summary || undefined}
              onClick={() => {
                setFrom(candidate.name);
                void sketch(candidate);
              }}
              data-testid="capture-chip"
              data-name={candidate.name}
            >
              {sketching === candidate.name ? t("ideate.capture.sketching") : t("ideate.capture.add", { name: candidate.name })}
            </button>
          ))}
        </div>
      ) : null}
      {added.length ? (
        <p className="muted assist-hint" role="status" data-testid="capture-notice">
          {t("ideate.capture.added", { names: added.join(t("ideate.capture.separator")) })}{" "}
          <Link to={workPath(work.id, "cast")} data-testid="capture-open-cast">{t("ideate.capture.openCast")}</Link>
        </p>
      ) : null}
      {error ? <p className="notice" role="alert" data-testid="capture-error">{error}</p> : null}
      <CharacterDialog
        workId={work.id}
        language={work.language}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(entity) => saved(entity, from)}
        onRemoved={() => undefined}
        onReload={async () => null}
      />
    </div>
  );
}
