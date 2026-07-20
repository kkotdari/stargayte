import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ThumbsUp, X, MoreVertical, CornerDownLeft } from "lucide-react";
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

// 편집창은 검색창(SearchFilterBar)의 유저 태그 칩 입력과 완전히 같은 구조를 쓴다(요청:
// "검색창의 소스를 그대로 가져와서"). 확정된 부분(평문 조각 + 유저 칩)은 실제 DOM
// 요소로 굳어지고, 지금 타이핑 중인 마지막 조각만 진짜 <input> 하나가 담당한다 — 그
// input의 value를 프로그램적으로 덮어쓰는 시점은 오직 "후보를 확정할 때"뿐이고, 그때는
// 조합(IME) 상태가 아닌 게 보장된 순간이라(SearchFilterBar와 동일 원리) 조합 중 값을
// 덮어써서 생기는 유령 글자 문제(실제로 지적받은 문제 — "뒤에 글자도 보이는거 같음")가
// 구조적으로 생기지 않는다. 이전에 시도한 "하나의 <input> 전체를 오버레이로 덮어
// 칩처럼 보이게" 하는 방식은 오버레이 폭과 실제 입력창 폭이 조금이라도 어긋나면
// 캐럿이 밀려 보이는 문제가 있었는데(실제로 지적받은 문제 — "커서가 너무 오른쪽에
// 떨어져서 나오는 문제"), 이 구조는 애초에 그런 폭 동기화가 필요 없다 — 칩은 진짜
// 별개의 DOM 요소라 캐럿과 무관하다.
type MessagePart =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; nickname: string };

