import { cx } from "../../utils/format";

interface PillTabsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}

// 라디오 선택을 슬라이딩 알약 인디케이터로 보여주는 공용 세그먼트 컨트롤 — 필터창(새
// 글라스 패널)과 랭킹의 일대일/팀 선택이 함께 쓴다. 옵션이 몇 개든 grid의 균등폭
// (repeat(N, 1fr))만으로 인디케이터 위치/폭을 계산해, 탭바(MobileTabBar)처럼 실제 DOM
// 폭을 재는 방식이 필요 없다 — 항상 균등폭인 용도로만 쓰인다.
// 1fr은 실제로 minmax(auto, 1fr)라, 라벨 길이가 서로 다르면(회원 화면: 전체/승인대기/
// 활성/정지/탈퇴) 긴 라벨("승인대기")의 칸이 자기 내용 폭만큼 더 넓어지고 짧은 라벨
// ("활성"/"정지")의 칸은 상대적으로 좁아져 실제 칸 폭이 서로 달라진다 — 인디케이터는
// 항상 "균등폭"이라고 가정하고 계산하므로 그 칸에서만 알약이 버튼 가운데에 안 맞아
// 보였다(실제로 지적받은 문제 — "활성/정지가 가운데가 안맞음"). minmax(0, 1fr)로
// content 기반 최소폭을 없애 라벨 길이와 무관하게 모든 칸이 진짜 균등폭이 되게 한다.
export default function PillTabs<T extends string>({ options, value, onChange, ...rest }: PillTabsProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className="scr-pill-tabs"
      role="tablist"
      aria-label={rest["aria-label"]}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        className="scr-pill-tabs-indicator"
        style={{ width: `calc((100% - 2px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx("scr-pill-tab-btn", o.value === value && "scr-pill-tab-btn-active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
