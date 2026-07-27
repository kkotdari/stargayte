import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, MessageCirclePlus, X, Pencil, Trash2 } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { useIsMobile } from "../../hooks/useIsMobile";
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
  // 드롭다운이 떠 있을 때 바깥을 스크롤하거나 터치/클릭하면 닫는다(요청). 입력칸·드롭다운
  // 안에서의 상호작용은 유지한다. 스크롤은 어디서 나든(후보 위치가 어긋나므로) 닫는다.
  useEffect(() => {
    if (!mentionShown) return;
    const closeOnOutside = (e: Event) => {
      const t = e.target as Node | null;
      if (inputRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setMentionQuery(null);
    };
    const closeOnScroll = () => setMentionQuery(null);
    document.addEventListener("pointerdown", closeOnOutside, true);
    // 스크롤은 캡처 단계로 전역에서(어느 스크롤 컨테이너든) 잡는다.
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
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
        {/* 인풋 안 X는 항상 '지우기'다 — 수정 중일 땐 취소가 아래 별도 버튼으로 나가 있어
            여기까지 취소를 겸하면 같은 아이콘이 서로 다른 일을 하게 된다. */}
        {!isEmpty && (
          <button
            type="button"
            className="scr-mreq-clear-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
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
      {/* 수정 모드에는 확인(↵) 옆에 취소를 따로 둔다(요청) — 인풋 안 지우기(X)만으로는
          "수정을 그만둔다"가 드러나지 않는다. */}
      {onCancel && (
        <button
          type="button"
          className="scr-btn scr-mreq-submit-btn scr-mreq-cancel-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
          aria-label="수정 취소"
        >
          <X size={14} />
        </button>
      )}
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

// 댓글 화면을 화면 밖으로 완전히 내리는 데 필요한 이동량(px) — 화면 바닥에서 그 윗변까지의
// 거리다(전체화면이므로 사실상 뷰포트 높이). translateY(100%)와 같은 값이지만 px로 재두면,
// 쓸어내리다 손을 뗀 위치에서 이어서 내려가는 계산(closeSheetFrom)과 단위가 맞아 섞어 쓰기 좋다.
function hiddenOffset(el: HTMLElement): number {
  return Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
}

// 아래로 쓸어내려 닫을 때, 이만큼 내려가면 손을 떼는 순간 닫는다.
const SWIPE_CLOSE_PX = 96;

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
  // 모바일에서는 댓글을 카드 안에서 바로 쓰지 않고 전체화면에서 읽고 쓴다(요청) — 카드에는
  // 목록 미리보기(또는 댓글이 하나도 없을 때만 추가 아이콘)만 남고, 그걸 누르면 시트가 열린다.
  // PC는 화면이 넓고 키보드가 본문을 가리지 않으니 기존의 인라인 방식 그대로다(요청: 모바일만).
  const mobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetBodyRef = useRef<HTMLDivElement>(null);
  // 입력칸에 포커스가 있으면(=키보드가 올라오면) 시트 바닥 여백을 걷어 키보드에 딱 붙인다
  // (요청: "키보드 있는 데까지 아래로 덮게"). 그 여백은 홈 인디케이터/주소창을 피하려던
  // 것인데, 키보드가 올라온 동안엔 그 자리를 키보드가 이미 덮고 있어 비워둘 이유가 없다.
  //
  // 전역 훅(useEditableFocused)이 아니라 시트 안 포커스만 본다. 그 훅은 '끄는 쪽'을 뷰포트가
  // 회복될 때까지(최대 700ms) 미루는데, 그러면 키보드가 다 내려간 뒤에야 여백이 돌아와
  // 주소창보다 시트가 늦게 자리를 잡는다(지적: "주소창과 모달창 내려가는 순서 역전").
  // 여기선 포커스가 빠지는 즉시 되돌려 키보드·주소창과 같은 타이밍에 움직이게 한다.
  const [typing, setTyping] = useState(false);
  const closingRef = useRef(false);
  const closeAnimRef = useRef<Animation | null>(null);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const openSheet = () => {
    // 내려가는 중에 다시 열면 그 연출을 걷어낸다 — 안 그러면 '열린' 상태로 미끄러져 사라진 뒤
    // 뒤늦게 도착한 close의 완료 콜백이 시트를 언마운트해 버린다.
    closeAnimRef.current?.cancel();
    closeAnimRef.current = null;
    closingRef.current = false;
    if (sheetRef.current) sheetRef.current.style.transform = "";
    setTyping(false);
    setErr(null); setEditingId(null); setSheetOpen(true);
  };
  // 닫기는 내려가는 연출이 끝난 뒤에 언마운트한다 — 바로 지우면 시트가 툭 사라진다(요청:
  // 여닫을 때 트랜지션). CSS 트랜지션이 아니라 WAAPI인 이유는, 요소가 사라지는 쪽은
  // 트랜지션이 걸릴 대상 자체가 없어져 끝을 기다릴 수 없기 때문.
  // fromY: 쓸어내리다 손을 뗀 위치(px)에서 이어서 내려간다 — 0에서 다시 시작하면 손을 뗀
  // 순간 시트가 위로 튕겼다가 내려간다.
  const closeSheetFrom = (fromY: number) => {
    const el = sheetRef.current;
    if (closingRef.current) return;
    if (!el || reducedMotion()) { setEditingId(null); setSheetOpen(false); return; }
    closingRef.current = true;
    // 연출을 먼저 걸고 그 다음에 포커스를 푼다 — blur()는 키보드를 내리며 리플로우를
    // 일으켜서, 먼저 부르면 첫 프레임이 그만큼 늦게 나가 손가락을 뗀 뒤 멈칫해 보인다.
    // 닫는 연출은 짧고 뒤로 갈수록 급하게(요청: 반응 빠르게, 가속 더) — easeInCubic.
    const total = hiddenOffset(el);
    const a = el.animate(
      [{ transform: `translateY(${fromY}px)` }, { transform: `translateY(${total}px)` }],
      {
        // 이미 내려온 만큼은 시간도 줄인다 — 남은 거리를 늘 같은 속도로 마무리한다.
        duration: Math.max(90, Math.round(160 * (1 - Math.min(1, fromY / Math.max(1, total))))),
        easing: "cubic-bezier(0.32, 0, 0.67, 0)", fill: "both",
      },
    );
    // 키보드도 시트와 함께 내려가야 한다 — 포커스를 남겨두면 시트만 사라지고 키보드가 뜬 채 남는다.
    (document.activeElement as HTMLElement | null)?.blur?.();
    closeAnimRef.current = a;
    void a.finished.then(() => {
      closeAnimRef.current = null;
      setEditingId(null);
      setSheetOpen(false);
      closingRef.current = false;
    }).catch(() => { /* openSheet가 취소함 */ });
  };
  // 이벤트 핸들러에 그대로 넘겨도 인자가 섞이지 않도록 감싼다(onClick은 이벤트를 넘긴다).
  const closeSheet = () => closeSheetFrom(0);
  useEffect(() => { if (!mobile) setSheetOpen(false); }, [mobile]);
  // 시트를 열 때 배경 페이지의 스크롤 위치를 적어 두고, 닫을 때 그 자리로 되돌린다.
  //
  // 입력칸에 포커스가 가면 iOS가 "가려진 입력칸을 드러내려고" 문서를 스스로 위로 굴린다.
  // 우리 입력칸은 position:fixed 시트 안이라 사실 가려질 일이 없는데도 그렇고, 키보드를
  // 내려도 그 스크롤은 되돌아오지 않아 열 때마다 배경이 조금씩 위로 밀렸다(지적).
  //
  // 한때 스크롤이 날 때마다 곧바로 되돌려 봤는데 훨씬 나빴다(지적: "뒤 페이지와 모달이
  // 둘 다 올라갔다가 서서히 내려가 키보드 뒤로 사라진다") — iOS의 자동 스크롤은 한 번에
  // 끝나는 점프가 아니라 애니메이션이라, 매 프레임 되돌리면 그 애니메이션과 서로 밀며
  // 화면 전체가 출렁인다. 그래서 '되돌리는 순간'을 딱 하나로 줄인다: 입력칸에서 포커스가
  // 빠질 때(=키보드가 내려가기 시작할 때) 한 번만 원래 자리로 옮긴다(요청: 시트를 닫을
  // 때까지 기다리지 말고 슬쩍 바로). 한 번의 점프라 밀고 당길 상대가 없다.
  const pinnedScrollRef = useRef(0);
  useEffect(() => {
    if (!mobile || !sheetOpen) return;
    const doc = document.scrollingElement ?? document.documentElement;
    pinnedScrollRef.current = doc.scrollTop;
    const restore = () => { doc.scrollTop = pinnedScrollRef.current; };
    let raf = 0;
    // focusout은 포커스가 옮겨가기 '전'에 와서 그 순간 activeElement는 아직 body다 —
    // 입력칸에서 입력칸으로 넘어가는 경우(키보드가 그대로인 경우)까지 되돌리지 않도록
    // 한 프레임 뒤에 정착한 포커스를 보고 판단한다(useEditableFocused와 같은 이유).
    const onFocusOut = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.activeElement;
        const tag = el instanceof HTMLElement ? el.tagName : "";
        const stillTyping =
          tag === "INPUT" || tag === "TEXTAREA" || (el instanceof HTMLElement && el.isContentEditable);
        if (!stillTyping) restore();
      });
    };
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusout", onFocusOut);
      restore();
    };
  }, [mobile, sheetOpen]);
  // 입력 중에는 뒷페이지를 통째로 감춘다(전역 클래스 — CSS의 .scr-comment-typing 주석
  // 참고). 키보드가 올라오면 iOS가 이 패널을 비주얼 뷰포트에 다시 앉혀 아래에 띠가
  // 남는데, 여섯 번을 시도해도 그 띠를 패널로 덮을 수 없었다 — 덮는 대신 드러날 것을
  // 없앤다. 여닫는 연출 중에는(typing이 false) 뒷페이지가 그대로 보여야 자연스러우므로
  // '열려 있는 동안'이 아니라 '입력 중'에만 건다.
  useEffect(() => {
    if (!(mobile && sheetOpen && typing)) return;
    const root = document.documentElement;
    root.classList.add("scr-comment-typing");
    return () => root.classList.remove("scr-comment-typing");
  }, [mobile, sheetOpen, typing]);
  // 시트가 떠 있는 동안 배경(본문)으로 가는 스크롤/클릭을 막고, 바깥 탭이면 닫는다.
  useLockBodyScroll(mobile && sheetOpen, closeSheet);
  // 열릴 때 아래에서 올라온다. 시작 위치를 인라인으로 먼저 박는다 — WAAPI fill에만 맡기면
  // iOS가 첫 프레임에 적용하지 않아 열린 자리가 한 번 스쳐 보인다(FeedScreen에서도 같은 함정).
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!sheetOpen || !el || reducedMotion()) return;
    const dy = hiddenOffset(el);
    el.style.transform = `translateY(${dy}px)`;
    const a = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
    );
    void a.finished.then(() => {
      try { a.cancel(); } catch { /* 이미 끝남 */ }
      el.style.transform = "";
    }).catch(() => {});
    return () => { try { a.cancel(); } catch { /* 이미 끝남 */ } };
  }, [sheetOpen]);
  // 아래로 쓸어내려 닫기(요청). 시트 어디를 잡아도 되지만, 목록이 위로 스크롤될 수 있는
  // 상황이면 그쪽에 양보한다 — 목록이 맨 위에 있을 때만 시트가 따라 내려간다(바텀시트
  // 공통 규칙). 터치 이벤트를 직접 듣는 이유는 사파리에서 preventDefault로 브라우저의
  // 기본 스크롤/새로고침 제스처를 확실히 끊기 위해서다(ScrollNavTimeline과 같은 이유).
  useEffect(() => {
    const el = sheetRef.current;
    if (!mobile || !sheetOpen || !el) return;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    let dragging = false;
    const onStart = (e: TouchEvent) => {
      if (closingRef.current || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dy = 0;
      tracking = true;
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const delta = e.touches[0].clientY - startY;
      if (!dragging) {
        if (Math.abs(delta) < 6) return;          // 아직 방향이 정해지지 않음
        const body = sheetBodyRef.current;
        const inBody = !!body && body.contains(e.target as Node | null);
        // 위로 미는 중이거나, 목록 안에서 아직 위로 스크롤할 게 남았으면 드래그하지 않는다.
        if (delta < 0 || (inBody && body!.scrollTop > 0)) { tracking = false; return; }
        dragging = true;
        startY = e.touches[0].clientY;            // 문턱만큼의 튐 제거
        return;
      }
      dy = Math.max(0, delta);
      if (e.cancelable) e.preventDefault();
      el.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      const moved = dy;
      dy = 0;
      if (moved > SWIPE_CLOSE_PX) { closeSheetFrom(moved); return; }
      // 문턱에 못 미치면 제자리로 되돌린다.
      const back = el.animate(
        [{ transform: `translateY(${moved}px)` }, { transform: "translateY(0)" }],
        { duration: 190, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
      );
      void back.finished.then(() => {
        try { back.cancel(); } catch { /* 이미 끝남 */ }
        el.style.transform = "";
      }).catch(() => {});
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, sheetOpen]);

  // 목록은 오래된 순으로 쌓이므로(create가 뒤에 붙인다) 열자마자 맨 아래(최신)로 내린다.
  // 댓글이 늘어날 때도 방금 쓴 것이 보이게 같이 내린다.
  useLayoutEffect(() => {
    if (!sheetOpen) return;
    const el = sheetBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sheetOpen, notes.length]);

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

  // 댓글 한 줄. interactive=false는 카드 안 미리보기용 — 수정/삭제는 시트에서만 한다
  // (미리보기에서 편집까지 되면 시트를 여는 탭과 버튼 탭이 같은 자리에서 겹친다).
  const renderNote = (c: FeedComment, interactive: boolean) => (
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
        {interactive && c.canEdit && editingId !== c.id && (
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
      {interactive && editingId === c.id ? (
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
  );

  const composer = (
    <NoteComposer
      key={composerKey}
      members={members}
      initialText=""
      submitting={busy}
      onSubmit={(text, ids) => void create(text, ids)}
      placeholder="댓글 남기기 (@로 유저 태그)"
      submitLabel={<CornerDownLeft size={14} />}
    />
  );

  return (
    // 로우 전체가 클릭 토글이라, 댓글 영역에서의 클릭/입력은 로우 접힘을 막는다.
    // 시트는 body 포털로 나가지만 리액트 이벤트는 이 트리를 따라 올라오므로 여기서 함께 막힌다.
    <div className="scr-match-notes" onClick={(e) => e.stopPropagation()}>
      {mobile ? (
        <>
          {notes.length > 0 ? (
            // 댓글이 있으면 아이콘 대신 목록 자체가 시트를 여는 버튼이다(요청 1·2).
            // button 안에는 목록을 넣을 수 없어(phrasing content만 허용) role로 대신한다.
            <div
              className="scr-match-notes-preview" role="button" tabIndex={0}
              aria-label={`댓글 ${notes.length}개 보기`}
              onClick={openSheet}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(); } }}
            >
              <ul className="scr-mreq-list scr-match-notes-list">
                {notes.map((c) => renderNote(c, false))}
              </ul>
            </div>
          ) : user ? (
            <div className="scr-feed-comment-row">
              <button
                type="button" className="scr-feed-comments-toggle"
                onClick={openSheet} aria-label="댓글 쓰기" title="댓글 쓰기"
              >
                <MessageCirclePlus size={15} aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {notes.length > 0 && (
            <ul className="scr-mreq-list scr-match-notes-list">
              {notes.map((c) => renderNote(c, true))}
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
                {composer}
              </div>
            </div>
          )}
        </>
      )}

      {/* 댓글 화면(모바일) — 원래는 화면 절반짜리 바텀시트였는데, 키보드가 올라오면 시트
          아래로 뒷페이지가 비치는 iOS 문제를 끝내 못 잡아 화면 전체를 덮는 방식으로 바꿨다
          (요청). 아래에서 위로 올라오는 연출은 그대로다.
          목록은 오래된 순 그대로 두고 스크롤만 최신으로 내린다(요청), 입력창은 맨 아래(요청). */}
      {mobile && sheetOpen && createPortal(
        <div
          ref={sheetRef}
          className={cx("scr-comment-sheet scr-feed-comments scr-match-notes", typing && "scr-comment-sheet-typing")}
          role="dialog" aria-label="댓글"
          onFocus={() => setTyping(true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTyping(false); }}
        >
          <div className="scr-comment-sheet-head">
            <span className="scr-comment-sheet-title">댓글 {notes.length}</span>
            <button type="button" className="scr-icon-btn scr-comment-sheet-close" onClick={closeSheet} aria-label="닫기">
              <X size={16} />
            </button>
          </div>
          <div className="scr-comment-sheet-body scr-scroll" ref={sheetBodyRef}>
            {notes.length > 0 ? (
              <ul className="scr-mreq-list scr-match-notes-list">
                {notes.map((c) => renderNote(c, true))}
              </ul>
            ) : (
              <p className="scr-comment-sheet-empty">아직 댓글이 없어요.</p>
            )}
          </div>
          {err && <div className="scr-err scr-match-note-err">{err}</div>}
          {user && editingId === null && (
            // 입력칸 왼쪽에 내 아바타(요청) — 지금 누구 이름으로 쓰는지 보여준다.
            <div className="scr-comment-sheet-compose">
              <Avatar member={user} size={34} />
              {composer}
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* 삭제 확인창은 body로 올린다 — 이 컴포넌트는 .scr-app 안에 있고 그 조상이 z-index를
          가진 쌓임맥락을 만들어, 안에서 z-index를 아무리 올려도 body 직속인 시트(z-index 90)
          위로 못 올라간다(지적: 컨펌창이 모달 뒤에 뜬다). */}
      {deleteTarget && createPortal(
        <ConfirmDialog
          title="메모를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={busy ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          onConfirm={() => void remove(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />,
        document.body,
      )}
    </div>
  );
}
