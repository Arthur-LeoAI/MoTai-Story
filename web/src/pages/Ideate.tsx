import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorText, type WorkSummary } from "../api";
import {
  ARTIFACT_FIELDS,
  ARTIFACT_TYPES,
  StreamError,
  ideateApi,
  streamMessage,
  type ArtifactType,
  type Chat,
  type ChatMessage,
  type Proposal,
  type StoryMaterial
} from "../ideateApi";

interface IdeateProps {
  work: WorkSummary;
}

/** A reply that is still being written, or that failed before it was saved. */
interface Pending {
  chatId: string;
  userText: string;
  /** Set once the server has saved the user's message; a retry answers that message again. */
  userMessageId: string;
  text: string;
  state: "streaming" | "failed";
  error: string;
}

function DraftCard({ proposal, storyLanguage, busy, onKeep, onUndo, onDiscard }: {
  proposal: Proposal;
  storyLanguage: string;
  busy: boolean;
  onKeep: (keys: string[]) => void;
  onUndo: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposal.sections.map((section) => section.key)));
  const open = proposal.status === "pending" || proposal.status === "reverted";
  const keptKeys = new Set(Object.keys(proposal.previousValues));

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <article className="card draft-card" data-testid="draft-card" data-status={proposal.status} data-type={proposal.type}>
      <header className="draft-head">
        <span className="caps accent">{t("draft.heading", { type: t(`artifact.types.${proposal.type}`) })}</span>
        {open ? <span className="muted draft-note">{proposal.status === "reverted" ? t("draft.undone") : t("draft.note")}</span> : null}
      </header>
      <div className="draft-sections">
        {proposal.sections.map((section) => {
          const id = `draft-${proposal.id}-${section.key}`;
          const checked = open ? selected.has(section.key) : keptKeys.has(section.key);
          return (
            <div className="draft-section" key={section.key} data-testid="draft-section" data-key={section.key}>
              <label className="draft-section-head" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  disabled={!open || busy}
                  onChange={() => toggle(section.key)}
                  data-testid="draft-section-checkbox"
                />
                <span className="caps">{t(`artifact.fields.${section.key}`)}</span>
                {open && section.before ? <span className="muted draft-replaces">{t("draft.replaces")}</span> : null}
              </label>
              <div className="draft-text" lang={storyLanguage}>{section.after}</div>
            </div>
          );
        })}
      </div>
      {open ? (
        <div className="draft-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy || selected.size === 0}
            onClick={() => onKeep([...selected])}
            data-testid="draft-keep"
          >
            {selected.size ? t("draft.keep", { count: selected.size }) : t("draft.keepNone")}
          </button>
          <button type="button" className="btn quiet" disabled={busy} onClick={onDiscard} data-testid="draft-discard">{t("draft.discard")}</button>
        </div>
      ) : proposal.status === "applied" ? (
        <div className="draft-actions">
          <span className="draft-result" data-testid="draft-kept">{t("draft.kept")}</span>
          <button type="button" className="btn quiet" disabled={busy} onClick={onUndo} data-testid="draft-undo">{t("draft.undo")}</button>
        </div>
      ) : (
        <div className="draft-actions">
          <span className="muted draft-result">{t("draft.discarded")}</span>
        </div>
      )}
    </article>
  );
}

