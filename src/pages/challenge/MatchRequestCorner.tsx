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

// 텍스트에서 "@닉네임"으로 실제 지목된 회원 id들을 뽑아낸다 — 편집창은 이제 칩으로
// 보여주지만(요청: "태그된 유저를 @유저가 아닌 칩으로 실시간으로 보여주고 편집할수있게"),
// 저장/제출용 진실은 여전히 이 마커 문자열이다(입력창 DOM에서 그대로 다시 만들어낸다 —
// 아래 domToText). 긴 닉네임부터 매칭해 짧은 닉네임이 긴 닉네임의 일부로 잘못 걸리는 걸 피한다.
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
const MENTION_DATA_ATTR = "data-mention-nickname";

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
  return (
    `<span class="scr-mreq-chip scr-mreq-chip-editor" contenteditable="false" ${MENTION_DATA_ATTR}="${nickname}">` +
    `<span>${nickname}</span>` +
    `<span class="scr-mreq-chip-x" role="button" aria-label="${nickname} 태그 제거">×</span>` +
    `</span>`
  );
}

// 편집창의 실제 DOM(텍스트 노드 + 유저 칩 span)을 저장용 문자열("@닉네임" 마커 포함)로
// 되돌린다 — extractMentionIds가 그대로 읽을 수 있는 예전과 같은 형식.
function domToText(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
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
    const re = new RegExp(`@(${esc.join("|")})(?![^\\s@])`, "g");
    const byNickname = new Map(members.map((m) => [m.nickname, m]));
    let html = "";
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) html += escapeHtml(text.slice(last, m.index));
      const member = byNickname.get(m[1]);
      html += member ? chipHtml(member) : escapeHtml(m[0]);
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

  const mentionedIds = useMemo(() => new Set(extractMentionIds(text, members)), [text, members]);
  const candidates = useMemo(() => {
    const q = (mentionQuery ?? "").toLowerCase();
    return members
      .filter((m) => m.id !== user?.id && !mentionedIds.has(m.id))
      .filter((m) => !q || m.nickname.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      .slice(0, 50);
  }, [members, user?.id, mentionQuery, mentionedIds]);

  // 자동완성 드롭다운의 키보드 하이라이트 — 검색창(SearchFilterBar) 자동완성과 같은
  // 패턴(요청: "드롭다운에서 키보드로 위아래 이동 불가"). 후보 목록이 바뀌면 0번으로
  // 되돌린다.
  const [highlight, setHighlight] = useState(0);
  useEffect(() => { setHighlight(0); }, [candidates]);

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
    const node = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
    if (!node || node.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) {
      setMentionQuery(null);
      mentionAnchorRef.current = null;
      return;
    }
    const offset = sel!.getRangeAt(0).startOffset;
    const before = (node.textContent ?? "").slice(0, offset);
    // "@"가 실제로 있을 때만 태그 모드로 들어간다 — 예전엔 "@" 없이도 매칭돼서, 그냥
    // 평범한 단어를 치는 중에도(그 단어가 어느 닉네임의 일부와 겹치면) 자동완성이 몰래
    // 뜨고 있었다. 그 상태에서 스페이스/탭/엔터를 누르면 평범한 공백/이동 대신 엉뚱하게
    // 칩이 끼어들었다 — 실제로 지적받은 문제("스페이스 입력시 칩과 함께 공백이 들어가는
    // 오류", "자동완성시 마지막 타이핑한 글자가 들어가는 오류")의 근본 원인.
    const m = before.match(/@([^\s@]+)$/);
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

    // 저장해둔 캐럿 위치를 우선 쓴다 — 클릭 시점의 window.getSelection()은 신뢰할 수
    // 없다(위 mentionAnchorRef 선언부 참고). 저장값이 더 이상 유효하지 않으면(그 사이
    // 노드가 지워졌다든가) 편집창 맨 끝으로 안전하게 되돌아간다.
    const anchor = mentionAnchorRef.current;
    const range = document.createRange();
    if (anchor && anchor.node.isConnected && el.contains(anchor.node)) {
      const safeOffset = Math.min(anchor.offset, anchor.node.textContent?.length ?? 0);
      range.setStart(anchor.node, safeOffset);
      range.setEnd(anchor.node, safeOffset);
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
    }

    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const before = (node.textContent ?? "").slice(0, range.startOffset);
      const mm = before.match(/@([^\s@]*)$/);
      const removeLen = mm ? mm[0].length : 0;
      if (removeLen > 0) range.setStart(node, range.startOffset - removeLen);
    }

    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // "@쿼리" 선택 영역을 칩으로 치환. 뒤에 붙는 공백은 일반 스페이스로 두면 칩(비편집
    // 인라인 요소) 바로 뒤에서 브라우저가 종종 지워버려서 넓힌 non-breaking space를 쓴다
    // — domToText/extractMentionIds 쪽 \s 매칭은 nbsp도 공백으로 인식해 문제 없다.
    document.execCommand("insertHTML", false, chipHtml(member) + "&nbsp;");

    mentionAnchorRef.current = null;
    setMentionQuery(null);

    const raw = domToText(el);
    if (raw.length > MESSAGE_MAX_LENGTH) {
      const truncated = raw.slice(0, MESSAGE_MAX_LENGTH);
      renderEditorFromText(el, truncated, members);
      setText(truncated);
    } else {
      setText(raw);
    }
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

  const isEmpty = text.trim() === "";
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
                data-placeholder="보고 싶은 대결을 요청해보세요."
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
                <div className="scr-mreq-mention-drop">
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
