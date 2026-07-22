import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, X, Pencil, Trash2 } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import type { Member, Match, MatchComment } from "../../types";

// 게시판 댓글처럼 한 줄(요청: 한글 50자 제한). 입력부·목록 디자인은 "너 나와!"(MatchRequestCorner)
// 요청 입력의 CSS(scr-mreq-*)를 그대로 차용한다(요청: "기본 입력 테마로 사용").
const MESSAGE_MAX_LENGTH = 50;

// 편집창은 "너 나와!" 요청 입력과 동일한 구조 — 확정된 평문/칩 조각은 실제 DOM으로 굳고,
// 지금 타이핑 중인 마지막 조각만 진짜 <input> 하나가 담당한다(IME 유령글자/캐럿 밀림 없음).
type MessagePart =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; nickname: string };

// 확정 조각들 + 지금 타이핑 중인 조각을 합쳐 실제 저장되는 "@닉네임" 마커 문자열로 만든다.
function partsToText(parts: MessagePart[], liveText: string): string {
  return parts.map((p) => (p.type === "text" ? p.value : `@${p.nickname}`)).join("") + liveText;
}

// 저장된 본문("@닉네임" 마커 포함)을 목록에서 인라인 유저 칩으로 렌더한다("너 나와!"와 동일).
function renderInline(text: string, mentions: { nickname: string }[]) {
  const names = mentions.map((t) => t.nickname).filter(Boolean);
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

// 수정 시작 시 기존 본문("@닉네임" 마커 + mentions)을 편집 조각(MessagePart[])으로 되돌린다.
function textToParts(text: string, mentions: { memberId: string; nickname: string }[]): MessagePart[] {
  const byName = new Map(mentions.map((m) => [m.nickname, m.memberId]));
  const names = mentions.map((m) => m.nickname).filter(Boolean);
  if (names.length === 0) return text ? [{ type: "text", value: text }] : [];
  const esc = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${esc.join("|")})`, "g");
  const parts: MessagePart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "mention", id: byName.get(m[1]) ?? "", nickname: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

// 댓글 입력/수정 공용 편집기 — "너 나와!" 요청 입력의 멘션 칩 편집기를 그대로 옮겼다.
function CommentComposer({
  members,
  initialParts,
  submitting,
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
}: {
  members: Member[];
  initialParts: MessagePart[];
  submitting: boolean;
  onSubmit: (text: string, memberIds: string[]) => void;
  onCancel?: () => void;
  placeholder: string;
  submitLabel: React.ReactNode;
}) {
  const [committedParts, setCommittedParts] = useState<MessagePart[]>(initialParts);
  const [liveText, setLiveText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const mentionedIds = useMemo(
    () => new Set(committedParts.filter((p): p is Extract<MessagePart, { type: "mention" }> => p.type === "mention").map((p) => p.id)),
    [committedParts],
  );
  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      .filter((m) => m.status === "active" && !mentionedIds.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"))
      .slice(0, 50);
  }, [members, mentionQuery, mentionedIds]);
  const mentionShown = mentionQuery !== null && candidates.length > 0;

  useEffect(() => { setHighlight(0); }, [candidates]);
  useEffect(() => {
    dropRef.current?.querySelector(".scr-pv-opt-active")?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  useLayoutEffect(() => {
    if (!mentionShown || !inputRef.current || !dropRef.current) return;
    return attachPopover(inputRef.current, dropRef.current, { matchAnchor: true });
  }, [mentionShown]);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [committedParts, liveText]);

  const detectQuery = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const m = before.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  };
  const onLiveTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (partsToText(committedParts, raw).length > MESSAGE_MAX_LENGTH) return;
    setLiveText(raw);
    detectQuery(raw, e.target.selectionStart ?? raw.length);
  };
  const onLiveTextSelect = () => {
    const el = inputRef.current;
    if (!el) return;
    detectQuery(el.value, el.selectionStart ?? el.value.length);
  };
  const insertMention = (member: Member) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? liveText.length;
    const before = liveText.slice(0, cursor);
    const after = liveText.slice(cursor);
    const m = before.match(/@([^\s@]*)$/);
    const removeLen = m ? m[0].length : 0;
    const beforeQuery = before.slice(0, before.length - removeLen);
    const newParts: MessagePart[] = [...committedParts];
    if (beforeQuery) newParts.push({ type: "text", value: beforeQuery });
    newParts.push({ type: "mention", id: member.id, nickname: member.nickname });
    if (partsToText(newParts, after).length > MESSAGE_MAX_LENGTH) return;
    setCommittedParts(newParts);
    setLiveText(after);
    setMentionQuery(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const onLiveTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      if (mentionShown) { setMentionQuery(null); return; }
      onCancel?.();
      return;
    }
    if (e.key === "Backspace" && liveText === "" && committedParts.length > 0) {
      e.preventDefault();
      setCommittedParts((prev) => prev.slice(0, -1));
      return;
    }
    if (!mentionShown) {
      // 멘션 자동완성이 안 떠 있으면 엔터로 바로 제출한다(대댓글 없는 단순 댓글).
      if (e.key === "Enter") { e.preventDefault(); doSubmit(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % candidates.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + candidates.length) % candidates.length); }
    else if (e.key === "Enter" || e.key === " " || e.key === "Tab") {
      e.preventDefault();
      insertMention(candidates[Math.min(highlight, candidates.length - 1)]);
    }
  };

  const doSubmit = () => {
    const trimmed = partsToText(committedParts, liveText).trim();
    if (!trimmed || submitting) return;
    const ids = Array.from(mentionedIds);
    onSubmit(trimmed, ids);
  };

  const isEmpty = committedParts.length === 0 && liveText === "";
  const canSubmit = partsToText(committedParts, liveText).trim().length > 0 && !submitting;

  const clear = () => {
    setCommittedParts([]);
    setLiveText("");
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  return (
    <div className="scr-mreq-compose-row scr-match-comment-compose-row">
      <div className="scr-mreq-input-wrap">
        <div
          ref={boxRef}
          className="scr-input scr-mreq-editor"
          onClick={() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }}
        >
          {committedParts.map((part, i) =>
            part.type === "mention" ? (
              <span key={i} className="scr-mreq-chip scr-mreq-chip-editor">{part.nickname}</span>
            ) : (
              <span key={i} className="scr-mreq-text-part">{part.value}</span>
            ),
          )}
          <input
            ref={inputRef}
            className="scr-mreq-live-input"
            value={liveText}
            onChange={onLiveTextChange}
            onSelect={onLiveTextSelect}
            onKeyDown={onLiveTextKeyDown}
            placeholder={committedParts.length === 0 ? placeholder : ""}
            autoComplete="off"
          />
        </div>
        {!isEmpty && (
          <button
            type="button"
            className="scr-mreq-clear-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel ?? clear}
            aria-label={onCancel ? "취소" : "지우기"}
          >
            <X size={14} />
          </button>
        )}
        {mentionShown && createPortal(
          <div className="scr-pv-drop scr-scroll" ref={dropRef}>
            {candidates.map((m, i) => (
              <button
                key={m.id} type="button"
                className={cx("scr-pv-opt scr-mreq-mention-opt", i === highlight && "scr-pv-opt-active")}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(m)}
              >
                <Avatar member={m} size={22} />
                <span className="scr-mreq-mention-name">{m.nickname}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
      <button
        type="button"
        className="scr-btn scr-btn-primary scr-btn-primary-solid scr-mreq-submit-btn"
        disabled={!canSubmit}
        onClick={doSubmit}
        aria-label="메모 등록"
      >
        {submitting ? <Spinner size={14} /> : submitLabel}
      </button>
    </div>
  );
}

function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mi = `${d.getMinutes()}`.padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

// 펼쳐진 경기 로우 하단의 댓글(메모) 영역 — 게시판 댓글 스타일. 목록·입력은 "너 나와!" 요청
// 입력의 CSS(scr-mreq-*)를 차용한다. 대댓글은 없다(요청). 로그인 회원만 작성할 수 있고
// 작성자 본인/운영자만 수정·삭제할 수 있다(comment.canEdit).
export default function MatchComments({ match }: { match: Match }) {
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);
  // 댓글은 이 컴포넌트가 로컬로 관리한다 — 목록 응답(match.comments)을 초기값으로 받고,
  // 작성/수정/삭제 시 서버가 돌려준 댓글로 그 자리만 갱신해 전체 목록을 다시 안 불러온다.
  const [comments, setComments] = useState<MatchComment[]>(match.comments ?? []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MatchComment | null>(null);

  // 부모가 목록을 다시 불러오면(경기 등록/삭제 등) 새 배열로 재동기화. 댓글 작성/수정/삭제는
  // 부모 리로드를 트리거하지 않아 이 효과가 로컬 편집을 덮어쓰지 않는다(같은 배열 참조 유지).
  useEffect(() => { setComments(match.comments ?? []); }, [match.comments]);

  const create = async (text: string, ids: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createMatchComment(match.id, text, ids);
      setComments((prev) => [...prev, created]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "메모를 남기지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const update = async (id: number, text: string, ids: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.updateMatchComment(match.id, id, text, ids);
      setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setEditingId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "메모를 수정하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteMatchComment(match.id, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "메모를 삭제하지 못했어요.");
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  return (
    // 로우 전체가 클릭 토글이라, 댓글 영역에서의 클릭/입력은 로우 접힘을 막는다.
    <div className="scr-match-comments" onClick={(e) => e.stopPropagation()}>
      {comments.length > 0 && (
        <ul className="scr-mreq-list scr-match-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="scr-mreq-item scr-match-comment-item">
              <div className="scr-mreq-item-top">
                <div className="scr-mreq-item-author">
                  <Avatar
                    member={{ id: c.author.memberId, nickname: c.author.nickname, avatar: c.author.avatar }}
                    size={18}
                    className="scr-mreq-item-author-avatar"
                  />
                  <span className="scr-mreq-item-author-name">{c.author.nickname}</span>
                  <span className="scr-match-comment-time">{formatCommentTime(c.createdAt)}</span>
                </div>
                {c.canEdit && editingId !== c.id && (
                  <div className="scr-mreq-item-actions">
                    <button
                      type="button" className="scr-match-comment-icon-btn"
                      onClick={() => { setErr(null); setEditingId(c.id); }}
                      aria-label="수정"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button" className="scr-match-comment-icon-btn scr-match-comment-icon-danger"
                      onClick={() => setDeleteTarget(c)}
                      aria-label="삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {editingId === c.id ? (
                <CommentComposer
                  members={members}
                  initialParts={textToParts(c.text, c.mentions)}
                  submitting={busy}
                  onSubmit={(text, ids) => void update(c.id, text, ids)}
                  onCancel={() => setEditingId(null)}
                  placeholder="메모 수정"
                  submitLabel={<CornerDownLeft size={14} />}
                />
              ) : (
                <p className="scr-mreq-item-text scr-match-comment-text">{renderInline(c.text, c.mentions)}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {err && <div className="scr-err scr-match-comment-err">{err}</div>}

      {user && editingId === null && (
        <CommentComposer
          members={members}
          initialParts={[]}
          submitting={busy}
          onSubmit={(text, ids) => void create(text, ids)}
          placeholder="메모 남기기 (@로 유저 태그)"
          submitLabel={<CornerDownLeft size={14} />}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="메모를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={busy ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          onConfirm={() => void remove(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
