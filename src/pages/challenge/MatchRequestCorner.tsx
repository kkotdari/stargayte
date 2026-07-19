import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThumbsUp } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { Member, MatchRequest } from "../../types";

interface MatchRequestCornerProps {
  onFulfill: (request: MatchRequest) => void;
  reloadSignal: number;
}

// 저장 텍스트는 지목을 "@닉네임" 마커로 담는다 — 화면에선 @ 없이 칩으로 보여준다(요청: "칩에는
// @ 없이 표현"). 목록 카드에서 본문의 그 마커를 찾아 인라인 칩으로 렌더한다.
function renderInline(text: string, targets: { nickname: string }[]) {
  const names = targets.map((t) => t.nickname).filter(Boolean);
  if (names.length === 0) return text;
  const esc = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${esc.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    out.push(<span key={`c${m.index}`} className="scr-mreq-chip scr-mreq-chip-inline">{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  return out;
}

export default function MatchRequestCorner({ onFulfill, reloadSignal }: MatchRequestCornerProps) {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: MatchRequest[]; total: number; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [composing, setComposing] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 에디터(contenteditable)는 비제어 — 내용은 DOM이 진실이고, 여기엔 검증/후보용 파생값만 둔다.
  const [content, setContent] = useState<{ text: string; ids: string[] }>({ text: "", ids: [] });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    const chosen = new Set(content.ids);
    return members
      .filter((m) => m.id !== user?.id && !chosen.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, user?.id, mentionQuery, content.ids]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.getMatchRequests(p);
      setData({ items: res.items, total: res.total, hasMore: res.hasMore });
    } catch {
      setErr("대결 요청을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [page, load]);
  useEffect(() => { if (reloadSignal > 0) void load(page); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // 에디터 DOM을 걸어 저장 텍스트("@닉네임" 마커 포함)와 지목 id 목록으로 직렬화한다.
  const readEditor = (): { text: string; ids: string[] } => {
    const el = editorRef.current;
    if (!el) return { text: "", ids: [] };
    const serialize = (node: Node): string => {
      let s = "";
      node.childNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) s += (n.textContent ?? "").replace(/ /g, " ");
        else if (n instanceof HTMLElement) {
          if (n.dataset.memberId) s += `@${n.dataset.nickname}`;
          else if (n.tagName === "BR") s += "\n";
          else s += serialize(n);
        }
      });
      return s;
    };
    const text = serialize(el);
    const ids: string[] = [];
    el.querySelectorAll<HTMLElement>("[data-member-id]").forEach((c) => {
      const id = c.dataset.memberId;
      if (id && !ids.includes(id)) ids.push(id);
    });
    return { text: text.trim(), ids };
  };

  // 커서 앞 텍스트에서 "@쿼리"를 잡아 드롭다운을 띄운다(없으면 닫는다).
  const detectMention = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setMentionQuery(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { setMentionQuery(null); return; }
    const before = (node.textContent ?? "").slice(0, range.startOffset);
    const m = before.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  };

  const syncAfterEdit = () => { setContent(readEditor()); detectMention(); };

  const makeChip = (member: Member): HTMLElement => {
    const chip = document.createElement("span");
    chip.className = "scr-mreq-chip scr-mreq-chip-inline scr-mreq-chip-editable";
    chip.contentEditable = "false";
    chip.dataset.memberId = member.id;
    chip.dataset.nickname = member.nickname;
    chip.textContent = member.nickname;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "scr-mreq-chip-x";
    x.dataset.chipRemove = "1";
    x.textContent = "×";
    chip.appendChild(x);
    return chip;
  };

  // 후보를 고르면 커서 앞의 "@쿼리"를 지우고 그 자리에 인라인 칩을 끼운다(요청: "칩이 문장 안에").
  const insertChip = (member: Member) => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el) return;
    const chip = makeChip(member);
    const space = document.createTextNode(" ");
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const before = (node.textContent ?? "").slice(0, range.startOffset);
        const mm = before.match(/@([^\s@]*)$/);
        const removeLen = mm ? mm[0].length : 0;
        const del = document.createRange();
        del.setStart(node, range.startOffset - removeLen);
        del.setEnd(node, range.startOffset);
        del.deleteContents();
        del.insertNode(chip);
        chip.after(space);
      } else {
        range.insertNode(chip);
        chip.after(space);
      }
    } else {
      el.appendChild(chip);
      el.appendChild(space);
    }
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    setMentionQuery(null);
    el.focus();
    setContent(readEditor());
  };

  // 칩의 × 클릭 — 칩과 뒤따르는 공백을 지운다.
  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-chip-remove]")) {
      e.preventDefault();
      const chip = t.closest(".scr-mreq-chip-editable");
      const next = chip?.nextSibling;
      chip?.remove();
      if (next && next.nodeType === Node.TEXT_NODE && next.textContent === " ") next.remove();
      setContent(readEditor());
      editorRef.current?.focus();
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && candidates.length > 0 && e.key === "Enter") {
      e.preventDefault();
      insertChip(candidates[0]);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  };

  const isEmpty = content.text.trim() === "" && content.ids.length === 0;
  const canSubmit = content.ids.length >= 2 && content.text.trim().length > 0 && !submitting;

  const resetCompose = () => {
    if (editorRef.current) editorRef.current.innerHTML = "";
    setContent({ text: "", ids: [] });
    setMentionQuery(null);
    setSubmitErr(null);
    setComposing(false);
  };

  const submit = async () => {
    const { text, ids } = readEditor();
    if (ids.length < 2) {
      setSubmitErr("@로 서로 대결했으면 하는 사람을 두 명 이상 골라주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      await api.createMatchRequest({ text, targetMemberIds: ids });
      resetCompose();
      setPage(0);
      await load(0);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "요청을 올리지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRecommend = async (req: MatchRequest) => {
    setBusyId(req.id);
    try {
      const updated = await api.toggleMatchRequestRecommend(req.id);
      setData((d) => d && { ...d, items: d.items.map((it) => (it.id === req.id ? updated : it)) });
    } catch { /* 무시 */ } finally { setBusyId(null); }
  };

  const removeOwn = async (req: MatchRequest) => {
    setBusyId(req.id);
    try {
      await api.deleteMatchRequest(req.id);
      await load(page);
    } catch { /* 무시 */ } finally { setBusyId(null); }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 5));

  return (
    <section className="scr-mreq-corner">
      <div className="scr-mreq-head">
        <h2 className="scr-mreq-title"><span className="scr-mreq-title-emoji" aria-hidden>⚔️</span> 대결 요청</h2>
        {!composing && (
          <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid" onClick={() => setComposing(true)}>
            + 요청 올리기
          </button>
        )}
      </div>

      {composing && (
        <div className="scr-mreq-compose">
          <div className="scr-mreq-input-wrap">
            <div
              ref={editorRef}
              className={cx("scr-input scr-mreq-editor", isEmpty && "scr-mreq-editor-empty")}
              contentEditable
              role="textbox"
              aria-multiline="true"
              data-placeholder="@로 서로 대결했으면 하는 사람들을 골라 요청하세요 (최소 2명)"
              onInput={syncAfterEdit}
              onKeyUp={detectMention}
              onKeyDown={onEditorKeyDown}
              onClick={onEditorClick}
              suppressContentEditableWarning
            />
            {mentionQuery !== null && candidates.length > 0 && (
              <div className="scr-mreq-mention-drop">
                {candidates.map((m) => (
                  <button key={m.id} type="button" className="scr-mreq-mention-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => insertChip(m)}>
                    <Avatar member={m} size={22} />
                    <span className="scr-mreq-mention-name">{m.nickname}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {submitErr && <div className="scr-err">{submitErr}</div>}
          <div className="scr-mreq-compose-actions">
            <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm" onClick={resetCompose}>취소</button>
            <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Spinner size={14} /> : "요청 올리기"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="scr-empty"><Spinner size={16} /></div>
      ) : err ? (
        <div className="scr-err">{err}</div>
      ) : items.length === 0 ? (
        <div className="scr-mreq-empty">아직 올라온 대결 요청이 없어요. 첫 요청을 올려보세요! ✨</div>
      ) : (
        <ul className="scr-mreq-list">
          {items.map((req) => (
            <li key={req.id} className="scr-mreq-item">
              <div className="scr-mreq-item-main">
                <div className="scr-mreq-item-author">
                  <Avatar member={{ id: req.author.memberId, nickname: req.author.nickname, avatar: req.author.avatar }} size={24} />
                  <span className="scr-mreq-item-author-name">{req.author.nickname}</span>
                </div>
                <p className="scr-mreq-item-text">{renderInline(req.text, req.targets)}</p>
              </div>
              <div className="scr-mreq-item-actions">
                <button
                  type="button"
                  className={cx("scr-mreq-rec-btn", req.recommendedByMe && "scr-mreq-rec-btn-on")}
                  onClick={() => void toggleRecommend(req)}
                  disabled={busyId === req.id}
                  aria-pressed={req.recommendedByMe}
                >
                  <ThumbsUp size={14} /> {req.recommendCount}
                </button>
                {req.mine ? (
                  <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm scr-mreq-take-btn" onClick={() => void removeOwn(req)} disabled={busyId === req.id}>
                    내리기
                  </button>
                ) : req.iAmTarget ? (
                  <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid scr-mreq-take-btn" onClick={() => onFulfill(req)}>
                    들어주기
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > 5 && (
        <div className="scr-mreq-pager">
          <button type="button" className="scr-mreq-pager-btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>이전</button>
          <span className="scr-mreq-pager-info">{page + 1} / {totalPages}</span>
          <button type="button" className="scr-mreq-pager-btn" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
    </section>
  );
}
