import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Entity } from "../castApi";

// Names linked in the manuscript (plan 5.6): names and aliases from the cards
// are lightly underlined in the editor; resting the pointer on one, or the
// cursor in one, shows the card's summary with a way to open it.
//
// The text itself is never changed: the underline is a CSS Custom Highlight
// over the editor's text, so the chapter's Delta, undo history and saves are
// untouched. In a browser without highlights nothing is shown.

const HIGHLIGHT = "sumitale-names";
const LINKED_TYPES = new Set(["character", "location", "faction"]);
const CJK = /[㐀-鿿豈-﫿]/u;

interface Hit {
  range: Range;
  entity: Entity;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One pattern for every name. Latin names match whole words, in their own
 * case ("Mira", "Mira's", not "Miracle"); Chinese names match anywhere.
 * Longer names win ("the Governor's Wardens" before "the Governor").
 */
function namePattern(entities: Entity[]): { pattern: RegExp; owners: Map<string, Entity> } | null {
  const owners = new Map<string, Entity>();
  for (const entity of entities) {
    if (!LINKED_TYPES.has(entity.type)) continue;
    for (const name of [entity.name, ...entity.aliases]) {
      const term = name.trim();
      if (term.length < 2 || owners.has(term)) continue;
      owners.set(term, entity);
    }
  }
  if (!owners.size) return null;
  const terms = [...owners.keys()].sort((a, b) => b.length - a.length);
  const parts = terms.map((term) => (CJK.test(term) ? escape(term) : `(?<![\\p{L}\\p{N}])${latinTerm(term)}(?![\\p{L}\\p{N}])`));
  return { pattern: new RegExp(parts.join("|"), "gu"), owners };
}

// "The Archive" is written "the Archive" mid-sentence: a leading article
// matches in either case; the rest of the name keeps its own case.
const ARTICLE = /^(the|a|an) /i;
function latinTerm(term: string): string {
  const article = term.match(ARTICLE);
  if (!article) return escape(term);
  const word = article[1];
  return `[${word[0].toUpperCase()}${word[0].toLowerCase()}]${escape(word.slice(1).toLowerCase())} ${escape(term.slice(article[0].length))}`;
}

/** The card a matched text belongs to, whatever the case of its leading article. */
function ownerOf(owners: Map<string, Entity>, text: string): Entity | undefined {
  return owners.get(text) ?? [...owners.entries()].find(([term]) => ARTICLE.test(term) && term.toLowerCase() === text.toLowerCase())?.[1];
}

function findNames(root: HTMLElement, entities: Entity[]): Hit[] {
  const compiled = namePattern(entities);
  if (!compiled) return [];
  const hits: Hit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    compiled.pattern.lastIndex = 0;
    for (let match = compiled.pattern.exec(text); match; match = compiled.pattern.exec(text)) {
      const entity = ownerOf(compiled.owners, match[0]);
      if (!entity) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      hits.push({ range, entity });
    }
  }
  return hits;
}

/** The caret position under a point, in browsers that name it either way. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function hitAt(hits: Hit[], node: Node, offset: number): Hit | null {
  return hits.find((hit) => hit.range.startContainer === node && offset >= hit.range.startOffset && offset <= hit.range.endOffset) ?? null;
}

type Shown = { hit: Hit; top: number; left: number } | null;

export function NameLinks({ getRoot, entities, language, onOpen }: {
  /** The editor's content element (Quill's root), once it exists. */
  getRoot: () => HTMLElement | null;
  entities: Entity[];
  language: string;
  onOpen: (entity: Entity) => void;
}) {
  const { t } = useTranslation();
  const hitsRef = useRef<Hit[]>([]);
  const [shown, setShown] = useState<Shown>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const supported = typeof CSS !== "undefined" && "highlights" in CSS;

  // Find the names again whenever the text or the cards change.
  useEffect(() => {
    const root = getRoot();
    if (!root || !supported) return;
    const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
    let timer: number | undefined;
    const refresh = () => {
      hitsRef.current = findNames(root, entities);
      registry.set(HIGHLIGHT, new HighlightClass(...hitsRef.current.map((hit) => hit.range)));
    };
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 150);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    refresh();
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      registry.delete(HIGHLIGHT);
      hitsRef.current = [];
    };
  }, [getRoot, entities, supported]);

  // Show a card for the name under the pointer, or around the cursor.
  useEffect(() => {
    const root = getRoot();
    if (!root || !supported) return;
    const show = (hit: Hit | null) => {
      window.clearTimeout(hideTimer.current);
      if (!hit) {
        hideTimer.current = window.setTimeout(() => setShown(null), 250);
        return;
      }
      const box = hit.range.getBoundingClientRect();
      setShown((current) => (current?.hit === hit ? current : { hit, top: box.bottom + 6, left: box.left }));
    };
    const onMove = (event: MouseEvent) => {
      const at = caretAt(event.clientX, event.clientY);
      const hit = at ? hitAt(hitsRef.current, at.node, at.offset) : null;
      // The caret lands beside the nearest letter; only a name actually under the pointer counts.
      if (hit) {
        const box = hit.range.getBoundingClientRect();
        if (event.clientX < box.left - 1 || event.clientX > box.right + 1 || event.clientY < box.top - 1 || event.clientY > box.bottom + 1) {
          show(null);
          return;
        }
      }
      show(hit);
    };
    const onLeave = () => show(null);
    const onSelection = () => {
      const selection = document.getSelection();
      if (!selection || !selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return;
      show(hitAt(hitsRef.current, selection.anchorNode, selection.anchorOffset));
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    document.addEventListener("selectionchange", onSelection);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("selectionchange", onSelection);
      window.clearTimeout(hideTimer.current);
    };
  }, [getRoot, supported]);

  if (!shown) return null;
  const { entity } = shown.hit;
  const detail = entity.summary || Object.values(entity.card).find(Boolean) || "";
  return (
    <div
      className="name-card"
      role="dialog"
      aria-label={entity.name}
      style={{ top: shown.top, left: Math.max(8, Math.min(shown.left, window.innerWidth - 328)) }}
      onMouseEnter={() => window.clearTimeout(hideTimer.current)}
      onMouseLeave={() => setShown(null)}
      data-testid="name-card"
      data-entity-id={entity.id}
    >
      <span className="caps">{t(`write.names.types.${entity.type}`)}</span>
      <strong lang={language}>{entity.name}</strong>
      {entity.aliases.length ? <span className="muted name-card-aliases" lang={language}>{t("write.names.alsoCalled", { names: entity.aliases.join(", ") })}</span> : null}
      {detail ? <span lang={language}>{detail}</span> : <span className="muted">{t("write.names.noSummary")}</span>}
      <button type="button" className="btn quiet name-card-open" onMouseDown={(event) => event.preventDefault()} onClick={() => onOpen(entity)} data-testid="name-card-open">{t("write.names.open")}</button>
    </div>
  );
}
