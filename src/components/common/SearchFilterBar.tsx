import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { attachPopover } from "../../utils/popover";
import { cx } from "../../utils/format";

interface SearchFilterBarProps {
  count: number;
  countLabel: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  // 유저 검색 자동완성 후보 — 페이지 진입 시 한 번(이미 로드된 회원 목록에서) 계산해서
  // 넘겨준다. 타이핑마다 서버에 새로 묻지 않고 이 안에서만 걸러 보여준다(실시간 조회 X).
  suggestions?: string[];
  // 검색창 위에 얹히는 필터창 — 화면마다 다른 내용(PillTabs, 종족 셀렉트, 월 선택 등)을
  // 그대로 넘긴다. 없으면(랭킹 이외엔 항상 있음) 검색창만 뜬다.
  filterPanel?: ReactNode;
  // false면 검색창 자체를 안 그린다(요청: "랭킹/회원 검색창 제거") — 필터창 + 건수만 남는다.
  showSearch?: boolean;
  // false면 건수 표시를 이 바에서 안 그린다 — 경기 화면처럼 건수를 다른 자리(목록 바로
  // 위)에 직접 그리고 싶을 때(요청: "목록 건수는 조회 버튼 아래 목록 위에"). 기본 true.
  showCount?: boolean;
}

// 후보를 넉넉히 보여준다 — 드롭다운은 max-height 안에서 넘치면 스크롤된다(요청: 자동완성 스크롤).
const MAX_SUGGESTIONS = 50;

// searchValue(공백으로 구분된 검색어 문자열, memberMatchesQuery가 그대로 쓰는 형식)를
// 칩 배열로 나눈다. 지금 타이핑 중인 마지막 단어는 이 값에 안 들어있다 — 그건 별도의
// liveText 로컬 상태다(칩이 완성되기 전까진 부모에 알리지 않는다).
function parseSearchChips(value: string): string[] {
  return value.trim() === "" ? [] : value.trim().split(" ").filter(Boolean);
}

