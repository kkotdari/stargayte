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
const MENTION_DATA_ATTR = "data-mention-nickname";
// 칩에 회원 id도 함께 심어둔다 — 태그된 회원 목록은 저장 문자열("@닉네임")을 정규식으로
// 다시 파싱하는 대신 이 속성으로 DOM에서 직접 걸어온다(아래 chipMemberIds).
const MENTION_ID_ATTR = "data-mention-id";
// 칩 바로 뒤에 붙이는 캐럿용 마커 — 칩 자체가 contenteditable=false 원자 요소라, 뒤에
// 진짜 텍스트 노드가 하나도 없으면 캐럿이 기댈 자리가 없어서 칩 앞으로 튀거나 편집창이
// 아예 포커스/입력을 잃는 문제가 있었다(실제로 지적받은 문제 — "칩 입력후 포커싱이 칩
// 앞에 가거나 아예 포커싱을 잃고 아무것도 입력이 안됨"). U+200B(줄바꿈 가능 지점으로
// 취급돼 편집창 높이를 튀게 함)도 U+200C 문자 자체도 시도해봤지만, U+200C조차 폰트에
// "폭 0" 글리프가 없으면 대체 글리프가 세로로 자리를 차지해 그 순간 편집창이 살짝
// 늘어나는 문제가 있었다(실제로 지적받은 문제 — "u200c 이게 세로길이가 커서 인풋창을
// 그 순간 높게 늘리는거 같아") — 문자 자체의 "폭 0" 의미론에 기대는 대신, font-size:0인
// span으로 감싸서 어떤 글리프가 나오든 화면에 아예 아무 자리도 차지하지 않게 강제한다.
const MENTION_MARKER = "\u200C";

function markerHtml(): string {
  return `<span class="scr-mreq-chip-marker">${MENTION_MARKER}</span>`;
}

// 편집창 안 칩들의 회원 id를 모아 지금 태그된 회원 집합을 만든다 — 후보 목록에서 이미
// 태그된 사람을 빼거나(candidates), 제출할 대상 목록을 만들 때(submit) 쓴다.
function chipMemberIds(el: HTMLElement): Set<string> {
  const ids = new Set<string>();
  el.querySelectorAll(`[${MENTION_ID_ATTR}]`).forEach((node) => {
    const id = node.getAttribute(MENTION_ID_ATTR);
    if (id) ids.add(id);
  });
  return ids;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 편집창(contentEditable) 안 유저 칩의 HTML — 닉네임 뒤에 작은 × 제거 칩(버튼이 아니라
// span)을 붙인다. 칩 자신은 contentEditable=false라 자간 편집이 안 되고(통째로 지워지거나
// 남거나), 텍스트는 그 앞뒤로만 자유롭게 타이핑된다. ×를 진짜 <button>으로 만들었더니
// contentEditable 영역 안의 포커스 가능한 요소가 편집창 자체의 포커스/캐럿 모델을
// 흐트려서, 칩을 하나만 넣어도 그 뒤로 편집창에 아무것도 못 쓰게 되는 버그가 있었다
// (실제로 지적받은 문제 — "유저칩 하나 넣으면 아무것도 쓸수없는데?") — 포커스를 받지
// 않는 순수 span으로 바꾸고 클릭은 이벤트 위임(아래 onEditorClick)으로 처리한다.
function chipHtml(member: Member): string {
  const nickname = escapeHtml(member.nickname);
  const id = escapeHtml(member.id);
  return (
    `<span class="scr-mreq-chip scr-mreq-chip-editor" contenteditable="false" ${MENTION_DATA_ATTR}="${nickname}" ${MENTION_ID_ATTR}="${id}">` +
    `<span>${nickname}</span>` +
    `<span class="scr-mreq-chip-x" role="button" aria-label="${nickname} 태그 제거">×</span>` +
    `</span>`
  );
}

// 편집창의 실제 DOM(텍스트 노드 + 유저 칩 span)을 저장용 문자열("@닉네임" 마커 포함)로
// 되돌린다 — 저장/제출되는 메시지 본문 자체이자, 다른 회원이 목록에서 볼 때
// renderInline이 그대로 읽어 칩으로 다시 하이라이트하는 형식이다.
function domToText(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      // 캐럿 anchor용 마커 span(markerHtml)은 MENTION_DATA_ATTR이 없어 그냥 건너뛴다 —
      // 편집 중에만 필요한 기술적 장치일 뿐 메시지 내용이 아니라 저장 문자열엔 안 남는다.
      const nickname = node.getAttribute(MENTION_DATA_ATTR);
      if (nickname) out += `@${nickname}`;
    }
  });
  return out;
}

