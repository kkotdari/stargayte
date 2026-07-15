import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { attachPopover } from "../../utils/popover";
import { cx } from "../../utils/format";
import { useIsNarrow } from "../../utils/useIsNarrow";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { BASE_RACES, RACE_INFO } from "../../constants/races";
import type { BaseRace } from "../../types";

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

// 모바일 플로팅 알약(단일 행)이 지금 무엇을 보여주는지 — 접힘(아이콘 두 개)/필터창/검색창
// 셋 중 하나다. 필터와 검색이 각자 줄을 갖고 독립적으로 접혔다 펴지던 구조에서, 한 줄을
// 두 창이 나눠 쓰는(교체되는) 구조로 바꿨다(요청: "현재 필터창 자리는 이제 사용하지 않고
// 검색창 자리에 필터/검색창이 교체되는 방식"). 전환 애니메이션은 JS 타이머 없이 전부
// CSS 트랜지션이다 — 필터/검색 두 개체(.scr-fs-obj)가 항상 마운트된 채 상태 클래스에
// 따라 left/width만 바뀌므로, 아이콘(원)이 미끄러지며 창(캡슐)으로 펼쳐지고 창은
// 줄어들며 아이콘으로 되돌아간다(요청: "활성되는 아이콘이 앞에 배치되면서 창으로
// 펼쳐지는 트랜스폼. 비활성되는 요소는 아이콘으로 트랜스폼").
type MobilePanel = "filter" | "search" | "none";

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
  // 관찰해서, 이 알약도 탭바와 정확히 같은 순간에 숨고 같은 순간에 다시 보인다(요청:
  // "아래로 스크롤시: 탭바 숨겨짐... / 위로 스크롤시: 탭바 및 필터/검색 노출 / 페이지
  // 최하단 도달시: 탭바 및 필터/검색 노출" — 맨 위뿐 아니라 맨 아래에서도 탭바와
  // 똑같이 노출돼야 하므로, 더 이상 "맨 위 근처"만 따로 계산하지 않고 탭바 노출
  // 여부를 그대로 따라간다).
  const [tabBarHidden, setTabBarHidden] = useState(
    () => document.documentElement.classList.contains("scr-scroll-hide"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setTabBarHidden(el.classList.contains("scr-scroll-hide")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  // 모바일 전용 — 한 줄을 필터창/검색창이 나눠 쓴다(요청: "현재 필터창 자리는 이제
  // 사용하지 않고 검색창 자리에 필터/검색창이 교체되는 방식"). 화면 첫 진입시엔 필터가
  // 열린 채로 시작하고(요청: "페이지 진입시 기본은 필터가 열려있음" — 필터가 없는
  // 화면이면 검색), 펼쳐진 동안 왼쪽 아이콘 자리에 반대 기능의 아이콘이 떠서 누르면
  // 그 창으로 바로 교체된다(요청: "클릭하지 않은 다른 기능의 아이콘이 아이콘 자리에
  // 나타나는 방식"). 아래로 스크롤해 숨을 때는 아이콘 모양으로 접히고 나서 숨는다
  // (요청: "필터/검색은 아이콘으로 트랜스폼되며 숨겨짐") — 아래 effect가 숨는 순간
  // (mobileVisible이 false가 될 때)마다 강제로 접는다.
  const [panel, setPanel] = useState<MobilePanel>(filterPanel ? "filter" : "search");
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
  const stackRef = useRef<HTMLDivElement>(null);
  // 탭바는 그대로 두고 필터/검색만 접는다(요청: "터치시 탭바는 그대로 필터랑 검색창만
  // 접기" — 탭바를 스크롤 숨김 신호와 함께 묶었던 첫 시도는 되돌렸다) — 이 스택
  // 바깥(페이지의 다른 어디든)을 누르면 어느 상황이든 곧바로 아이콘으로 접힌다(요청:
  // "필터는 초기화면에서 펼쳐있다가 페이지 선택(클릭/터치시) 자동으로 접히게" + "어느
  // 상황이든 페이지에 포커싱 가면 필터랑 검색창은 아이콘으로"). 스크롤로 숨을 때와
  // 똑같이(요청: "아래로 스크롤 할때처럼") 그 트랜지션을 그대로 탄다.
  useEffect(() => {
    // 이 컴포넌트를 마운트시킨 바로 그 탭 이벤트를 걸러낸다 — 탭바가 pointerdown 시점에
    // 화면을 전환하므로(MobileTabBar 참고), 새 화면의 이 리스너가 등록된 뒤에도 그
    // pointerdown이 document까지 마저 버블링해 그대로 잡혀서 화면에 들어오자마자 알약이
    // 접혀버렸다(실제로 지적받은 문제 — "화면 진입시 바로 필터/검색창 닫히는 문제").
    // 이벤트 발생 시각이 리스너 등록 시각보다 앞서면(=마운트 전에 시작된 탭) 무시한다.
    const mountedAt = performance.now();
    const onPointerDown = (e: PointerEvent) => {
      if (e.timeStamp <= mountedAt) return;
      if (stackRef.current?.contains(e.target as Node | null)) return;
      setPanel("none");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

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
  // 보임 여부는 모바일에서만 이 컴포넌트가 직접 정한다 — 탭바와 정확히 같은 순간에
  // 숨고 같은 순간에 보인다(맨 위/맨 아래 둘 다, 위 tabBarHidden 주석 참고). 포커스
  // 중이면(stackFocused) 이 조건과 무관하게 항상 보인다. 인라인 style로 매번 명시해서
  // 정하며, PC는 애초에 고정 배치가 아니라 문서 흐름 안에 있어 이 스타일을 적용하면
  // 안 되므로 isMobileFloat일 때만 넣는다.
  const mobileVisible = stackFocused || !tabBarHidden;

  // 숨는 순간엔 펼쳐져 있었어도 아이콘 모양으로 되접는다(요청: "필터/검색은 아이콘으로
  // 트랜스폼되며 숨겨짐") — 포커스 중엔 애초에 mobileVisible이 계속 true라 숨지
  // 않으므로, 타이핑 중에 뜬금없이 접히는 일은 없다.
  useEffect(() => {
    if (!mobileVisible) setPanel("none");
  }, [mobileVisible]);

  const expandedContent = (
    <>
      {filterPanel && <div className="scr-filter-panel">{filterPanel}</div>}
      <div className="scr-search-filter-float">{searchItem}</div>
    </>
  );

  // 이 버튼을 누르면 onFocus(컨테이너)가 먼저 stackFocused를 true로 만드는데, 그 직후
  // 상태 변경으로 이 버튼 자신이 통째로 언마운트돼 버려서 blur가 정상적으로 발생하지
  // 못해(제거되는 엘리먼트의 blur 타이밍은 브라우저마다 신뢰할 수 없다) stackFocused가
  // true로 영영 눌어붙는 버그가 있었다(실제로 재현: 한 번 펼치고 나면 그 뒤로는 탭바가
  // 스크롤로 숨어도 이 알약만 계속 떠 있었다) — 펼치는 순간엔 항상 최근에 상호작용한
  // 직후라 tabBarHidden이 어차피 false이므로, 여기서 명시적으로 false로 되돌려도 화면이
  // 사라지지 않는다. 펼쳐진 뒤 실제 입력칸에 포커스가 가면 그 포커스는 언마운트되지
  // 않는 안정된 엘리먼트라 onFocus/onBlur가 정상 동작한다.
  const openFilter = () => { setStackFocused(false); setPanel("filter"); };
  const openSearch = () => { setStackFocused(false); setPanel("search"); };

  // 한 줄에 아이콘(원)과 활성화된 창(캡슐)이 별도 개체로 나란히 놓인다(요청: "아이콘과
  // 활성화된 창은 별도 개체야 구분되어야하고 아이콘 모양과 색은 원래대로 유지") — 필터/
  // 검색 두 개체(.scr-fs-obj)를 항상 마운트해두고 상태 클래스(slot0/slot1/panel)로
  // left/width만 바꾼다. CSS 트랜지션이 그 사이를 이어주므로:
  //  - 교체 시: 왼쪽 앞자리의 아이콘이 오른쪽으로 미끄러지며 창으로 펼쳐지고, 기존 창은
  //    줄어들며 아이콘이 되어 왼쪽 앞자리로 이동한다 — 두 개체가 교차한다(요청: "활성되는
  //    아이콘이 앞에 배치되면서 창으로 펼쳐지는 트랜스폼. 비활성되는 요소는 아이콘으로
  //    트랜스폼" + "비활성창은 왼쪽으로 아이콘이 되어 이동").
  //  - 닫힘 시: 열려 있던 창이 아이콘으로 수축해 제자리로 돌아가고, 접힌 순서는 항상
  //    [필터][검색] 고정이다(요청: "순서는 무조건 필터가 왼쪽 검색이 오른쪽") — 예컨대
  //    검색창이 열려 있었다면(앞엔 필터 아이콘) 검색창이 오른쪽 자리(slot1) 아이콘으로
  //    줄어들며 앉고, 필터 아이콘은 그대로 앞(slot0)에 남는다. 필터창이 열려 있었다면
  //    필터창이 앞(slot0) 아이콘으로 수축하며 앞에 있던 검색 아이콘과 자리를 바꾼다
  //    (요청: "두 아이콘 자리 바꿈이 자연스럽고 아름답게").
  // 원(50px)과 캡슐 모두 반경 25px라 모양 전환에 반경 애니메이션이 따로 필요 없다.
  // 배경색은 개체에 붙어 있어(필터=글라스, 검색=흰색) 모핑 내내 그대로 유지된다.
  const objClass = (kind: "filter" | "search"): string => {
    if (panel === kind) return "scr-fs-obj-panel";
    if (panel !== "none") return "scr-fs-obj-slot0"; // 반대 창이 열려 있음 — 내가 왼쪽 앞 아이콘
    // 접힘 — 항상 필터가 앞(slot0), 검색이 옆(slot1). 필터가 없는 화면이면 검색이 앞.
    return kind === "filter" || !filterPanel ? "scr-fs-obj-slot0" : "scr-fs-obj-slot1";
  };

  // 접혔을 때 보이지 않는 나머지 공간까지 이 줄 자신의 너비로 잡혀 있으면, 그 빈 자리가
  // 여전히 pointer-events를 먹어 스크롤 제스처가 거기서 시작되면 씹혔다(실제로 지적받은
  // 문제 — "접혔을때 원래 펼쳐있었던 부분에 터치스크롤이 안됨") — 줄(좌표 기준 컨테이너,
  // 항상 100% 폭)은 pointer-events:none으로 두고 두 개체만 auto로 받는다(global.css).
  // 숨김(스크롤) 상태에서는 개체까지 함께 꺼야 하므로 클래스로 한 번에 내린다.
  const mobileRow = (
    <div
      className={cx("scr-filter-search-row", !mobileVisible && "scr-filter-search-row-off")}
      style={{
        opacity: mobileVisible ? 1 : 0,
        transform: mobileVisible ? "none" : "scale(0.92)",
      }}
    >
      {filterPanel && (
        <div className={cx("scr-fs-obj", "scr-fs-shell-filter", objClass("filter"))}>
          <button
            type="button" className="scr-fs-glyph" onClick={openFilter}
            aria-label={panel === "none" ? "필터 열기" : "필터로 전환"}
            tabIndex={panel === "filter" ? -1 : 0}
          >
            <SlidersHorizontal size={16} />
          </button>
          <div className="scr-fs-obj-content">
            <div className="scr-filter-panel">{filterPanel}</div>
          </div>
        </div>
      )}
      <div className={cx("scr-fs-obj", "scr-fs-shell-search", objClass("search"))}>
        <button
          type="button" className="scr-fs-glyph" onClick={openSearch}
          aria-label={panel === "none" ? "검색 열기" : "검색으로 전환"}
          tabIndex={panel === "search" ? -1 : 0}
        >
          <Search size={16} />
        </button>
        <div className="scr-fs-obj-content">
          <div className="scr-search-filter-float">{searchItem}</div>
        </div>
      </div>
    </div>
  );

  const stackEl = (
    <div
      className="scr-filter-float-stack"
      ref={stackRef}
      style={keyboardInset > 0 ? { bottom: keyboardInset + 10 } : undefined}
      onFocus={() => setStackFocused(true)}
      onBlur={(e) => {
        // 포커스가 이 스택 안의 다른 요소(검색창 -> 필터 라디오 등)로 옮겨가는 중이면
        // relatedTarget이 여전히 이 안에 있다 — 그럴 땐 아직 벗어난 게 아니니 유지한다.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setStackFocused(false);
      }}
    >
      {isMobileFloat ? mobileRow : expandedContent}
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
