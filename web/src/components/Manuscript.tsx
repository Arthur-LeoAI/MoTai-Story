import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Quill from "quill";
import "quill/dist/quill.core.css";
import type { RichContent } from "../writeApi";

export interface ManuscriptHandle {
  contents: () => RichContent;
  text: () => string;
  focus: () => void;
  /** The last selection the writer made (kept while they use the side panel); null if none. */
  selection: () => { index: number; length: number } | null;
  /** Text in a range; used for "rewrite the selected text". */
  textIn: (range: { index: number; length: number }) => string;
  /** Length of the document, including Quill's final newline. */
  length: () => number;
}

interface ManuscriptProps {
  /** Replaces the editor's text whenever `contentKey` changes (another chapter, a reload). */
  initial: RichContent;
  contentKey: string;
  language: string;
  placeholder: string;
  label: string;
  onChange: () => void;
}

// Only the formats the server keeps (src/studio.js ALLOWED_ATTRIBUTES).
const FORMATS = ["bold", "italic", "link", "header", "blockquote", "list"];

/** The chapter text: a Quill editor with keyboard formatting and no toolbar, as in the mockup. */
const Manuscript = forwardRef<ManuscriptHandle, ManuscriptProps>(function Manuscript(
  { initial, contentKey, language, placeholder, label, onChange },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const onChangeRef = useRef(onChange);
  const selectionRef = useRef<{ index: number; length: number } | null>(null);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const quill = new Quill(host, {
      formats: FORMATS,
      placeholder,
      modules: { toolbar: false, history: { delay: 700, maxStack: 200, userOnly: true } }
    });
    quill.on("text-change", (_delta, _old, source) => {
      if (source === "user") onChangeRef.current();
    });
    // Keep the last real selection: clicking into the side panel blurs the editor.
    quill.on("selection-change", (range) => {
      if (range) selectionRef.current = { index: range.index, length: range.length };
    });
    quillRef.current = quill;
    return () => {
      quillRef.current = null;
      host.innerHTML = "";
    };
    // The editor is created once; text arrives through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.setContents((initial?.ops ?? []) as never, "silent");
    quill.history.clear();
    selectionRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  useEffect(() => {
    const root = quillRef.current?.root;
    if (!root) return;
    root.setAttribute("lang", language);
    root.setAttribute("aria-label", label);
    root.setAttribute("data-placeholder", placeholder);
    root.setAttribute("data-testid", "manuscript-editor");
  }, [language, label, placeholder]);

  useImperativeHandle(ref, () => ({
    contents: () => ({ version: 1, ops: (quillRef.current?.getContents().ops ?? []) as RichContent["ops"] }),
    text: () => quillRef.current?.getText() ?? "",
    focus: () => quillRef.current?.focus(),
    selection: () => selectionRef.current,
    textIn: (range) => quillRef.current?.getText(range.index, range.length) ?? "",
    length: () => quillRef.current?.getLength() ?? 1
  }), []);

  return <div className="manuscript-host" ref={hostRef} />;
});

export default Manuscript;