// 문자열("@닉네임" 마커 포함)을 편집창 DOM(텍스트 노드 + 칩)으로 다시 그린다 — 최대
// 글자수 초과로 잘라내야 할 때처럼, 상태값을 기준으로 편집창 전체를 다시 그려야 하는
// 드문 경우에만 쓴다(평소 타이핑 중에는 이걸 쓰지 않는다 — 매 키 입력마다 DOM을
// 통째로 새로 그리면 캐럿 위치가 계속 끝으로 튄다).
function renderEditorFromText(el: HTMLElement, text: string, members: Member[]) {
  const names = members.map((m) => m.nickname).filter(Boolean);
  if (names.length === 0) {
    el.textContent = text;
  } else {
    const esc = names
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`@(${esc.join("|")})`, "g");
    const byNickname = new Map(members.map((m) => [m.nickname, m]));
    let html = "";
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) html += escapeHtml(text.slice(last, m.index));
      const member = byNickname.get(m[1]);
      html += member ? chipHtml(member) + markerHtml() : escapeHtml(m[0]);
      last = m.index + m[0].length;
    }
    if (last < text.length) html += escapeHtml(text.slice(last));
    el.innerHTML = html;
  }
  // 캐럿을 맨 끝으로 — 이 함수는 평소 타이핑 경로가 아니라 드문 리셋/재계산 경로라
  // 정확한 caret 위치 복원보다 "끝에 두기"가 가장 무난하다.
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
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
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionDropRef = useRef<HTMLDivElement>(null);
  // 자동완성 후보를 고를 때(드롭다운 버튼 클릭) window.getSelection()이 그 시점엔 이미
  // 비어있거나 딴 곳을 가리키는 경우가 있어(포커스 자체는 mousedown preventDefault로
  // 지켜지지만, contentEditable의 selection 보존은 input/textarea만큼 브라우저마다
  // 일관되지 않는다) — 그 상태로 계속 진행하면 삽입 위치를 잘못 잡아 편집창 자체가
  // 먹통이 되는 버그가 있었다(실제로 지적받은 문제 — "유저칩 입력후 포커싱이 없어지고
  // 인풋도 더이상 안되는 문제"). 실제로 타이핑 중이라 selection이 확실히 유효한
  // detectMentionFromCaret 시점에 캐럿 위치를 미리 저장해두고, 칩을 끼워 넣을 때는
  // 그 저장값을 쓴다.
  const mentionAnchorRef = useRef<{ node: Text; offset: number } | null>(null);
  // Escape로 드롭다운을 닫은 직후 keyup의 재감지를 한 번 건너뛰기 위한 플래그(아래
  // onEditorKeyDown의 Escape 분기, onEditorKeyUp 참고).
  const suppressNextDetectRef = useRef(false);
  // insertMention 안에서 document.execCommand를 부르면 브라우저가 그 자리에서 진짜
  // 'input' 이벤트를 한 번 더 쏴서, onEditorInput이 insertMention 실행 도중에 재진입으로
  // 다시 불린다 — 이때 onEditorInput이 (특히 글자수 초과로) DOM을 통째로 다시 그려버리면
  // execCommand가 방금 만든 노드 참조와 어긋나 삽입 결과가 꼬일 수 있다(실제로 지적받은
  // 문제 — "자동완성시 마지막으로 쓴 글자가 추가 입력돼", "공백도 들어가고"). insertMention이
  // 실행되는 동안은 그 재진입 호출을 완전히 무시한다.
  const insertingRef = useRef(false);

  // text가 바뀔 때마다(칩 추가/제거 포함) 다시 계산한다 — 실제 DOM 변경은 항상 그 text
  // 상태 갱신보다 먼저 끝나 있어(우리 코드가 항상 DOM을 먼저 바꾸고 나서 setText를 부르는
  // 순서라) 이 시점에 editorRef.current를 다시 읽으면 최신 칩 목록이다.
  const mentionedIds = useMemo(() => {
    const el = editorRef.current;
    return el ? chipMemberIds(el) : new Set<string>();
  }, [text]);
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

  // 캐럿이 있는 텍스트 노드 안에서만 "@쿼리" 후보를 찾는다 — 칩은 통째 한 노드라 그
  // 경계를 넘어 단어가 이어질 수 없다(칩 바로 옆에서 타이핑해도 그 칩의 닉네임까지
  // 쿼리에 섞이지 않는다).
  const detectMentionFromCaret = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setMentionQuery(null);
      mentionAnchorRef.current = null;
      return;
    }
    const range = sel.getRangeAt(0);
    let node: Node = range.startContainer;
    let offset = range.startOffset;
    // 캐럿이 텍스트 노드가 아니라 편집창(엘리먼트) 자체를 가리킬 때가 있다 — 특히 빈
    // 칸에 첫 글자를 막 쳤을 때처럼 경계 케이스에서 브라우저가 selection을 텍스트 노드
    // 안으로 안 들어가고 부모 엘리먼트 기준으로 잡아버리는 경우(실제로 지적받은 문제 —
    // "자동완성 안떠"). 그 offset 바로 앞 자식이 텍스트 노드면 그 끝으로 캐럿을 옮겨
    // 계산한다.
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[offset - 1];
      if (child && child.nodeType === Node.TEXT_NODE) {
        node = child;
        offset = child.textContent?.length ?? 0;
      }
    }
    if (node.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) {
      setMentionQuery(null);
      mentionAnchorRef.current = null;
      return;
    }
    const before = (node.textContent ?? "").slice(0, offset);
    // "@"가 실제로 있을 때만 태그 모드로 들어간다 — 예전엔 "@" 없이도 매칭돼서, 그냥
    // 평범한 단어를 치는 중에도(그 단어가 어느 닉네임의 일부와 겹치면) 자동완성이 몰래
    // 뜨고 있었다. 그 상태에서 스페이스/탭/엔터를 누르면 평범한 공백/이동 대신 엉뚱하게
    // 칩이 끼어들었다 — 실제로 지적받은 문제("스페이스 입력시 칩과 함께 공백이 들어가는
    // 오류", "자동완성시 마지막 타이핑한 글자가 들어가는 오류")의 근본 원인.
    // 쿼리 글자 수는 0개(막 "@"만 친 상태)도 허용한다(요청: "@ 치면 모든 유저가 일단
    // 뜨게 하자") — 그때는 mentionQuery가 빈 문자열이 되고, candidates 필터가 빈 쿼리를
    // "전부 보여주기"로 취급한다.
    const m = before.match(/@([^\s@]*)$/);
    if (m) {
      // 지금은 selection이 확실히 유효한 시점이라 여기서 캐럿 위치를 붙잡아 둔다.
      mentionAnchorRef.current = { node: node as Text, offset };
      setMentionQuery(m[1]);
    } else {
      mentionAnchorRef.current = null;
      setMentionQuery(null);
    }
  };

  const syncTextFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    setText(domToText(el));
  };

  const onEditorInput = () => {
    if (insertingRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    const raw = domToText(el);
    if (raw.length > MESSAGE_MAX_LENGTH) {
      const truncated = raw.slice(0, MESSAGE_MAX_LENGTH);
      renderEditorFromText(el, truncated, members);
      setText(truncated);
      setMentionQuery(null);
      return;
    }
    setText(raw);
    detectMentionFromCaret();
  };

  // 붙여넣기는 서식 없는 텍스트로만 — 그래야 편집창 DOM이 항상 "텍스트 노드 + 칩 span"
  // 형태를 유지한다(다른 서식이 섞이면 domToText/캐럿 계산이 깨진다).
  const onEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text/plain");
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(paste);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    onEditorInput();
  };

  // 후보를 고르면 캐럿 앞의 "@쿼리"를 선택 상태로 만들고, execCommand("insertHTML")로
  // 그 선택 영역을 칩 HTML로 바꿔치기한다. 처음엔 Range.deleteContents() +
  // Range.insertNode()로 직접 DOM을 조립했는데, 그렇게 만든 선택/캐럿 상태는 브라우저의
  // 실제 편집 모델과 어긋나서 칩을 하나만 넣어도 편집창이 이후 어떤 입력도 받지 않는
  // 버그가 있었다(실제로 지적받은 문제 — "유저칩 하나 넣으면 아무것도 쓸수없는데?").
  // execCommand는 deprecated지만 브라우저 자체의 편집 명령 파이프라인을 타기 때문에
  // 포커스/캐럿/실행취소 스택이 항상 일관되게 유지된다 — 수작업 Range 삽입으로는
  // 재현하기 어려운 보장이라 그대로 채택.
  const insertMention = (member: Member) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    // 지울 글자 수는 "지금 화면에 보이는 자동완성 쿼리 문자열"(mentionQuery, React state로
    // 항상 최신값 유지)의 길이 + 1("@" 자신)로 정확히 계산한다 — DOM 텍스트를 다시 읽어
    // 정규식으로 재추정하던 예전 방식들은 상황에 따라 하나씩 어긋나 마지막 글자가 칩 앞에
    // 그대로 남거나 공백이 더 들어가는 문제가 있었다(실제로 지적받은 문제 — "스페이스로
    // 자동완성시 아직도 마지막 입력한 글자가 들어가"). mentionQuery는 타이핑할 때마다(IME
    // 조합 중간 상태 포함) 갱신되니 그 길이를 그대로 믿는 쪽이 훨씬 안전하다.
    const deleteLen = (mentionQuery?.length ?? 0) + 1;

    // 캐럿 위치는 지금 이 순간의 live selection을 우선 쓴다 — 키보드로 확정할 땐(스페이스/
    // 탭/엔터) 포커스가 편집창을 벗어난 적이 없어 이게 가장 최신이다. 저장해둔
    // mentionAnchorRef는 마우스로 후보를 클릭했을 때만 쓴다 — 그 시점엔 window.getSelection()
    // 이 이미 비어있거나 딴 곳을 가리키는 경우가 있다(위 mentionAnchorRef 선언부 참고).
    const liveSel = window.getSelection();
    const liveRange = liveSel && liveSel.rangeCount > 0 ? liveSel.getRangeAt(0) : null;
    const anchor = mentionAnchorRef.current;

    let endNode: Text | null = null;
    let endOffset = 0;
    if (
      liveRange && liveRange.collapsed &&
      liveRange.startContainer.nodeType === Node.TEXT_NODE &&
      el.contains(liveRange.startContainer)
    ) {
      endNode = liveRange.startContainer as Text;
      endOffset = liveRange.startOffset;
    } else if (anchor && anchor.node.isConnected && el.contains(anchor.node)) {
      endNode = anchor.node;
      endOffset = anchor.node.textContent?.length ?? 0;
    }

    const range = document.createRange();
    if (endNode) {
      range.setStart(endNode, Math.max(0, endOffset - deleteLen));
      range.setEnd(endNode, endOffset);
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
    }

    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // "@쿼리" 선택 영역을 칩으로 치환하고, 캐럿이 기댈 폭 0 마커를 바로 뒤에 붙인다(위
    // MENTION_MARKER 선언부 참고) — 눈엔 안 보이니 "칩 다음에 공백 없이 바로 커서가
    // 놓여야해" 요구는 그대로 지키면서도, 칩(원자 요소) 바로 뒤에 진짜 텍스트 노드가
    // 없어서 캐럿/포커스가 불안정해지는 문제(실제로 지적받은 문제 — "칩 입력후 포커싱이
    // 칩 앞에 가거나 아예 포커싱을 잃고 아무것도 입력이 안됨")는 막아준다.
    // execCommand는 그 자리에서 진짜 'input' 이벤트를 다시 쏘는데(onEditorInput 재진입),
    // 그동안엔 그 재진입 호출이 아무 것도 안 하도록 막는다(위 insertingRef 선언부 참고).
    insertingRef.current = true;
    try {
      document.execCommand("insertHTML", false, chipHtml(member) + markerHtml());
    } finally {
      insertingRef.current = false;
    }

    mentionAnchorRef.current = null;
    setMentionQuery(null);

    // 삽입 직후의 캐럿 위치(마커 뒤)를 붙잡아 둔다 — 아래 rAF에서 focus()만 다시 부르면
    // 그 사이 selection이 흐트러져 캐럿이 편집창 맨 앞(칩보다도 앞)으로 돌아가 버리는
    // 경우가 있었다(실제로 지적받은 문제 — "칩 입력 후 바로 @누르면 칩 앞에 @이 입력됨").
    const afterSel = window.getSelection();
    const afterRange = afterSel && afterSel.rangeCount > 0 ? afterSel.getRangeAt(0).cloneRange() : null;

    const raw = domToText(el);
    let didTruncate = false;
    if (raw.length > MESSAGE_MAX_LENGTH) {
      didTruncate = true;
      const truncated = raw.slice(0, MESSAGE_MAX_LENGTH);
      renderEditorFromText(el, truncated, members); // 이 함수가 스스로 캐럿을 끝에 둔다
      setText(truncated);
    } else {
      setText(raw);
    }

    // 탭으로 확정했을 때 포커스가 편집창 밖(지우기 X 버튼 등)으로 새는 경우가 있었다
    // (실제로 지적받은 문제 — "탭으로 자동완성하면 x 버튼에 포커싱이 이동해") — 이번
    // 이벤트 처리가 다 끝나고 브라우저 자체 기본 동작까지 모두 지나간 다음 프레임에
    // 한 번 더 편집창으로 강제로 되돌린다. 글자수 초과로 다시 그려진 경우(didTruncate)는
    // renderEditorFromText가 이미 올바른 캐럿을 잡아뒀으니 여기서 덮어쓰지 않는다.
    requestAnimationFrame(() => {
      el.focus();
      if (!didTruncate && afterRange) {
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(afterRange);
      }
    });
  };

  // 칩의 × 클릭을 이벤트 위임으로 처리 — ×를 진짜 <button>으로 만들면 그 요소가
  // contentEditable 영역 안에서 포커스를 가져갈 수 있어(포커스 가능한 요소는 편집창의
  // 캐럿 모델을 흐트린다) 편집창이 먹통되는 문제가 있었다. 포커스를 받지 않는 순수
  // span(chipHtml 참고)으로 바꾸고, 클릭은 편집창 전체에 하나의 핸들러로만 위임한다.
  const onEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const removeBtn = target.closest(".scr-mreq-chip-x");
    if (removeBtn) {
      e.preventDefault();
      const chip = removeBtn.closest(`[${MENTION_DATA_ATTR}]`);
      chip?.remove();
      syncTextFromDom();
      return;
    }
    detectMentionFromCaret();
  };

  // 자동완성 드롭다운이 떠 있는 동안은(mentionQuery !== null) 위/아래/스페이스/탭/엔터/esc가
  // 전부 "목록 조작 전용"으로만 쓰이고, 편집창 기본 동작(공백 입력·탭 이동·줄바꿈·아무
  // 동작 없음)으로 새지 않아야 한다(요청: "자동완성 뜬 상태에선 탭이 다음 요소로 이동으로
  // 작용하면 안됨. 엔터, 스페이스도 마찬가지 ... 아무런 추가 입력이나 액션이 실행되어선
  // 안됨"). 그래서 후보가 0개라도(드문 과도기 렌더) candidates.length가 아니라
  // mentionQuery만으로 게이트를 걸어 항상 preventDefault + stopPropagation한다.
  const dropdownOpen = mentionQuery !== null;
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 칩 뒤에는 캐럿용 마커 span(markerHtml)이 붙어있어서, 백스페이스를 있는 그대로
    // 브라우저에 맡기면 그 마커 한 글자만 지워지고 칩은 그대로 남는다 — 한 번 더 눌러야
    // 지워지는 이상한 사용감이었다(실제로 지적받은 문제 — "안보이는데 백스페이스는
    // 먹히는 이상한 유저 경험"). 캐럿 바로 앞이 "마커 span + 칩"이면 둘을 한 번에 지운다.
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (r && r.collapsed && r.startContainer.nodeType === Node.TEXT_NODE) {
        const node = r.startContainer as Text;
        const offset = r.startOffset;
        const markerSpan = node.parentElement;
        if (
          offset === (node.textContent?.length ?? 0) &&
          markerSpan?.classList.contains("scr-mreq-chip-marker")
        ) {
          const chip = markerSpan.previousElementSibling;
          if (chip instanceof HTMLElement && chip.hasAttribute(MENTION_DATA_ATTR)) {
            e.preventDefault();
            const delRange = document.createRange();
            delRange.setStartBefore(chip);
            delRange.setEndAfter(markerSpan);
            delRange.deleteContents();
            const after = window.getSelection();
            after?.removeAllRanges();
            after?.addRange(delRange);
            syncTextFromDom();
            detectMentionFromCaret();
            return;
          }
        }
      }
    }
    if (dropdownOpen && e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (candidates.length > 0) setHighlight((h) => (h + 1) % candidates.length);
      return;
    }
    if (dropdownOpen && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (candidates.length > 0) setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
      return;
    }
    if (dropdownOpen && (e.key === "Enter" || e.key === " " || e.key === "Tab")) {
      // 한글(IME) 조합 중 마지막 글자를 확정하며 동시에 누른 Enter는 브라우저가 "조합
      // 확정"과 "진짜 Enter" 두 번으로 나눠 발생시키는 경우가 있다(SearchFilterBar와
      // 동일한 현상). 그 첫 번째(가짜, isComposing) Enter만 건너뛰고 곧이어 오는 진짜
      // Enter에서 처리한다 — Space/Tab은 이런 이중발생이 없는 키라 그대로 처리해야
      // 하는데, 예전에 Enter/Space/Tab을 한꺼번에 가드로 걸렀더니 스페이스로 확정하는
      // 것 자체가 아예 안 먹는 회귀가 생겼다(실제로 지적받은 문제 — "스페이스로
      // 자동완성 결정이 안되네").
      if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
      e.preventDefault();
      e.stopPropagation();
      if (candidates.length > 0) insertMention(candidates[Math.min(highlight, candidates.length - 1)]);
      return;
    }
    if (dropdownOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // Escape 직후 keyup에서 detectMentionFromCaret이 다시 돌면, 캐럿 자리엔 여전히
      // "@쿼리" 글자가 그대로 남아있어(아무것도 지운 게 아니므로) 방금 닫은 드롭다운이
      // 곧바로 되살아났다(실제로 지적받은 문제 — "ESC 눌러도 추천 목록 안닫히는 오류").
      // 그 재감지를 한 번 건너뛰게 막는다.
      suppressNextDetectRef.current = true;
      mentionAnchorRef.current = null;
      setMentionQuery(null);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); return; }
  };

  const onEditorKeyUp = () => {
    if (suppressNextDetectRef.current) {
      suppressNextDetectRef.current = false;
      return;
    }
    detectMentionFromCaret();
  };

  // 플레이스홀더/지우기 버튼은 "실제로 뭐라도 쳤는지"(공백 하나만 쳐도 포함) 기준이라
  // trim하지 않는다 — trim된 값으로 판단하면 스페이스만 쳤을 때 편집창엔 공백이 들어가
  // 있는데도 플레이스홀더가 그 위에 그대로 겹쳐 보이는 문제가 있었다(실제로 지적받은
  // 문제 — "스페이스를 입력하면 플레이스 홀더가 안보여야하는데 보이는 문제"). 제출
  // 가능 여부(canSubmit)는 공백만 있는 메시지를 막아야 하니 그대로 trim해서 판단한다.
  const isEmpty = text === "";
  const canSubmit = text.trim().length > 0 && !submitting;

  const resetCompose = () => {
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
      // X는 편집창 밖의 별도 <button>이라 클릭하면 기본적으로 그쪽으로 포커스가
      // 넘어가버린다 — 지우고 나서 다시 이어 쓸 수 있게 편집창으로 되돌린다(실제로
      // 지적받은 문제 — "요청 입력 x버튼 누르면 포커싱을 잃는 문제").
      editorRef.current.focus();
    }
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
      const ids = editorRef.current ? Array.from(chipMemberIds(editorRef.current)) : [];
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
              <div
                ref={editorRef}
                className={cx("scr-input scr-mreq-editor", isEmpty && "scr-mreq-editor-empty")}
                contentEditable
                role="textbox"
                aria-multiline="false"
                data-placeholder="@로 유저 태그"
                onInput={onEditorInput}
                onPaste={onEditorPaste}
                onKeyUp={onEditorKeyUp}
                onKeyDown={onEditorKeyDown}
                onClick={onEditorClick}
                suppressContentEditableWarning
              />
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
