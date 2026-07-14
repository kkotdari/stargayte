import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { attachPopover } from "../../utils/popover";
import { cx } from "../../utils/format";
import { useIsNarrow } from "../../utils/useIsNarrow";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { addScrollListener, getScrollTop } from "../../utils/scrollRoot";
import { BASE_RACES, RACE_INFO } from "../../constants/races";
import type { BaseRace } from "../../types";

// 숨는 시점은 헤더/탭바와 완전히 똑같이(요청: "숨겨지는 임계치를 탭바와 똑같이 수정.
// 동시에 없어지게") — useHideOnScrollDown이 <html>에 얹는 scr-scroll-hide 클래스를
// 그대로 신호로 쓴다(별도로 방향/델타 계산을 다시 하면 미묘하게 어긋날 수 있어, 탭바가
// 실제로 참조하는 값 자체를 그대로 관찰한다). 다시 나타나는 시점만 더 까다롭게(요청:
// "다시 노출되는 임계치는 더 상단으로 수정") 화면 맨 위 근처일 때로 좁힌다 — 탭바는
// 위로 스크롤만 해도 바로 돌아오지만, 이 알약은 그것만으론 부족하고 맨 위 가까이까지
// 올라와야 돌아온다. 값 자체는 감으로 잡았다.
const NEAR_TOP_PX = 24;

interface SearchFilterBarProps {
  count: number;
  countLabel: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  // 경기 고유번호 검색 — 별도 칸이 아니라 유저 검색창에 통합돼 있다(숫자로만 이뤄진
  // 단어를 완성하면 유저 칩이 아니라 "#번호" 칩으로 인식). 경기 화면만 넘긴다 —
  // 랭킹/전적통계는 경기번호 개념이 없어 안 넘기면 이 인식 자체가 꺼진다.
  matchNoValue?: string;
  onMatchNoChange?: (value: string) => void;
  // 종족 필터 — 라디오 대신 유저 검색창의 예약어로 통합한다(요청: "종족 필터는 라디오
  // 버튼 체크박스가 아니라 검색창에 예약어로 통합"). 타이핑만으로 자동 인식하진 않는다
  // (요청: "미선택시 일반 유저 검색어로 처리") — 자동완성 후보에 "종족: 저그" 형태로
  // 떠서, 그 후보를 직접 골라야만 종족 칩이 된다. 경기번호(matchNoValue)와 같은
  // 화면(랭킹-일대일/전적통계)만 넘긴다. 라디오와 달리 값 하나만 가능하므로, 이미 하나를
  // 골라둔 뒤에는 후보 목록에서 종족 항목 자체가 빠진다.
  raceValue?: BaseRace | null;
  onRaceChange?: (value: BaseRace | null) => void;
  searchPlaceholder?: string;
  // 유저 검색 자동완성 후보 — 페이지 진입 시 한 번(이미 로드된 회원 목록에서) 계산해서
  // 넘겨준다. 타이핑마다 서버에 새로 묻지 않고 이 안에서만 걸러 보여준다(실시간 조회 X).
  suggestions?: string[];
  // 검색창과 같은 자리(왼쪽)에 뜨는 필터창 — 화면마다 다른 내용(PillTabs, 월 선택 등)을
  // 그대로 넘긴다. 없으면(랭킹 이외엔 항상 있음) 검색창만 뜬다.
  filterPanel?: ReactNode;
}

const MAX_SUGGESTIONS = 8;

// 한글 1자 이상, 또는 영문/숫자 2자 이상 입력됐을 때만 자동완성을 보여준다 — 자음/모음
// 하나나 알파벳 한 글자만으로는 후보가 너무 많고 의미도 없다.
function meetsSuggestThreshold(q: string): boolean {
  if (/[가-힣ㄱ-ㆎ]/.test(q)) return true;
  return (q.match(/[a-zA-Z0-9]/g)?.length ?? 0) >= 2;
}

// searchValue(공백으로 구분된 검색어 문자열, memberMatchesQuery가 그대로 쓰는 형식)를
// 칩 배열로 나눈다. 지금 타이핑 중인 마지막 단어는 이 값에 안 들어있다 — 그건 별도의
// liveText 로컬 상태다(칩이 완성되기 전까진 부모에 알리지 않는다).
function parseSearchChips(value: string): string[] {
  return value.trim() === "" ? [] : value.trim().split(" ").filter(Boolean);
}

type SuggestItem = { kind: "race"; race: BaseRace } | { kind: "name"; name: string };

