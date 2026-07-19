import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThumbsUp, X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { Member, MatchRequest } from "../../types";

// 저장 텍스트는 언급을 "@닉네임" 마커로 담는다(내부 표식일 뿐 화면엔 @가 안 보인다) — 문장
// 안에 인라인 유저 칩으로 넣는 구조. 목록 카드에서 그 마커를 찾아 인라인 칩으로 렌더한다.
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

// 텍스트 인풋 안에서 "@닉네임"으로 실제 지목된 회원 id들을 뽑아낸다 — 칩 대신 일반
// 텍스트 인풋을 쓰므로(요청: "텍스트 에어리어를 일반 텍스트 인풋으로"), 지목은 DOM
// 칩이 아니라 제출 시점에 텍스트에서 알려진 닉네임을 찾아 해석한다. 긴 닉네임부터
// 매칭해 짧은 닉네임이 긴 닉네임의 일부로 잘못 걸리는 걸 피한다.
function extractMentionIds(text: string, members: Member[]): string[] {
  const ids: string[] = [];
  const sorted = [...members].sort((a, b) => b.nickname.length - a.nickname.length);
  for (const m of sorted) {
    if (!m.nickname || ids.includes(m.id)) continue;
    const esc = m.nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${esc}(?![^\\s@])`);
    if (re.test(text)) ids.push(m.id);
  }
  return ids;
}

const MESSAGE_MAX_LENGTH = 30;

export default function MatchRequestCorner() {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);
  const isAdmin = !!user?.roles?.includes("0202");

  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: MatchRequest[]; total: number; hasMore: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mentionedIds = useMemo(() => new Set(extractMentionIds(text, members)), [text, members]);
  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      .filter((m) => m.id !== user?.id && !mentionedIds.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .slice(0, 50);
  }, [members, user?.id, mentionQuery, mentionedIds]);

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

  // 커서 앞 텍스트에서 "@쿼리"를 잡아 드롭다운을 띄운다(없으면 닫는다).
  const detectMention = (value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    // @ 없이도 트리거(요청: "멘션없이 입력") — 커서 앞 마지막 단어로 후보를 띄운다. @를 앞에
    // 붙여도 그대로 동작한다. 단어가 비면(스페이스 직후 등) 후보를 닫는다.
    const m = before.match(/@?([^\s@]+)$/);
    setMentionQuery(m ? m[1] : null);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setText(v);
    detectMention(v, e.target.selectionStart ?? v.length);
  };

  // 후보를 고르면 커서 앞의 "@쿼리"를 지우고 그 자리에 "@닉네임 "을 채워 넣는다.
  const insertMention = (member: Member) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const mm = before.match(/@?([^\s@]*)$/);
    const removeLen = mm ? mm[0].length : 0;
    const newBefore = before.slice(0, before.length - removeLen);
    const insertion = `@${member.nickname} `;
    const newText = (newBefore + insertion + after).slice(0, MESSAGE_MAX_LENGTH);
    setText(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = Math.min(newBefore.length + insertion.length, newText.length);
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null && candidates.length > 0 && e.key === "Enter") {
      e.preventDefault();
      insertMention(candidates[0]);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  };

  const isEmpty = text.trim() === "";
  const canSubmit = text.trim().length > 0 && !submitting;

  const resetCompose = () => {
    setText("");
    setMentionQuery(null);
    setSubmitErr(null);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setSubmitErr("요청 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const ids = extractMentionIds(trimmed, members);
      await api.createMatchRequest({ text: trimmed, targetMemberIds: ids });
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

  // 대결이 성사되면 작성자/운영자가 "성사됨"으로 완료 처리 — 목록에서 사라진다.
  const complete = async (req: MatchRequest) => {
    setBusyId(req.id);
    try {
      await api.completeMatchRequest(req.id);
      await load(page);
    } catch { /* 무시 */ } finally { setBusyId(null); }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 5));

  return (
    <Fragment>
      {/* 소제목은 카드 밖으로(요청) — 카드 안에는 입력폼과 목록만 남는다. */}
      <h2 className="scr-v2-subheading">요청 목록</h2>
      <section className="scr-mreq-corner">
        <div className="scr-mreq-compose">
          {/* 인풋과 확인 버튼을 한 줄에, 높이도 맞춘다(요청) — 지우기는 별도 버튼 대신
              인풋 안의 X 버튼으로(요청). */}
          <div className="scr-mreq-compose-row">
            <div className="scr-mreq-input-wrap">
              <input
                ref={inputRef}
                type="text"
                className={cx("scr-input scr-mreq-editor", isEmpty && "scr-mreq-editor-empty")}
                value={text}
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder="보고 싶은 대결을 요청해보세요."
                onChange={onInputChange}
                onKeyUp={(e) => detectMention(text, (e.target as HTMLInputElement).selectionStart ?? text.length)}
                onKeyDown={onInputKeyDown}
                autoComplete="off"
              />
              {!isEmpty && (
                <button type="button" className="scr-mreq-clear-btn" onClick={resetCompose} aria-label="지우기">
                  <X size={14} />
                </button>
              )}
              {mentionQuery !== null && candidates.length > 0 && (
                <div className="scr-mreq-mention-drop">
                  {candidates.map((m) => (
                    <button key={m.id} type="button" className="scr-mreq-mention-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(m)}>
                      <Avatar member={m} size={22} />
                      <span className="scr-mreq-mention-name">{m.nickname}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid scr-mreq-confirm-btn" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Spinner size={14} /> : "확인"}
            </button>
          </div>
          {submitErr && <div className="scr-err">{submitErr}</div>}
        </div>

      {loading ? (
        <div className="scr-empty"><Spinner size={16} /></div>
      ) : err ? (
        <div className="scr-err">{err}</div>
      ) : items.length === 0 ? (
        <div className="scr-mreq-empty">요청 없음</div>
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
                {(req.mine || isAdmin) && (
                  <button type="button" className="scr-btn scr-btn-sm scr-btn-primary scr-btn-primary-solid scr-mreq-take-btn" onClick={() => void complete(req)} disabled={busyId === req.id}>
                    성사됨
                  </button>
                )}
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
    </Fragment>
  );
}