// 경기결과/전적통계/랭킹 목록이 공용으로 쓰는, 타이틀 아래 인라인 필터+검색 바(요청:
// "각 화면의 필터를 화면 상단 타이틀 아래에 배치, 하단 플로팅은 제거"). 검색창은 유저
// 입력만 받는다(요청: "검색창에 유저 입력만") — 종족은 필터창의 드롭다운으로 옮겼다.
export default function SearchFilterBar({
  count, countLabel,
  searchValue, onSearchChange, searchPlaceholder = "@로 유저 입력",
  suggestions,
  filterPanel,
  showSearch = true,
  showCount = true,
}: SearchFilterBarProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // 칩(완성된 검색어/경기번호)은 부모 state(searchValue 등)를 그대로 진실로 삼아 즉시
  // 반영한다(요청: "칩 추가/제거시 즉시 적용"). 지금 타이핑 중인, 아직 칩이 안 된 마지막
  // 단어만 로컬 상태(liveText)로 들고 있다가 스페이스로 완성되거나 엔터로 확정될 때 적용한다.
  const [liveText, setLiveText] = useState("");
  const chips = useMemo(() => parseSearchChips(searchValue), [searchValue]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const chipBoxRef = useRef<HTMLDivElement>(null);

  // 스페이스로 완성됐거나 엔터로 확정된 단어 하나를 즉시 검색어 칩으로 적용한다.
  const addChip = (word: string) => {
    // 앞의 @는 자동완성 트리거일 뿐이라 칩엔 남기지 않는다(요청: "유저 검색창도 @로
    // 시작하게").
    const trimmed = word.replace(/^@/, "").trim();
    if (!trimmed) return;
    onSearchChange(chips.length > 0 ? `${chips.join(" ")} ${trimmed}` : trimmed);
  };

  // 결과 필터(memberMatchesQuery)와 같은 방식으로 띄어쓰기 여러 단어를 지원한다 — 이미
  // 완성된 칩은 다시 후보로 보여줄 필요가 없으니, 지금 입력 중인 마지막 단어(liveText)만
  // 기준으로 유저 이름을 자동완성한다. @로 시작할 때만 자동완성이 뜬다(요청: "유저
  // 검색창도 @로 시작하게") — @ 바로 뒤는 빈 쿼리라도(전체 후보) 보여준다.
  const matchedSuggestions = useMemo<string[]>(() => {
    if (!suggestions) return [];
    const raw = liveText.trim();
    if (!raw.startsWith("@")) return [];
    const q = raw.slice(1).toLowerCase();
    const chosen = new Set(chips.map((c) => c.toLowerCase()));
    const items: string[] = [];
    for (const s of suggestions) {
      if (items.length >= MAX_SUGGESTIONS) break;
      if (chosen.has(s.toLowerCase()) || !s.toLowerCase().includes(q)) continue;
      items.push(s);
    }
    return items;
  }, [suggestions, liveText, chips]);

  const suggestShown = suggestOpen && matchedSuggestions.length > 0;

  // 인풋 폭에 맞춰 body에 포털링한다 — 그냥 흐름 안에 두면 목록이 뜰 때 그만큼 아래
  // 요소들을 밀어내려 레이아웃이 출렁인다(실제로 지적받은 문제).
  useEffect(() => {
    if (!suggestShown || !inputRef.current || !dropRef.current) return;
    return attachPopover(inputRef.current, dropRef.current, { matchAnchor: true });
  }, [suggestShown]);

  useEffect(() => {
    if (!suggestOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [suggestOpen]);

  useEffect(() => { setHighlight(0); }, [matchedSuggestions]);

  // 칩이 늘어나도 세로로 줄바꿈되지 않고(요청: "일반 인풋처럼 왼쪽으로 밀리며 가려지는
  // 형태로") 가로로만 늘어나므로, 칩이 추가/삭제될 때마다 스크롤을 오른쪽 끝(=지금
  // 타이핑 중인 자리)으로 맞춰 항상 커서 쪽이 보이게 한다.
  useEffect(() => {
    const el = chipBoxRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [searchValue, liveText]);

  // 후보(유저 이름)를 고르면 즉시 검색어 칩으로 적용하고 liveText를 비운다.
  const pick = (name: string) => {
    addChip(name);
    setLiveText("");
    setSuggestOpen(false);
    // 터치로 후보를 고르면(포커스가 안 빠지게 mousedown을 막아둬서) 인풋이 비워졌는데도
    // 모바일 키보드가 내부적으로 기억해둔 커서/조합 위치가 남아있는 경우가 있어, 값이
    // 실제로 렌더된 다음 프레임에 포커스를 다시 맞춰 동기화한다.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // 칩(완성된 검색어) 하나를 지우고 즉시 반영한다 — 지금 타이핑 중이던 마지막 단어는
  // 그대로 둔다.
  const removeChip = (index: number) => {
    onSearchChange(chips.filter((_, i) => i !== index).join(" "));
  };

  // 검색칸에서 방향키로 후보를 이동, 엔터로 포커싱된 후보를 선택, ESC로 닫기 — 다른
  // 드롭다운(Select 등)과 같은 조작 방식. 인풋이 비어있을 때 백스페이스를 누르면(지울
  // 글자가 없으니) 바로 앞 칩을 지운다 — 태그 입력에서 흔한 되돌리기 동작.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글(IME) 조합 중에 마지막 글자를 확정하면서 동시에 누른 Enter는 브라우저가
    // "조합 확정"과 "진짜 Enter" 두 번으로 나눠 발생시키는 경우가 있다 — pick()이 두 번
    // 실행돼 그 사이 바뀐 후보까지 같이 들어가 버린다(실제로 지적받은 문제). keyCode 229는
    // IME 조합 중임을 나타내는 표준 신호라 이때는 무시한다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { setSuggestOpen(false); return; }
    if (e.key === "Backspace" && liveText === "" && chips.length > 0) {
      e.preventDefault(); removeChip(chips.length - 1); return;
    }
    // 자동완성 후보가 안 떠 있을 때 엔터를 누르면 지금 입력 중이던 단어를(있다면) 그대로
    // 검색어 칩으로 즉시 적용하고, 모바일에서는 입력칸 포커스도 풀어 키보드를 닫는다 —
    // 후보가 떠 있을 때는 아래에서 그 후보를 고르는 동작이 우선.
    if (!suggestShown) {
      if (e.key === "Enter") { addChip(liveText); setLiveText(""); inputRef.current?.blur(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % matchedSuggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + matchedSuggestions.length) % matchedSuggestions.length); }
    // 후보가 떠 있으면 스페이스/탭/엔터 아무거나로 확정한다(요청: "자동완성은 스페이스,
    // 탭, 엔터로 입력되게") — 스페이스는 기본적으로 지금 타이핑 중인 글자를 그대로 칩으로
    // 커밋하지만(위 onChange), 후보가 떠 있을 때만큼은 그 원래 동작 대신 하이라이트된
    // 후보를 고르는 쪽이 우선한다.
    else if (e.key === "Enter" || e.key === " " || e.key === "Tab") {
      e.preventDefault();
      pick(matchedSuggestions[Math.min(highlight, matchedSuggestions.length - 1)]);
    }
  };

  const searchItem = (
    <div className="scr-list-search-wrap" ref={wrapRef}>
      <span className="scr-field-label-text">유저</span>
      {/* 완성된 검색어는 둥근네모 칩으로, 지금 타이핑 중인 마지막 단어만 실제 인풋
          값이다 — 클릭하면 인풋에 포커스를 준다(칩들 사이 빈 자리를 눌러도 바로
          이어서 입력할 수 있게). */}
      <div
        ref={chipBoxRef}
        className="scr-input scr-list-search-input scr-search-chip-box"
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }}
      >
        {chips.map((chip, i) => (
          <span key={`${chip}-${i}`} className="scr-search-chip">
            {chip}
            <button
              type="button"
              className="scr-search-chip-x"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeChip(i)}
              aria-label={`${chip} 검색어 제거`}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="scr-search-chip-input"
          value={liveText}
          onChange={(e) => {
            const nextLive = e.target.value;
            // 스페이스로 단어를 완성하면 곧바로 칩으로 적용한다(요청: "칩 추가/제거시
            // 즉시 적용") — 숫자만 친 단어는 경기번호로, 그 외엔 평범한 검색어로.
            if (nextLive.endsWith(" ")) {
              addChip(nextLive);
              setLiveText("");
              setSuggestOpen(false);
              return;
            }
            setLiveText(nextLive);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setSuggestOpen(false)}
          onKeyDown={onSearchKeyDown}
          placeholder={chips.length === 0 ? searchPlaceholder : ""}
          autoComplete="off"
        />
      </div>
      {suggestShown && createPortal(
        <div className="scr-pv-drop scr-scroll" ref={dropRef}>
          {matchedSuggestions.map((name, i) => (
            <button
              type="button" key={name}
              className={cx("scr-pv-opt", i === highlight && "scr-pv-opt-active")}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(name)}
            >
              {name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );

  // 필터창(있으면)이 위, 검색창이 아래로 세로로 쌓인다(요청: "필터가 위 검색이 아래").
  // 타이틀 아래 문서 흐름 안에 그대로 있어, 스크롤하면 목록과 함께 자연스럽게 올라간다.
  return (
    <div className="scr-filter-bar">
      <div className="scr-filter-inline-stack">
        {filterPanel && <div className="scr-filter-panel">{filterPanel}</div>}
        {showSearch && <div className="scr-search-filter-float">{searchItem}</div>}
      </div>
      {showCount && <span className="scr-list-count scr-filter-bar-count">{count}{countLabel}</span>}
    </div>
  );
}