export default function Ideate({ work }: IdeateProps) {
  const { t } = useTranslation();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [activeChatId, setActiveChatId] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [material, setMaterial] = useState<StoryMaterial>(work.storyBible ?? {});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [drafting, setDrafting] = useState<ArtifactType | null>(null);
  const [busyProposal, setBusyProposal] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const chat = useMemo(() => chats?.find((item) => item.id === activeChatId) ?? chats?.[0] ?? null, [chats, activeChatId]);
  const streaming = pending?.state === "streaming";
  const chatTitle = (item: Chat) => (item.untitled || !item.title ? t("ideate.untitledChat") : item.title);

  const fail = useCallback((cause: unknown) => setError(errorText(t, cause)), [t]);

  useEffect(() => {
    let active = true;
    setChats(null);
    ideateApi.load(work.id)
      .then((result) => {
        if (!active) return;
        setChats(result.chats);
        setActiveChatId(result.activeChatId);
        setProposals(result.proposals);
      })
      .catch((cause) => {
        if (!active) return;
        setChats([]);
        fail(cause);
      });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [pending?.text, chat?.messages.length, proposals.length]);

  const patchChat = useCallback((chatId: string, change: (current: Chat) => Chat) => {
    setChats((current) => current?.map((item) => (item.id === chatId ? change(item) : item)) ?? current);
  }, []);

  async function send(text: string, retryOf = "") {
    const content = text.trim();
    if (!content || !chat || streaming || drafting) return;
    const chatId = chat.id;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setInput("");
    setPending({ chatId, userText: retryOf ? "" : content, userMessageId: retryOf, text: "", state: "streaming", error: "" });
    const now = new Date().toISOString();
    let userMessageId = "";
    let received = "";
    try {
      await streamMessage(work.id, chatId, content, {
        onMeta: (meta) => {
          userMessageId = meta.userMessageId;
          patchChat(chatId, (current) => ({
            ...current,
            title: meta.chatTitle,
            untitled: false,
            messages: current.messages.some((message) => message.id === meta.userMessageId)
              ? current.messages
              : [...current.messages, { id: meta.userMessageId, role: "user", content, status: "complete", createdAt: now }]
          }));
          setPending((current) => (current ? { ...current, userText: "" } : current));
        },
        onDelta: (delta) => {
          received += delta;
          setPending((current) => (current ? { ...current, text: current.text + delta } : current));
        },
        onDone: (message) => {
          patchChat(chatId, (current) => ({ ...current, messages: [...current.messages, message] }));
          setPending(null);
        }
      }, controller.signal, retryOf);
    } catch (cause) {
      const failure = cause instanceof StreamError ? cause : null;
      // What had arrived before the reply was cut short is already saved by the server.
      const partial: ChatMessage | null = failure?.partial ?? null;
      if (partial) patchChat(chatId, (current) => ({ ...current, messages: [...current.messages, partial] }));
      if (failure?.stopped) {
        // Keep what was written before the writer pressed Stop (the server keeps it too).
        if (!partial && received) {
          const kept: ChatMessage = { id: `stopped-${Date.now()}`, role: "assistant", content: received, status: "interrupted", createdAt: now };
          patchChat(chatId, (current) => ({ ...current, messages: [...current.messages, kept] }));
        }
        setPending(null);
      } else {
        setPending({ chatId, userText: userMessageId ? "" : content, userMessageId, text: "", state: "failed", error: errorText(t, cause) });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  function retry() {
    if (!chat || !pending) return;
    // A message the server already saved is answered again, not sent twice.
    const saved = pending.userMessageId ? chat.messages.find((message) => message.id === pending.userMessageId) : null;
    const text = saved?.content || pending.userText;
    setPending(null);
    void send(text, saved?.id ?? "");
  }

  async function newChat() {
    if (streaming) return;
    try {
      const { chat: created } = await ideateApi.createChat(work.id);
      setChats((current) => [created, ...(current ?? [])]);
      setActiveChatId(created.id);
      setPending(null);
    } catch (cause) {
      fail(cause);
    }
  }

  function openChat(chatId: string) {
    if (streaming || chatId === chat?.id) return;
    setActiveChatId(chatId);
    setPending(null);
    setRenaming(null);
    // Remember the choice for next time; the conversation is already on screen.
    ideateApi.touchChat(work.id, chatId).catch(fail);
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    try {
      const { chat: updated } = await ideateApi.touchChat(work.id, renaming.id, renaming.title);
      patchChat(updated.id, (current) => ({ ...current, title: updated.title, untitled: updated.untitled }));
      setRenaming(null);
    } catch (cause) {
      fail(cause);
    }
  }

  async function deleteChat(chatId: string) {
    if (streaming || !window.confirm(t("ideate.deleteConfirm"))) return;
    try {
      const result = await ideateApi.deleteChat(work.id, chatId);
      setChats(result.chats);
      setActiveChatId(result.activeChatId);
      setPending(null);
    } catch (cause) {
      fail(cause);
    }
  }

  async function draft(type: ArtifactType) {
    if (!chat || drafting) return;
    setDrafting(type);
    setError("");
    try {
      const { proposal } = await ideateApi.draft(work.id, chat.id, type, chat.messages.at(-1)?.id ?? "");
      setProposals((current) => [proposal, ...current]);
    } catch (cause) {
      fail(cause);
    } finally {
      setDrafting(null);
    }
  }

  async function settle(proposalId: string, action: () => Promise<{ proposal: Proposal; storyBible?: StoryMaterial }>) {
    setBusyProposal(proposalId);
    setError("");
    try {
      const result = await action();
      setProposals((current) => current.map((item) => (item.id === proposalId ? result.proposal : item)));
      if (result.storyBible) setMaterial(result.storyBible);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusyProposal("");
    }
  }

  const chatProposals = useMemo(
    () => (chat ? proposals.filter((item) => item.chatId === chat.id).slice().reverse() : []),
    [proposals, chat]
  );
  // A draft sits under the message it followed. Without a known message, it
  // goes under the last message written before it, or first in an empty chat.
  const { draftsByMessage, leadingDrafts } = useMemo(() => {
    const byMessage = new Map<string, Proposal[]>();
    const leading: Proposal[] = [];
    const messages = chat?.messages ?? [];
    for (const item of chatProposals) {
      const anchor = messages.find((message) => message.id === item.sourceMessageId)
        ?? messages.filter((message) => message.createdAt <= item.createdAt).at(-1);
      if (anchor) byMessage.set(anchor.id, [...(byMessage.get(anchor.id) ?? []), item]);
      else leading.push(item);
    }
    return { draftsByMessage: byMessage, leadingDrafts: leading };
  }, [chatProposals, chat]);
  const proposalsAfter = (messageId: string) => draftsByMessage.get(messageId) ?? [];
  const looseProposals = leadingDrafts;

  const renderDraft = (proposal: Proposal) => (
    <DraftCard
      key={proposal.id}
      proposal={proposal}
      storyLanguage={work.language}
      busy={busyProposal === proposal.id}
      onKeep={(keys) => void settle(proposal.id, () => ideateApi.keep(work.id, proposal.id, keys))}
      onUndo={() => void settle(proposal.id, () => ideateApi.undo(work.id, proposal.id))}
      onDiscard={() => void settle(proposal.id, () => ideateApi.discard(work.id, proposal.id))}
    />
  );

  const showPending = pending && pending.chatId === chat?.id;
  const isEmpty = chat && chat.messages.length === 0 && chatProposals.length === 0 && !showPending;

  return (
    <div className="ideate" data-testid="ideate">
      <section className="ideate-talk" aria-label={t("nav.ideate")}>
        <header>
          <div className="caps">{t("ideate.part")}</div>
          <h1 className="display page-title">{t("nav.ideate")}</h1>
          <p className="page-subtitle muted">{t("ideate.subtitle")}</p>
        </header>
        <hr className="rule2" />

        <div className="conversation" data-testid="conversation" aria-live="polite">
          {chats === null ? <p className="muted">{t("app.loading")}</p> : null}
          {isEmpty ? <p className="muted conversation-empty" data-testid="chat-empty">{t("ideate.empty")}</p> : null}
          {looseProposals.map(renderDraft)}
          {chat?.messages.map((message) => (
            <div key={message.id} className="turn-group">
              <div className={`turn turn-${message.role}`} data-testid="chat-message" data-role={message.role} data-status={message.status}>
                <div className="caps">{message.role === "user" ? t("ideate.you") : t("ideate.editor")}</div>
                <div className={message.role === "user" ? "card turn-body" : "turn-body"} lang={work.language} data-testid="chat-message-body">
                  {message.content}
                </div>
                {message.status === "interrupted" ? <div className="muted turn-note">{t("ideate.interrupted")}</div> : null}
              </div>
              {proposalsAfter(message.id).map(renderDraft)}
            </div>
          ))}
          {showPending && pending.userText ? (
            <div className="turn turn-user" data-testid="chat-message" data-role="user" data-status="sending">
              <div className="caps">{t("ideate.you")}</div>
              <div className="card turn-body" lang={work.language}>{pending.userText}</div>
            </div>
          ) : null}
          {showPending && pending.state === "streaming" ? (
            <div className="turn turn-assistant" data-testid="chat-streaming">
              <div className="caps">{t("ideate.editor")}</div>
              <div className="turn-body" lang={work.language}>{pending.text || <span className="muted">{t("ideate.thinking")}</span>}</div>
            </div>
          ) : null}
          {showPending && pending.state === "failed" ? (
            <div className="notice chat-failure" role="alert" data-testid="chat-failure">
              <span>{pending.error}</span>
              <button type="button" className="btn" onClick={retry} data-testid="chat-retry">{t("ideate.retry")}</button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={submit} data-testid="chat-composer">
          <label htmlFor="say" className="caps">{t("ideate.composerLabel")}</label>
          <textarea
            id="say"
            className="field composer-input"
            rows={2}
            maxLength={20000}
            value={input}
            placeholder={t("ideate.composerPlaceholder")}
            lang={work.language}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={composerKey}
            data-testid="chat-input"
          />
          <div className="composer-actions">
            {streaming ? (
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()} data-testid="chat-stop">{t("ideate.stop")}</button>
            ) : (
              <button type="submit" className="btn primary" disabled={!input.trim() || !chat || drafting !== null} data-testid="chat-send">{t("ideate.send")}</button>
            )}
          </div>
        </form>
        {error ? <p className="notice" role="alert" data-testid="ideate-error">{error}</p> : null}
      </section>

      <aside className="ideate-side" aria-label={t("ideate.storySoFar")}>
        <div className="caps">{t("ideate.storySoFar")}</div>
        <div className="premise" lang={work.language} data-testid="story-premise">
          {work.premise || <span className="muted">{t("ideate.noPremise")}</span>}
        </div>
        <hr className="rule" />

        <div className="side-block">
          <div className="caps">{t("ideate.material")}</div>
          {ARTIFACT_TYPES.map((type) => {
            const filled = ARTIFACT_FIELDS[type].filter((key) => material[key]);
            return (
              <div className="material" key={type} data-testid="material" data-type={type} data-filled={filled.length}>
                <div className="material-head">
                  <div>
                    <div className="material-name">{t(`artifact.types.${type}`)}</div>
                    <div className="muted material-state">
                      {filled.length ? t("ideate.materialParts", { count: filled.length }) : t("ideate.materialEmpty")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={!chat || drafting !== null || streaming}
                    onClick={() => void draft(type)}
                    data-testid={`draft-${type}`}
                  >
                    {drafting === type ? t("ideate.drafting") : t("ideate.draftWithAi")}
                  </button>
                </div>
                {filled.length ? (
                  <details className="material-details">
                    <summary>{t(`artifact.types.${type}`)}</summary>
                    {filled.map((key) => (
                      <div key={key} className="material-field">
                        <div className="caps">{t(`artifact.fields.${key}`)}</div>
                        <div lang={work.language}>{material[key]}</div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
        <hr className="rule" />

        <div className="side-block">
          <div className="side-block-head">
            <div className="caps">{t("ideate.conversations")}</div>
            <button type="button" className="btn" disabled={streaming} onClick={() => void newChat()} data-testid="chat-new">{t("ideate.newChat")}</button>
          </div>
          <ul className="chat-list" data-testid="chat-list">
            {chats?.map((item) => (
              <li key={item.id} className={item.id === chat?.id ? "chat-row on" : "chat-row"} data-testid="chat-row" data-active={item.id === chat?.id}>
                {renaming?.id === item.id ? (
                  <form className="chat-rename" onSubmit={saveRename}>
                    <label className="visually-hidden" htmlFor={`rename-${item.id}`}>{t("ideate.renameLabel")}</label>
                    <input
                      id={`rename-${item.id}`}
                      className="field"
                      maxLength={36}
                      value={renaming.title}
                      onChange={(event) => setRenaming({ id: item.id, title: event.target.value })}
                      autoFocus
                      data-testid="chat-rename-input"
                    />
                    <button type="submit" className="btn" data-testid="chat-rename-save">{t("ideate.save")}</button>
                    <button type="button" className="btn quiet" onClick={() => setRenaming(null)}>{t("ideate.cancel")}</button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="chat-open"
                      aria-current={item.id === chat?.id ? "true" : undefined}
                      disabled={streaming}
                      onClick={() => openChat(item.id)}
                      data-testid="chat-open"
                    >
                      {chatTitle(item)}
                    </button>
                    <button type="button" className="btn quiet chat-tool" onClick={() => setRenaming({ id: item.id, title: item.untitled ? "" : item.title })} data-testid="chat-rename">{t("ideate.rename")}</button>
                    <button type="button" className="btn quiet chat-tool" disabled={streaming} onClick={() => void deleteChat(item.id)} data-testid="chat-delete">{t("ideate.delete")}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