// 확정된 조각들 + 지금 타이핑 중인 마지막 조각을 합쳐 실제 저장/제출되는 "@닉네임" 마커
// 문자열로 만든다.
function partsToText(parts: MessagePart[], liveText: string): string {
  return parts.map((p) => (p.type === "text" ? p.value : `@${p.nickname}`)).join("") + liveText;
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
  // 확정된 조각(평문/칩)은 SearchFilterBar의 chips와 같은 역할 — 부모 state가 곧 진실이라
  // 다시 편집하지 않는다. 지금 타이핑 중인 마지막 조각만 liveText로 따로 들고 있다가
  // "@닉네임" 후보를 고르는 순간 그 앞부분은 committedParts로 넘어가고 칩이 뒤이어
  // 붙는다 — SearchFilterBar의 liveText/addChip과 완전히 같은 흐름.
  const [committedParts, setCommittedParts] = useState<MessagePart[]>([]);
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
      // 활성 상태 회원만(요청) — 대기/정지/탈퇴 회원은 태그 대상에서 뺀다. 본인도 태그
      // 가능하게 열어둔다(요청: "요청에 본인도 태그 가능하게 다 열어줘").
      .filter((m) => m.status === "active" && !mentionedIds.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      // 정렬 순서는 닉네임 순(요청).
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"))
      .slice(0, 50);
  }, [members, mentionQuery, mentionedIds]);

  const mentionShown = mentionQuery !== null && candidates.length > 0;

  // 자동완성 드롭다운의 키보드 하이라이트 — 검색창(SearchFilterBar) 자동완성과 같은
  // 패턴(요청: "드롭다운에서 키보드로 위아래 이동 불가"). 후보 목록이 바뀌면 0번으로
  // 되돌린다.
  useEffect(() => { setHighlight(0); }, [candidates]);
  // 위/아래로 하이라이트를 옮길 때, 그 항목이 스크롤 밖에 있으면 보이게 자동 스크롤한다
  // (요청: "드롭다운에서 위아래 키 조작시 포커싱된 항목이 화면 밖에 있을때 자동
  // 스크롤이 되어야 보일듯"). block:"nearest"라 꼭 필요한 만큼만 움직이고, 이미 보이는
  // 항목이면 스크롤이 안 움직인다.
  useEffect(() => {
    dropRef.current?.querySelector(".scr-pv-opt-active")?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  // 드롭다운 위치는 검색창(SearchFilterBar)의 유저 자동완성과 같은 방식으로 잡는다
  // (요청: "드롭다운도 같은 요소를 재사용") — 인풋 폭에 맞춰 body에 포털링해 목록이
  // 뜰 때 레이아웃이 출렁이지 않게 한다.
  useLayoutEffect(() => {
    if (!mentionShown || !inputRef.current || !dropRef.current) return;
    return attachPopover(inputRef.current, dropRef.current, { matchAnchor: true });
  }, [mentionShown]);

  // 칩이 늘어나도 세로로 줄바꿈되지 않고 가로로만 늘어나므로(SearchFilterBar와 동일),
  // 조각이 추가/삭제될 때마다 스크롤을 오른쪽 끝(=지금 타이핑 중인 자리)으로 맞춘다.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [committedParts, liveText]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.getMatchRequests(p);
      setData({ items: res.items, total: res.total, hasMore: res.hasMore, pageSize: res.pageSize });
    } catch {
      setErr("결투 신청을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [page, load]);

  // 캐럿 앞의 "@쿼리"를 찾는다. "@"만 쳐도(쿼리 0글자) 감지되어 전체 후보가 뜬다(요청:
  // "@ 치면 모든 유저가 일단 뜨게 하자").
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

  // 클릭이나 화살표로 캐럿만 옮겨도(타이핑 없이) "@단어" 위/끝이면 자동완성이 다시
  // 뜬다 — onSelect는 캐럿/선택이 바뀌는 모든 경우(클릭, 화살표, 붙여넣기 등)에
  // 공통으로 발생하는 네이티브 이벤트라 이거 하나로 충분하다.
  const onLiveTextSelect = () => {
    const el = inputRef.current;
    if (!el) return;
    detectQuery(el.value, el.selectionStart ?? el.value.length);
  };

  // 후보를 고르면 caret 앞의 "@쿼리"만큼을 잘라 확정 조각(committedParts)으로 밀어넣고
  // 그 뒤에 칩을 붙인다. liveText는 캐럿 뒤에 남아있던 나머지로 교체 — 전부 문자열
  // 슬라이싱뿐이라(Range/execCommand 전혀 없음) 삽입 위치가 항상 정확하다.
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
    // 터치로 후보를 고르면(포커스가 안 빠지게 mousedown을 막아둬서) 값이 실제로 렌더된
    // 다음 프레임에 포커스를 다시 맞춰 동기화한다(SearchFilterBar의 pick과 동일).
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 검색창(SearchFilterBar)의 onSearchKeyDown과 완전히 같은 패턴.
  const onLiveTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글(IME) 조합 중에 마지막 글자를 확정하면서 동시에 누른 키는 브라우저가 "조합
    // 확정"과 "진짜 키 입력" 두 번으로 나눠 발생시키는 경우가 있다 — 그 첫 번째(가짜,
    // isComposing) 이벤트를 무시한다(SearchFilterBar와 동일 이유).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { setMentionQuery(null); return; }
    // 인풋이 비어있을 때 백스페이스를 누르면(지울 글자가 없으니) 바로 앞 확정 조각을
    // 통째로 지운다 — 태그 입력에서 흔한 되돌리기 동작(SearchFilterBar와 동일).
    if (e.key === "Backspace" && liveText === "" && committedParts.length > 0) {
      e.preventDefault();
      setCommittedParts((prev) => prev.slice(0, -1));
      return;
    }
    if (e.key === "Enter" && !mentionShown) { e.preventDefault(); return; }
    if (!mentionShown) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % candidates.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + candidates.length) % candidates.length); }
    else if (e.key === "Enter" || e.key === " " || e.key === "Tab") {
      e.preventDefault();
      insertMention(candidates[Math.min(highlight, candidates.length - 1)]);
    }
  };

  const isEmpty = committedParts.length === 0 && liveText === "";
  const canSubmit = partsToText(committedParts, liveText).trim().length > 0 && !submitting;

  const resetCompose = () => {
    setCommittedParts([]);
    setLiveText("");
    setMentionQuery(null);
    setSubmitErr(null);
    inputRef.current?.focus();
  };

  const submit = async () => {
    const trimmed = partsToText(committedParts, liveText).trim();
    if (!trimmed) {
      setSubmitErr("요청 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const ids = Array.from(mentionedIds);
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

  // 결투가 성사되면 작성자/운영자가 "성사됨"으로 완료 처리 — 목록에서 사라진다.
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
      <h2 className="scr-v2-subheading">보고싶은 결투</h2>
      <section className="scr-mreq-corner">
        <div className="scr-mreq-compose">
          {/* 인풋과 확인 버튼을 한 줄에, 높이도 맞춘다(요청) — 지우기는 별도 버튼 대신
              인풋 안의 X 버튼으로(요청). */}
          <div className="scr-mreq-compose-row">
            <div className="scr-mreq-input-wrap">
              {/* 확정된 평문/칩 조각 + 지금 타이핑 중인 input을 한 줄에 — SearchFilterBar의
                  검색어 칩 박스와 완전히 같은 구조(요청: "검색창의 소스를 그대로
                  가져와서"). 빈 자리를 눌러도 인풋으로 포커스가 이어지게 한다. */}
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
                  // x 버튼 없이 컴팩트하게(요청: "요청하기 입력에서는 유저칩에 x 버튼
                  // 제거", "컴팩트하게 가자") — 지우기는 백스페이스로만(이미 지원).
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
                  placeholder={committedParts.length === 0 ? "@로 유저 태그" : ""}
                  autoComplete="off"
                />
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
              onClick={() => void submit()}
              aria-label="요청 등록"
            >
              {submitting ? <Spinner size={14} /> : <CornerDownLeft size={16} />}
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
