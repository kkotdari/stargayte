import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ThumbsUp, X, MoreVertical } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import type { Member, MatchRequest } from "../../types";

// 추천 버튼 오른쪽 세로점세개(⋮) — 성사됨은 항목마다 상시 노출하기엔 너무 무거운
// 액션이라(요청: "성사됨 버튼은 안보이게 해주고 ... 케밥메뉴 ... 거기에 성사됨을
// 넣어줘") 케밥 메뉴 안으로 옮긴다. 작성자/운영자가 아니면 할 수 있는 액션이 아예
// 없으니 케밥 자체를 렌더링하지 않는다. 위치 계산/바깥 클릭 닫힘은 경기 목록의
// MatchActionsMenu와 같은 attachPopover 패턴을 그대로 따른다.
function RequestKebabMenu({ onComplete, busy }: { onComplete: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growToContent: true, maxWidth: 140 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div className="scr-mreq-kebab">
      <button
        type="button" ref={anchorRef}
        className="scr-match-memo-btn scr-mreq-kebab-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={busy}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div className="scr-menu-pop-drop scr-mreq-kebab-drop" ref={dropRef} role="menu">
          <button
            type="button" role="menuitem"
            className="scr-menu-pop-opt"
            onClick={(e) => { e.stopPropagation(); onComplete(); setOpen(false); }}
          >
            성사됨
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

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

const MESSAGE_MAX_LENGTH = 30;

// 편집창 내부 표현은 "@{닉네임}"으로 감싼 예약 구문을 쓴다(요청: "입력시 특수한 문자를
// 써서 정규식에 의해 해당 문자는 칩으로 보이게 하면 어때 ... ${} 이런걸로 예약어 많이
// 쓰잖아", "노션같은것도 보면 태그나 미니 코드 보여주는 것도 있고 그런거 활용해봐").
// contentEditable + execCommand로 진짜 DOM 칩 노드를 다루던 이전 방식은 브라우저마다
// 캐럿/선택/IME 처리가 미묘하게 달라 몇 번을 고쳐도 새로운 포커스/캐럿 버그가 계속
// 나왔다(실제로 지적받은 문제 — "아직도 오류가 많아 .. 칩 입력시 커서가 안보이고 그냥
// 입력해도 아무것도 안들어가", "근본적인 구조 변경이 필요해 보여"). 이제는 평범한
// <input>에 이 예약 구문을 포함한 순수 문자열을 그대로 담아 편집 자체(캐럿/선택/IME/
// 백스페이스)는 전부 브라우저 네이티브에 맡기고, 그 위에 읽기전용 오버레이를 겹쳐
// "@{...}" 구간만 칩처럼 그려 보여준다(아래 renderComposeSegments). 실제 캐럿 이동/
// 텍스트 삽입에 Range나 execCommand를 전혀 쓰지 않으니 구조적으로 그런 버그가 생길
// 수가 없다.
const MENTION_RE = /@\{([^{}]*)\}/g;

// "@{닉네임}"을 실제 저장 형식인 "@닉네임"으로 되돌린다 — 제출 시 백엔드로 보내는 값.
function stripMentionBraces(text: string): string {
  return text.replace(MENTION_RE, "@$1");
}

// 지금 태그된 닉네임들 — 이미 태그된 사람을 자동완성 후보에서 빼는 데 쓴다.
function mentionedNicknames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) names.add(m[1]);
  return names;
}

// 편집창 오버레이용 세그먼트 — "@{닉네임}" 구간만 칩 스타일로, 나머지는 평문으로 그린다.
function renderComposeSegments(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const index = m.index ?? 0;
    if (index > last) out.push(<span key={`t${last}`}>{text.slice(last, index)}</span>);
    out.push(<span key={`c${index}`} className="scr-mreq-chip scr-mreq-chip-editor">{m[1]}</span>);
    last = index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  return out;
}

