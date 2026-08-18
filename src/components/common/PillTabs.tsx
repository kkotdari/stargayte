import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../utils/format";

interface PillTabsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  /** 내용 폭 칸(요청: 재생기 라디오의 옵션 간 갭 축소) — 균등폭 대신 라벨만큼만
   *  차지한다. 인디케이터는 균등폭 가정이 깨지므로 실제 DOM 위치를 잰다. */
  fit?: boolean;
  /** 스위치로 쓰기(요청: "값이 2개인 것들은 라디오보다 토글을 적용해서 아무데나
   *  클릭해도 전환되게") — 옵션이 둘일 때만 켜진다. 트랙 어디를 눌러도 반대쪽으로
   *  넘어가므로, 고른 쪽을 다시 눌러도 전환된다. 셋 이상이면 무시한다(어느 쪽으로
   *  넘길지 정할 수 없다). */
  toggle?: boolean;
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
export default function PillTabs<T extends string>({ options, value, onChange, fit = false, toggle = false, ...rest }: PillTabsProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  /* 스위치 모드 — 손잡이는 트랙 하나뿐이다(요청). 버튼에는 onClick을 안 달고 트랙에만
     다는 이유는 두 번 도는 것을 막기 위해서다: 버튼에도 달면 버튼 클릭이 트랙까지
     거품처럼 올라와 두 번 넘어가고 결국 제자리로 돌아온다. 버튼은 그대로 <button>이라
     키보드(Enter·Space)도 click 이벤트를 내고, 그 이벤트가 트랙에 닿아 똑같이 넘어간다. */
  const isToggle = toggle && options.length === 2;
  const flip = (): void => { onChange(options[index === 0 ? 1 : 0].value); };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  /* 인디케이터가 딴 칸에 가 있던 문제(지적: 배속 알약 — 알약이 ×2가 아니라 ×1·×2
     사이에 걸쳐 있었다). 원인은 '한 번 재고 끝'이었다: 마운트 직후 useLayoutEffect가
     재는 시점엔 아직 웹폰트가 안 붙어 대체 글꼴 폭으로 칸이 잡힌다. 폰트가 바뀌면
     max-content 칸 폭이 전부 달라지는데, 고른 값이 처음 그대로면(기본값을 한 번도
     안 누른 라디오가 그렇다) 인디케이터만 옛 자리에 남는다.
     이제 폭이 변할 수 있는 모든 계기에 다시 잰다 — 트랙·버튼의 크기 변화(ResizeObserver)
     와 폰트 적재 완료(document.fonts.ready). 자리는 offsetLeft 대신 화면 사각형 차로
     잡는다: offsetLeft는 offsetParent의 '테두리 상자' 기준이고 인디케이터의 left는
     '패딩 상자' 기준이라, 트랙의 padding 1px만큼 어긋나 있었다(clientLeft로 뺀다). */
  useLayoutEffect(() => {
    if (!fit) return undefined;
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const measure = (): void => {
      const el = wrap.querySelector<HTMLButtonElement>(".scr-pill-tab-btn-active");
      if (!el) return;
      const wr = wrap.getBoundingClientRect();
      const br = el.getBoundingClientRect();
      if (br.width <= 0) return;
      const left = br.left - wr.left - wrap.clientLeft;
      setInd((prev) => (prev && Math.abs(prev.left - left) < 0.5
        && Math.abs(prev.width - br.width) < 0.5 ? prev : { left, width: br.width }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    wrap.querySelectorAll(".scr-pill-tab-btn").forEach((b) => ro.observe(b));
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); }).catch(() => {});
    return () => { live = false; ro.disconnect(); };
  }, [fit, value, options.length]);
  return (
    <div
      ref={wrapRef}
      className={cx("scr-pill-tabs", isToggle && "scr-pill-tabs-toggle")}
      role="tablist"
      aria-label={rest["aria-label"]}
      onClick={isToggle ? flip : undefined}
      style={{
        gridTemplateColumns: fit
          ? `repeat(${options.length}, max-content)`
          : `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      <span
        className="scr-pill-tabs-indicator"
        style={fit
          ? ind
            ? { width: ind.width, left: ind.left, transform: "none" }
            : { opacity: 0 }
          : { width: `calc((100% - 2px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx("scr-pill-tab-btn", o.value === value && "scr-pill-tab-btn-active")}
          onClick={isToggle ? undefined : () => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