// 경기결과/전적통계/랭킹 목록이 공용으로 쓰는 검색창(+ 화면마다 다른 filterPanel).
export default function SearchFilterBar({
  count, countLabel,
  searchValue, onSearchChange, searchPlaceholder = "예: SSamJang",
  matchNoValue, onMatchNoChange,
  raceValue, onRaceChange,
  suggestions,
  filterPanel,
}: SearchFilterBarProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // 필터창/검색창 중 어디든 포커스가 가 있으면, 아래로 스크롤해도 이 스택을 숨기지
  // 않는다(요청: "필터창이나 검색창에 포커싱 가있는 상황에서는 아무리 아래로 스크롤해도
  // 감추면 안돼") — 지금 상호작용 중인 입력을 스크롤 한 번으로 가려버리면 안 된다.
  const [stackFocused, setStackFocused] = useState(false);
  // 탭바가 지금 숨어있는지 — useHideOnScrollDown이 <html>에 얹는 클래스를 그대로
  // 관찰해서, 이 알약도 탭바와 정확히 같은 순간에 숨는다(위 NEAR_TOP_PX 주석 참고).
  const [tabBarHidden, setTabBarHidden] = useState(
    () => document.documentElement.classList.contains("scr-scroll-hide"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setTabBarHidden(el.classList.contains("scr-scroll-hide")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  // 화면 맨 위 근처인지 — 탭바가 다시 보여도(탭바는 위로 스크롤만 하면 바로 돌아온다)
  // 이 알약은 맨 위 근처까지 와야만 함께 다시 보인다(포커스 중이면 stackFocused가
  // 그래도 계속 보이게 덮어쓴다, 위 주석 참고).
  const [nearTop, setNearTop] = useState(() => getScrollTop() <= NEAR_TOP_PX);
  useEffect(() => addScrollListener(() => setNearTop(getScrollTop() <= NEAR_TOP_PX)), []);
  // 칩(완성된 검색어/경기번호/종족)은 부모 state(searchValue 등)를 그대로 진실로 삼아
  // 즉시 반영한다(요청: "엔터 확정 방식을 실시간 반영 방식으로 원복 — 칩 추가/제거시
  // 즉시 적용"). 지금 타이핑 중인, 아직 칩이 안 된 마지막 단어만 로컬 상태(liveText)로
  // 들고 있다가 스페이스로 완성되거나 엔터로 확정될 때 addChip을 통해 즉시 적용한다.
  const [liveText, setLiveText] = useState("");
  const chips = useMemo(() => parseSearchChips(searchValue), [searchValue]);
  // 모바일에서만 position:fixed로 뜨는 이 알약이 #scroll-root(overflow-y:auto) 안의
  // 후손으로 남아있으면, iOS Safari가 스크롤 컨테이너 안의 fixed 요소를 뷰포트가 아니라
  // 그 스크롤 컨테이너 기준으로 취급해버리는 오래된 버그가 있다 — 스크롤/탭바 숨김
  // 애니메이션과 맞물리면 알약이 탭바 숨은 자리 뒤로 가려지는 문제로 실기기에서 나타났다
  // (실제로 지적받은 문제). 탭바(MobileTabBar)와 같은 이유로 #scr-app으로 포털링해서
  // 스크롤 컨테이너 바깥으로 뺀다 — PC는 애초에 fixed가 아니라 문서 흐름 안에 그냥 있는
  // 모양이라(그리드 위에 얹힌 형태) 포털링하면 오히려 레이아웃이 깨지므로 좁은 화면일
  // 때만 포털링한다.
  const isMobileFloat = useIsNarrow(640);
  // 랭킹/경기/전적통계 화면이 전부 동시에 마운트돼 있어서(탭 전환 시 상태를 기억하려고
  // 언마운트 대신 display:none만 쓴다), 화면마다
  // 하나씩 있는 SearchFilterBar도 전부 동시에 마운트돼 있다. 포털링 전에는 각자의
  // display:none 조상(화면 wrapper) 안에 그대로 있어서 안 보이는 화면의 알약도 같이
  // 숨겨졌는데, #scr-app으로 포털링하면 그 조상 밖으로 완전히 빠져나가 버려서 화면이
  // 몇 개든 상관없이 전부 동시에 화면에 겹쳐 뜨는 문제가 있었다(실제로 지적받은 문제
  // — "검색어가 화면이 바뀌어도 유지되는 것처럼 보임": 사실은 유지된 게 아니라 이전
  // 화면의 알약이 계속 떠 있어서 그걸 계속 보고 있었던 것). 포털링과 무관하게 원래
  // 자리에 그대로 남는 containerRef(.scr-filter-bar)로 "지금 이 화면이 실제로 보이는
  // 중인지"를 매 렌더마다 확인해, 안 보이는 화면이면 포털된 알약 자체를 아예 그리지
  // 않는다.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    setIsVisible(containerRef.current?.offsetParent !== null);
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const chipBoxRef = useRef<HTMLDivElement>(null);

  // 스페이스로 완성됐거나 엔터로 확정된 단어 하나를 즉시 적용한다 — 숫자만으로 된
  // 단어는 경기번호로(경기 화면만 onMatchNoChange를 넘긴다), 그 외엔 평범한 유저 검색어
  // 칩으로 곧장 부모 state에 반영한다. 종족은 이 경로로 인식하지 않는다(요청: "미선택시
  // 일반 유저 검색어로 처리") — 종족은 아래 자동완성 후보에서 직접 골라야만 적용된다.
  const addChip = (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;
    if (onMatchNoChange && /^\d+$/.test(trimmed)) {
      onMatchNoChange(trimmed);
      return;
    }
    onSearchChange(chips.length > 0 ? `${chips.join(" ")} ${trimmed}` : trimmed);
  };

  // 결과 필터(memberMatchesQuery)와 같은 방식으로 띄어쓰기 여러 단어를 지원한다 — 이미
  // 완성된 칩은 다시 후보로 보여줄 필요가 없으니, 지금 입력 중인 마지막 단어(liveText)만
  // 기준으로 자동완성한다. 종족 후보("종족: 저그")는 이미 하나를 골라둔 뒤엔(raceValue
  // 존재) 목록에서 아예 빠진다 — 값 하나만 가능한 필터라서다(요청: "맨처음것만 종족으로
  // 인식"과 같은 취지). 이름 후보보다 앞에 둔다.
  const matchedSuggestions = useMemo<SuggestItem[]>(() => {
    const q = liveText.trim().toLowerCase();
    if (!meetsSuggestThreshold(q)) return [];
    const items: SuggestItem[] = [];
    if (onRaceChange && !raceValue) {
      for (const r of BASE_RACES) {
        if (r.toLowerCase().includes(q)) items.push({ kind: "race", race: r });
      }
    }
    if (suggestions) {
      const chosen = new Set(chips.map((c) => c.toLowerCase()));
      for (const s of suggestions) {
        if (items.length >= MAX_SUGGESTIONS) break;
        if (chosen.has(s.toLowerCase()) || !s.toLowerCase().includes(q)) continue;
        items.push({ kind: "name", name: s });
      }
    }
    return items.slice(0, MAX_SUGGESTIONS);
  }, [suggestions, liveText, chips, onRaceChange, raceValue]);

  const suggestShown = suggestOpen && matchedSuggestions.length > 0;

  // 인풋 폭에 맞춰 body에 포털링한다 — 예전엔 그냥 흐름 안에 뒀는데, 목록이 뜨면 그만큼
  // 아래 요소들을 밀어내려 레이아웃이 출렁였다(실제로 지적받은 문제).
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
  }, [searchValue, matchNoValue, raceValue, liveText]);

  // 모바일 플로팅 알약(.scr-search-filter-float)은 하단 탭바 바로 위에 고정돼 있는데, 이
  // 검색창에 포커스를 줘 키보드가 뜨면 그 자리가 키보드 뒤로 가려져 입력하는 동안
  // 정작 자신이 뭘 치고 있는지 안 보였다(실제로 지적받은 문제) — 바텀시트(키보드를
  // 일부러 피하지 않음)와 반대로, 이건 지금 상호작용 중인 입력창이라 키보드 위로
  // 올라와 있어야 자연스럽다. visualViewport가 줄어든 만큼(키보드 높이)을 인라인
  // style로 얹어 CSS의 기본 위치보다 우선시킨다. Header(탭바 자동 숨김)도 같은 값이
  // 필요해서 공용 훅으로 뺐다.
  const keyboardInset = useKeyboardInset();

  // 후보를 고르면 즉시 적용한다 — 이름 후보는 검색어 칩으로(addChip), 종족 후보는 이
  // 경로로만 종족 칩이 된다(타이핑+스페이스로는 안 됨, 위 matchedSuggestions 주석 참고).
  // liveText는 비워서 인풋이 다음 단어를 받을 준비를 하게 한다.
  const pick = (item: SuggestItem) => {
    if (item.kind === "race") onRaceChange?.(item.race);
    else addChip(item.name);
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
    // "조합 확정"과 "진짜 Enter" 두 번으로 나눠 발생시키는 경우가 있다(예: "크리"를
    // 조합하며 Enter → 확정용 Enter 한 번 + 실제 Enter 한 번) — 이 경우 pick()이 두 번
    // 실행돼 그 사이 바뀐 후보(예: 조합 중이던 다른 문자열 기준 후보)까지 같이 들어가
    // 버렸다(실제로 지적받은 문제: "크리"만 쳤는데 "크리스"와 무관한 다른 이름이 함께
    // 추가됨). keyCode 229는 IME 조합 중임을 나타내는 표준 신호라 이때는 무시한다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { setSuggestOpen(false); return; }
    if (e.key === "Backspace" && liveText === "") {
      if (chips.length > 0) { e.preventDefault(); removeChip(chips.length - 1); return; }
      // 유저 칩이 하나도 안 남았을 때만 예약어 칩(경기번호/종족)까지 지운다 — 맨 앞에
      // 그려지므로 "가장 최근에 완성한 것부터 지운다"는 되돌리기 감각과 맞는다.
      if (matchNoValue && onMatchNoChange) { e.preventDefault(); onMatchNoChange(""); return; }
      if (raceValue && onRaceChange) { e.preventDefault(); onRaceChange(null); return; }
    }
    // 자동완성 후보가 안 떠 있을 때 엔터를 누르면 지금 입력 중이던 단어를(있다면) 그대로
    // 검색어 칩으로 즉시 적용하고, 모바일에서는 키보드의 "완료/검색" 키를 누른 것처럼
    // 입력칸 포커스도 풀어 키보드를 닫는다 — 후보가 떠 있을 때는 아래에서 그 후보를
    // 고르는 동작이 우선.
    if (!suggestShown) {
      if (e.key === "Enter") { addChip(liveText); setLiveText(""); inputRef.current?.blur(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % matchedSuggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + matchedSuggestions.length) % matchedSuggestions.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(matchedSuggestions[Math.min(highlight, matchedSuggestions.length - 1)]); }
  };

  const searchItem = (
    <div className="scr-list-search-wrap" ref={wrapRef}>
      <span className="scr-field-label-text">유저</span>
      {/* 완성된 검색어는 둥근네모 칩으로, 지금 타이핑 중인 마지막 단어만 실제 인풋
          값이다 — 클릭하면 인풋에 포커스를 준다(칩들 사이 빈 자리를 눌러도 바로
          이어서 입력할 수 있게). 클릭이 인풋 자체가 아니라 이 바깥 박스(빈 여백)에서
          일어나면 브라우저의 "클릭한 자리에 커서" 로직이 적용되지 않아 focus()만으로는
          커서가 맨 앞에 남는다 — 항상 맨 뒤(이어서 타이핑할 위치)로 명시적으로 옮긴다. */}
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
        {/* 경기번호 칩은 유저 칩과 구분되는 모양(#번호)으로 — 숫자만 친 단어를 완성하면
            유저 칩이 아니라 이걸로 인식됐다는 걸 바로 알아볼 수 있게. 맨 앞에 둔다. */}
        {matchNoValue && (
          <span className="scr-search-chip scr-search-chip-matchno">
            #{matchNoValue}
            <button
              type="button"
              className="scr-search-chip-x"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onMatchNoChange?.("")}
              aria-label="경기번호 검색 해제"
            >
              <X size={9} />
            </button>
          </span>
        )}
        {/* 종족 칩도 경기번호 칩과 같은 자리(맨 앞) — 유저 칩과 다른 색(종족 고유색)으로
            구분한다. */}
        {raceValue && (
          <span
            className="scr-search-chip scr-search-chip-race"
            style={{ background: RACE_INFO[raceValue].color }}
          >
            종족: {raceValue}
            <button
              type="button"
              className="scr-search-chip-x"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRaceChange?.(null)}
              aria-label="종족 필터 해제"
            >
              <X size={9} />
            </button>
          </span>
        )}
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
            // 즉시 적용") — 종족은 여기서 인식하지 않는다(자동완성 후보에서 직접
            // 골라야만 종족 칩이 된다), 숫자만 친 단어는 경기번호로, 그 외엔 평범한
            // 검색어로 addChip이 알아서 적용한다.
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
          placeholder={chips.length === 0 && !matchNoValue && !raceValue ? searchPlaceholder : ""}
          autoComplete="off"
        />
      </div>
      {suggestShown && createPortal(
        <div className="scr-pv-drop scr-scroll" ref={dropRef}>
          {matchedSuggestions.map((item, i) => (
            <button
              type="button" key={item.kind === "race" ? `race-${item.race}` : item.name}
              className={cx("scr-pv-opt", i === highlight && "scr-pv-opt-active")}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              {item.kind === "race" ? `종족: ${item.race}` : item.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );

  // 필터창(있으면)과 검색창을 한 덩어리로 묶어 같이 뜬다 — PC는 가로로 나란히, 모바일은
  // 세로로 쌓아 탭바 위에 고정한다(global.css .scr-filter-float-stack). keyboardInset은
  // 이 바깥 스택 전체에 적용해야 필터창까지 같이 키보드 위로 따라 올라온다.
  // 보임 여부는 모바일에서만 이 컴포넌트가 직접 정한다 — 숨는 시점은 탭바와 정확히
  // 같고(tabBarHidden), 다시 보이는 시점은 그보다 까다롭게 맨 위 근처(nearTop)일 때만
  // 이다(요청: "숨겨지는 임계치를 탭바와 똑같이... 동시에 없어지게" + "다시 노출되는
  // 임계치는 더 상단으로"). 포커스 중이면(stackFocused, 위 주석 참고) 이 둘과 무관하게
  // 항상 보인다. 인라인 style로 매번 명시해서 정하며, PC는 애초에 고정 배치가 아니라
  // 문서 흐름 안에 있어 이 스타일을 적용하면 안 되므로 isMobileFloat일 때만 넣는다.
  const mobileVisible = stackFocused || (!tabBarHidden && nearTop);
  // .scr-main의 하단 padding(이 알약과 안 겹치게 마지막 줄을 미리 띄워두는 예약분)이
  // 예전엔 "필터창이 있는 화면 기준"으로 고정돼 있어서, 알약 자체가 스크롤로 숨어도
  // (탭바처럼) 그 예약 공간은 그대로 남아 화면 아래쪽이 실제로는 다 안 쓰이고 놀았다
  // (요청: "탭바가 가려진 경우 사파리나 PWA에서 화면 최하단까지 전부 활용했으면
  // 좋겠는데"). 지금 이 화면(활성 인스턴스)이 실제로 필요로 하는 예약량을 그때그때
  // CSS 변수로 발행해서, .scr-main이 알약과 정확히 같은 순간에 여백을 접었다 펼 수
  // 있게 한다 — 검색창만 있으면 82px(20+62), 필터창까지 있으면 156px(82+66+8), 알약
  // 자체가 숨어 있으면 0.
  useEffect(() => {
    if (!isMobileFloat || !isVisible) return;
    const reserved = mobileVisible ? (filterPanel ? 156 : 82) : 0;
    document.documentElement.style.setProperty("--mobile-filterstack-space", `${reserved}px`);
  }, [isMobileFloat, isVisible, mobileVisible, !!filterPanel]);
  const stackEl = (
    <div
      className="scr-filter-float-stack"
      style={{
        ...(keyboardInset > 0 ? { bottom: keyboardInset + 10 } : undefined),
        ...(isMobileFloat ? {
          opacity: mobileVisible ? 1 : 0,
          transform: mobileVisible ? "none" : "scale(0.92)",
          pointerEvents: mobileVisible ? "auto" : "none",
        } : undefined),
      }}
      onFocus={() => setStackFocused(true)}
      onBlur={(e) => {
        // 포커스가 이 스택 안의 다른 요소(검색창 -> 필터 라디오 등)로 옮겨가는 중이면
        // relatedTarget이 여전히 이 안에 있다 — 그럴 땐 아직 벗어난 게 아니니 유지한다.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setStackFocused(false);
      }}
    >
      {filterPanel && <div className="scr-filter-panel">{filterPanel}</div>}
      <div className="scr-search-filter-float">{searchItem}</div>
    </div>
  );

  return (
    <div className="scr-filter-bar" ref={containerRef}>
      {/* 통합검색은 그냥 단순한 인풋창 하나다(요청: "그냥 단순한 인풋창 모양이면
          좋겠어"). PC는 필터창(왼쪽)+검색창(오른쪽)이 화면 가운데 문서 흐름 안에 그냥
          있고, 모바일은 진짜 position:fixed로 하단 탭바 위에 뜬다(단 #scroll-root
          밖으로 포털링 — 위 isMobileFloat/isVisible 주석 참고). */}
      {isMobileFloat
        ? isVisible && createPortal(stackEl, document.getElementById("scr-app") ?? document.body)
        : stackEl}
      <span className="scr-list-count">{count}{countLabel}</span>
    </div>
  );
}
