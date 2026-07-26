import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, MessageCirclePlus, X, Pencil, Trash2 } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import type { Member, FeedComment, FeedTargetType } from "../../types";

// 게시판 댓글처럼 한 줄(요청: 한글 50자 제한). 입력부·목록 디자인은 "너 나와!"(MatchRequestCorner)
// 요청 입력의 CSS(scr-mreq-*)를 그대로 차용한다(요청: "기본 입력 테마로 사용").
const MESSAGE_MAX_LENGTH = 50;

// 댓글 입력·수정은 평문 한 줄 입력이다(요청: "유저칩이 아니라 텍스트 @닉네임으로").
// 칩 조각 DOM을 직접 다루던 방식은 백스페이스·캐럿·IME에서 버그가 잦아, 본문 문자열
// 하나만 들고 "@닉네임"을 그냥 텍스트로 둔다. 저장 포맷("@닉네임" 마커)은 그대로다.

// 활성 회원 닉네임을 긴 것부터 매칭해 "@닉네임" 토큰의 memberId를 뽑는다(읽기용
// renderInline과 동일한 규칙이라 표시/저장이 일치한다).
function extractMentionIds(text: string, members: Member[]): string[] {
  const active = members.filter((m) => m.status === "active" && m.nickname);
  const sorted = active.slice().sort((a, b) => b.nickname.length - a.nickname.length);
  if (sorted.length === 0) return [];
  const byName = new Map(sorted.map((m) => [m.nickname, m.id]));
  const esc = sorted.map((m) => m.nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${esc.join("|")})`, "g");
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = byName.get(m[1]);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

// 저장된 본문("@닉네임" 마커 포함)을 목록에서 렌더한다 — 언급은 칩이 아니라 굵은
// "@닉네임" 텍스트로(요청). 입력창과 똑같이 보인다.
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
    out.push(<span key={`c${m.index}`} className="scr-mreq-chip-inline">@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  return out;
}

// 댓글 입력/수정 공용 편집기 — "너 나와!" 요청 입력의 멘션 칩 편집기를 그대로 옮겼다.
function NoteComposer({
  members,
  initialText,
  submitting,
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
}: {
  members: Member[];
  initialText: string;
  submitting: boolean;
  onSubmit: (text: string, memberIds: string[]) => void;
  onCancel?: () => void;
  placeholder: string;
  submitLabel: React.ReactNode;
}) {
  // 본문 문자열 하나만 든다(평문). "@닉네임"은 그냥 텍스트라 백스페이스/캐럿/IME가 일반
  // 입력창처럼 정상 동작한다.
  const [text, setText] = useState(initialText);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      .filter((m) => m.status === "active")
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"))
      .slice(0, 50);
  }, [members, mentionQuery]);
  const mentionShown = mentionQuery !== null && candidates.length > 0;

  useEffect(() => { setHighlight(0); }, [candidates]);
  useEffect(() => {
    dropRef.current?.querySelector(".scr-pv-opt-active")?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  useLayoutEffect(() => {
    if (!mentionShown || !inputRef.current || !dropRef.current) return;
    return attachPopover(inputRef.current, dropRef.current, { matchAnchor: true });
  }, [mentionShown]);

  // 커서 바로 앞의 "@질의"(공백/@ 없는 부분)를 감지해 자동완성 드롭다운을 띄운다.
  const detectQuery = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const m = before.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v.length > MESSAGE_MAX_LENGTH) return;
    setText(v);
    detectQuery(v, e.target.selectionStart ?? v.length);
  };
  const onSelectCaret = () => {
    const el = inputRef.current;
    if (el) detectQuery(el.value, el.selectionStart ?? el.value.length);
  };
  // 자동완성 선택 — 커서 앞 "@질의"를 "@닉네임 "(평문)으로 바꾼다.
  const insertMention = (member: Member) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const m = before.match(/@([^\s@]*)$/);
    const start = m ? cursor - m[0].length : cursor;
    const token = `@${member.nickname} `;
    const next = text.slice(0, start) + token + after;
    if (next.length > MESSAGE_MAX_LENGTH) return;
    setText(next);
    setMentionQuery(null);
    const pos = start + token.length;
    requestAnimationFrame(() => {
      const e = inputRef.current;
      if (e) { e.focus(); e.setSelectionRange(pos, pos); }
    });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      if (mentionShown) { setMentionQuery(null); return; }
      onCancel?.();
      return;
    }
    if (!mentionShown) {
      if (e.key === "Enter") { e.preventDefault(); doSubmit(); }
      return;
    }
    // 자동완성이 떠 있을 때만 방향키/엔터/탭이 항목 선택으로 쓰인다(스페이스는 그냥 입력).
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % candidates.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + candidates.length) % candidates.length); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(candidates[Math.min(highlight, candidates.length - 1)]);
    }
  };

  const doSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    onSubmit(trimmed, extractMentionIds(trimmed, members));
  };

  const isEmpty = text === "";
  const canSubmit = text.trim().length > 0 && !submitting;

  const clear = () => {
    setText("");
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  return (
    <div className="scr-mreq-compose-row scr-match-note-compose-row">
      <div className="scr-mreq-input-wrap">
        <div
          className="scr-input scr-mreq-editor"
          onClick={() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }}
        >
          <input
            ref={inputRef}
            className="scr-mreq-live-input"
            value={text}
            onChange={onChange}
            onSelect={onSelectCaret}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
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
export default function FeedComments({ targetType, targetId }: { targetType: FeedTargetType; targetId: number }) {
  // 작성 입력창 — 가운데의 + 댓글 아이콘을 누르면 트랜지션으로 입력창으로 바뀌며 바로
  // 포커스되고, 포커스를 잃으면 다시 아이콘으로 돌아간다(요청). 입력창은 늘 마운트해 두고
  // CSS(max-width/opacity)로만 접었다 편다 — 닫혀도 쓰던 내용이 남는다.
  const [composerOpen, setComposerOpen] = useState(false);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  // 모바일(iOS)은 사용자 제스처(탭) 핸들러 "안에서" focus()가 불려야 키보드가 뜬다 —
  // rAF/이펙트로 미루면 데스크톱에선 되지만 모바일에선 키보드가 안 올라온다(지적).
  // 컴포저는 늘 마운트돼 있고(visibility 안 씀, max-width 0 접힘) 그 상태에서도 포커스가
  // 잡히므로, 아이콘 탭 즉시 동기로 포커스하고 상태를 연다.
  const openComposer = () => {
    composerWrapRef.current?.querySelector("input")?.focus();
    setComposerOpen(true);
  };
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);
  // 댓글은 이 컴포넌트가 로컬로 관리한다 — 마운트 시 대상의 댓글을 불러오고,
  // 작성/수정/삭제 시 서버가 돌려준 댓글로 그 자리만 갱신해 전체 목록을 다시 안 불러온다.
  const [notes, setNotes] = useState<FeedComment[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  // 새 메모를 남기면 작성 컴포저를 새로 마운트해 입력을 비운다(요청: 남긴 뒤 인풋창이 그대로
  // 있는 문제). 컴포저는 자기 입력 상태를 로컬로 들고 있어, 성공 시 이 key를 올려 초기화한다.
  const [composerKey, setComposerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeedComment | null>(null);

  // 부모가 목록을 다시 불러오면(경기 등록/삭제 등) 새 배열로 재동기화. 댓글 작성/수정/삭제는
  // 부모 리로드를 트리거하지 않아 이 효과가 로컬 편집을 덮어쓰지 않는다(같은 배열 참조 유지).
  useEffect(() => {
    let cancelled = false;
    api.listFeedComments(targetType, targetId)
      .then((items) => { if (!cancelled) setNotes(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [targetType, targetId]);

  const create = async (text: string, ids: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createFeedComment(targetType, targetId, text, ids);
      setNotes((prev) => [...prev, created]);
      setComposerKey((k) => k + 1); // 성공 시 작성 컴포저 초기화(입력 비우기)
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
      const updated = await api.updateFeedComment(id, text, ids);
      setNotes((prev) => prev.map((c) => (c.id === id ? updated : c)));
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
      await api.deleteFeedComment(id);
      setNotes((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "메모를 삭제하지 못했어요.");
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  return (
    // 로우 전체가 클릭 토글이라, 댓글 영역에서의 클릭/입력은 로우 접힘을 막는다.
    <div className="scr-match-notes" onClick={(e) => e.stopPropagation()}>
      {notes.length > 0 && (
        <ul className="scr-mreq-list scr-match-notes-list">
          {notes.map((c) => (
            <li key={c.id} className="scr-mreq-item scr-match-note-item">
              <div className="scr-mreq-item-top">
                <div className="scr-mreq-item-author">
                  <Avatar
                    member={{ id: c.author.memberId, nickname: c.author.nickname, avatar: c.author.avatar }}
                    size={13}
                    className="scr-mreq-item-author-avatar"
                  />
                  <span className="scr-mreq-item-author-name">{c.author.nickname}</span>
                  <span className="scr-match-note-time">{formatCommentTime(c.createdAt)}</span>
                </div>
                {c.canEdit && editingId !== c.id && (
                  <div className="scr-mreq-item-actions">
                    <button
                      type="button" className="scr-match-note-icon-btn"
                      onClick={() => { setErr(null); setEditingId(c.id); }}
                      aria-label="수정"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button" className="scr-match-note-icon-btn scr-match-note-icon-danger"
                      onClick={() => setDeleteTarget(c)}
                      aria-label="삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {editingId === c.id ? (
                <NoteComposer
                  members={members}
                  initialText={c.text}
                  submitting={busy}
                  onSubmit={(text, ids) => void update(c.id, text, ids)}
                  onCancel={() => setEditingId(null)}
                  placeholder="메모 수정"
                  submitLabel={<CornerDownLeft size={14} />}
                />
              ) : (
                <p className="scr-mreq-item-text scr-match-note-text">{renderInline(c.text, c.mentions)}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {err && <div className="scr-err scr-match-note-err">{err}</div>}

      {user && editingId === null && (
        <div className={cx("scr-feed-comment-row", composerOpen && "scr-feed-comment-row-open")}>
          <button
            type="button" className="scr-feed-comments-toggle"
            onClick={openComposer}
            aria-expanded={composerOpen} aria-label="댓글 쓰기" title="댓글 쓰기"
            tabIndex={composerOpen ? -1 : 0}
          >
            <MessageCirclePlus size={15} aria-hidden />
          </button>
          <div
            ref={composerWrapRef}
            className="scr-feed-comment-composer"
            // 포커스가 입력창/등록 버튼 밖으로 나가면 아이콘으로 되돌린다(요청). 멘션
            // 드롭다운·지우기 버튼은 mousedown preventDefault라 블러 자체가 안 난다.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComposerOpen(false);
            }}
          >
            <NoteComposer
              key={composerKey}
              members={members}
              initialText=""
              submitting={busy}
              onSubmit={(text, ids) => void create(text, ids)}
              placeholder="댓글 남기기 (@로 유저 태그)"
              submitLabel={<CornerDownLeft size={14} />}
            />
          </div>
        </div>
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