export default function MatchRequestCorner() {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);
  const isAdmin = !!user?.roles?.includes("0202");

  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: MatchRequest[]; total: number; hasMore: boolean; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState(""); // "@{닉네임}" 예약 구문 포함한 편집 중 원문
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mentionDropRef = useRef<HTMLDivElement>(null);
  // insertMention/Backspace 통합삭제처럼 text를 프로그램적으로 바꾼 다음, 그 리렌더
  // 직후에 캐럿을 특정 위치로 되돌려야 할 때 여기 적어둔다 — setSelectionRange는 진짜
  // <input> DOM API라 Range/execCommand보다 훨씬 안정적으로 동작한다.
  const pendingCursorRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCursorRef.current === null) return;
    const pos = pendingCursorRef.current;
    pendingCursorRef.current = null;
    inputRef.current?.setSelectionRange(pos, pos);
  }, [text]);

  // <input>은 내용이 넘치면 스크롤되는데, 오버레이(읽기전용 칩 렌더링)는 별도 엘리먼트라
  // 따로 맞춰줘야 겹쳐 보인다 — <input>은 scroll 이벤트를 안정적으로 안 쏘는 경우가 많아
  // 값/캐럿이 바뀌는 시점마다 직접 동기화한다.
  const syncOverlayScroll = () => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  useEffect(() => { syncOverlayScroll(); }, [text]);

  const mentionedIds = useMemo(() => {
    const names = mentionedNicknames(text);
    return new Set(members.filter((m) => names.has(m.nickname)).map((m) => m.id));
  }, [text, members]);
  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      // 활성 상태 회원만(요청) — 대기/정지/탈퇴 회원은 태그 대상에서 뺀다. 다른 상대
      // 선택 화면(ChallengeFormModal 등)과 같은 기준.
      .filter((m) => m.status === "active" && m.id !== user?.id && !mentionedIds.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      // 정렬 순서는 닉네임 순(요청).
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"))
      .slice(0, 50);
  }, [members, user?.id, mentionQuery, mentionedIds]);

  // 자동완성 드롭다운의 키보드 하이라이트 — 검색창(SearchFilterBar) 자동완성과 같은
  // 패턴(요청: "드롭다운에서 키보드로 위아래 이동 불가"). 후보 목록이 바뀌면 0번으로
  // 되돌린다.
  const [highlight, setHighlight] = useState(0);
  useEffect(() => { setHighlight(0); }, [candidates]);
  // 위/아래로 하이라이트를 옮길 때, 그 항목이 스크롤 밖에 있으면 보이게 자동 스크롤한다
  // (요청: "드롭다운에서 위아래 키 조작시 포커싱된 항목이 화면 밖에 있을때 자동
  // 스크롤이 되어야 보일듯"). block:"nearest"라 꼭 필요한 만큼만 움직이고, 이미 보이는
  // 항목이면 스크롤이 안 움직인다.
  useEffect(() => {
    mentionDropRef.current
      ?.querySelector(".scr-mreq-mention-opt-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.getMatchRequests(p);
      setData({ items: res.items, total: res.total, hasMore: res.hasMore, pageSize: res.pageSize });
    } catch {
      setErr("대결 요청을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [page, load]);

  // 캐럿 앞의 "@쿼리"를 찾는다 — 이미 확정된 "@{닉네임}" 블록 안은 건드리지 않도록 "{"/"}"는
  // 쿼리 문자에서 제외한다. "@"만 쳐도(쿼리 0글자) 감지되어 전체 후보가 뜬다(요청: "@ 치면
  // 모든 유저가 일단 뜨게 하자").
  const detectQuery = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const m = before.match(/@([^\s@{}]*)$/);
    setMentionQuery(m ? m[1] : null);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // 글자수 제한은 실제 저장되는 형태("@{닉네임}" → "@닉네임") 기준으로 잰다 — 태그
    // 괄호는 편집 중 기술적 표기일 뿐이라 사용자 글자수 예산에서 빼고 계산해야 공평하다.
    if (stripMentionBraces(raw).length > MESSAGE_MAX_LENGTH) return;
    setText(raw);
    detectQuery(raw, e.target.selectionStart ?? raw.length);
  };

  // 클릭이나 화살표로 캐럿만 옮겨도(타이핑 없이) "@단어" 위/끝이면 자동완성이 다시
  // 뜬다 — onSelect는 캐럿/선택이 바뀌는 모든 경우(클릭, 화살표, 붙여넣기 등)에
  // 공통으로 발생하는 네이티브 이벤트라 이거 하나로 충분하다.
  const onInputSelect = () => {
    const el = inputRef.current;
    if (!el) return;
    detectQuery(el.value, el.selectionStart ?? el.value.length);
    syncOverlayScroll();
  };

  // 후보를 고르면 캐럿 앞의 "@쿼리"를 "@{닉네임}"으로 바꿔치기한다 — 전부 문자열 슬라이싱과
  // 네이티브 input.setSelectionRange뿐이라(Range/execCommand 전혀 없음) 삽입 위치·캐럿
  // 이동이 항상 정확하다.
  const insertMention = (member: Member) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const m = before.match(/@([^\s@{}]*)$/);
    const removeLen = m ? m[0].length : 0;
    const newBefore = before.slice(0, before.length - removeLen);
    const insertion = `@{${member.nickname}}`;
    const newText = newBefore + insertion + after;
    if (stripMentionBraces(newText).length > MESSAGE_MAX_LENGTH) return;
    setText(newText);
    setMentionQuery(null);
    pendingCursorRef.current = newBefore.length + insertion.length;
    input?.focus();
  };

  const dropdownOpen = mentionQuery !== null;
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 백스페이스로 캐럿 바로 앞의 완성된 "@{닉네임}" 블록을 한 번에 지운다(요청: "지울
    // 때도 해당 문자 사이는 한번에 지워지게"). 드롭다운이 떠 있을 때(아직 쿼리 입력
    // 중)는 일반 글자 지우기가 우선이라 여긴 건드리지 않는다.
    if (e.key === "Backspace" && !dropdownOpen) {
      const input = e.currentTarget;
      if (input.selectionStart === input.selectionEnd && input.selectionStart !== null) {
        const cursor = input.selectionStart;
        const before = text.slice(0, cursor);
        const m = before.match(/@\{[^{}]*\}$/);
        if (m) {
          e.preventDefault();
          const cutFrom = cursor - m[0].length;
          setText(text.slice(0, cutFrom) + text.slice(cursor));
          pendingCursorRef.current = cutFrom;
          return;
        }
      }
    }
    if (dropdownOpen && e.key === "ArrowDown") {
      e.preventDefault();
      if (candidates.length > 0) setHighlight((h) => (h + 1) % candidates.length);
      return;
    }
    if (dropdownOpen && e.key === "ArrowUp") {
      e.preventDefault();
      if (candidates.length > 0) setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
      return;
    }
    if (dropdownOpen && (e.key === "Enter" || e.key === " " || e.key === "Tab")) {
      // 한글(IME) 조합 중 마지막 글자를 확정하며 동시에 누른 Enter는 브라우저가 "조합
      // 확정"과 "진짜 Enter" 두 번으로 나눠 발생시키는 경우가 있다(SearchFilterBar와
      // 동일한 현상). 그 첫 번째(가짜, isComposing) Enter만 건너뛴다 — Space/Tab은
      // 이런 이중발생이 없어 그대로 처리한다.
      if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
      e.preventDefault();
      if (candidates.length > 0) insertMention(candidates[Math.min(highlight, candidates.length - 1)]);
      return;
    }
    if (dropdownOpen && e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
      return;
    }
  };

  const isEmpty = text === "";
  const canSubmit = stripMentionBraces(text).trim().length > 0 && !submitting;

  const resetCompose = () => {
    setText("");
    setMentionQuery(null);
    setSubmitErr(null);
    inputRef.current?.focus();
  };

  const submit = async () => {
    const trimmed = stripMentionBraces(text).trim();
    if (!trimmed) {
      setSubmitErr("요청 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const byNickname = new Map(members.map((m) => [m.nickname, m.id]));
      const ids = Array.from(new Set(
        [...text.matchAll(MENTION_RE)]
          .map((m) => byNickname.get(m[1]))
          .filter((id): id is string => !!id),
      ));
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
  const pageSize = data?.pageSize ?? 3;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
              <div className="scr-mreq-editor-stack">
                {/* 실제 편집은 이 평범한 input이 전담 — 캐럿/선택/IME/백스페이스 전부
                    브라우저 네이티브 동작 그대로라 커스텀 Range/execCommand가 필요 없다.
                    글자 자체는 투명하게(caret-color만 살려서 커서는 보이게) 숨기고, 그
                    위에 겹친 읽기전용 오버레이가 "@{닉네임}" 구간만 칩으로 그려 보여준다. */}
                <input
                  ref={inputRef}
                  type="text"
                  className="scr-input scr-mreq-editor scr-mreq-editor-real"
                  value={text}
                  onChange={onInputChange}
                  onSelect={onInputSelect}
                  onKeyDown={onInputKeyDown}
                  placeholder="@로 유저 태그"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="scr-input scr-mreq-editor scr-mreq-editor-overlay" ref={overlayRef} aria-hidden="true">
                  {renderComposeSegments(text)}
                </div>
              </div>
              {!isEmpty && (
                <button
                  type="button"
                  className="scr-mreq-clear-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={resetCompose}
                  aria-label="지우기"
                >
                  <X size={14} />
                </button>
              )}
              {mentionQuery !== null && candidates.length > 0 && (
                <div className="scr-mreq-mention-drop" ref={mentionDropRef}>
                  {candidates.map((m, i) => (
                    <button
                      key={m.id} type="button"
                      className={cx("scr-mreq-mention-opt", i === highlight && "scr-mreq-mention-opt-active")}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertMention(m)}
                    >
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
              <div className="scr-mreq-item-top">
                <div className="scr-mreq-item-author">
                  <Avatar
                    member={{ id: req.author.memberId, nickname: req.author.nickname, avatar: req.author.avatar }}
                    size={20}
                    className="scr-mreq-item-author-avatar"
                  />
                  <span className="scr-mreq-item-author-name">{req.author.nickname}</span>
                </div>
                <div className="scr-mreq-item-actions">
                  <div className="scr-mreq-rec-wrap">
                    <button
                      type="button"
                      className={cx("scr-mreq-rec-btn", req.recommendedByMe && "scr-mreq-rec-btn-on")}
                      onClick={() => void toggleRecommend(req)}
                      disabled={busyId === req.id}
                      aria-pressed={req.recommendedByMe}
                    >
                      <ThumbsUp size={14} /> {req.recommendCount}
                    </button>
                    {/* 누가 추천했는지 — PC(마우스 있는 기기)에서만 마우스오버로 팝오버 노출(요청).
                        터치 기기는 hover가 없거나 탭 후 고착되는 문제가 있어 CSS로 원천 차단. */}
                    {req.recommenders.length > 0 && (
                      <div className="scr-mreq-rec-pop" role="tooltip">
                        {req.recommenders.map((r) => (
                          <div key={r.memberId} className="scr-mreq-rec-pop-row">
                            <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={18} />
                            <span>{r.nickname}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {(req.mine || isAdmin) && (
                    <RequestKebabMenu onComplete={() => void complete(req)} busy={busyId === req.id} />
                  )}
                </div>
              </div>
              <p className="scr-mreq-item-text">{renderInline(req.text, req.targets)}</p>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize && (
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
