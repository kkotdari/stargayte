import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRef } from "react";
import { cx } from "../../utils/format";

interface SlideBarProps {
  /** 바 머리에 붙는 이름 — "각도"·"배속". */
  title: string;
  /** **위에서 아래 차례**로 준다 — 맨 앞 원소가 바의 꼭대기 눈금이다. */
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  /** 눈금이 치우치는 쪽 — 눈금 값을 바 아래로 옮긴 뒤로는 자리에 영향을 주지 않지만,
   *  좌우 바를 구분하는 클래스로 남겨 둔다(둘의 미세 조정을 따로 걸 수 있게). */
  labelSide?: "left" | "right";
  "aria-label": string;
}

/* 세로 슬라이드 바(요청: "슬라이드 바를 말한건데 위치도 맵 좌우여야하고 / 슬라이드바에
   눈금있고 아주 작게 라벨링") — 알약 라디오가 아니라 손잡이가 미끄러지는 바다.

   값이 연속이 아니므로(요청: "연속값은 아니고") 손잡이는 늘 눈금에 달라붙는다: 누르거나
   끄는 동안에도 가장 가까운 눈금으로 바로 잡히고, 그 사이에는 머물지 않는다.

   <input type=range>를 세우지 않고 직접 그린 이유는 세로 range의 방향·눈금·라벨이
   브라우저마다 다르게 나오기 때문이다. 여기서는 눈금과 라벨이 곧 이 컨트롤의 본체라
   (요청: 눈금·아주 작은 라벨) 자리를 우리가 정확히 알아야 한다. */
export default function SlideBar({
  title, options, value, onChange, labelSide = "right", ...rest
}: SlideBarProps) {
  const n = options.length;
  /* 가장 긴 값 글자 수 — 값 칸의 자리를 이만큼 잡아 둔다(아래 주석). */
  const widest = options.reduce((m, o) => Math.max(m, o.label.length), 1);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const trackRef = useRef<HTMLDivElement>(null);
  /** 세로 자리(0~1, 위가 0)를 가장 가까운 눈금으로 잡는다.
   *  snap이면 어디를 눌러도 가장 가까운 눈금으로 곧장 간다(누를 때). */
  const pick = (clientY: number, snap: boolean): void => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    /* 값은 **눈금에 닿았을 때** 바뀐다(지적: "그 눈금에 도착하면 그때 딱 바뀌는건데
       원래") — 여태 가장 가까운 눈금으로 반올림했더니 두 눈금의 **한가운데**를 지나는
       순간 값이 넘어갔다. 손잡이는 아직 옛 눈금에 붙어 있는데 화면(각도·배속)만 먼저
       바뀌니 '미끄러진다'는 느낌이 든다. 눈금에서 ±0.28칸 안에 들어와야 넘긴다 —
       그 사이 구간에서는 옛 값이 그대로다.
       ★ 다만 그 문턱은 **끄는 동안**의 규칙이다(지적: "슬라이드 잘 안집혀") — 톡 누른
         자리가 두 눈금 사이면 아무 일도 안 일어나 컨트롤이 죽은 것처럼 느껴졌다. 손가락
         기기에서는 한 칸이 39px이라 그 '죽은 띠'가 17px이나 된다. 누를 때는 문턱 없이
         가장 가까운 눈금으로 붙인다 — 끌기의 차분함은 그대로 두고 탭만 살린다. */
    const raw = f * (n - 1);
    const i = Math.round(raw);
    if (!snap && Math.abs(raw - i) > 0.28) return;
    if (options[i] && options[i].value !== value) onChange(options[i].value);
  };
  const onDown = (e: ReactPointerEvent): void => {
    /* 지도 위에 얹혀 있으므로 손짓을 여기서 끊는다 — 안 그러면 같은 누름이 지도의
       끌기(확대 이동)로도 읽힌다. */
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pick(e.clientY, true);
  };
  const onMove = (e: ReactPointerEvent): void => {
    if (!(e.buttons & 1)) return;
    e.stopPropagation();
    pick(e.clientY, false);
  };
  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    /* 창(window)에 걸린 ↑↓(배속)까지 올라가면 각도 바를 만지는데 배속이 함께 바뀐다. */
    e.stopPropagation();
    const ni = e.key === "ArrowUp" ? Math.max(0, index - 1) : Math.min(n - 1, index + 1);
    if (ni !== index) onChange(options[ni].value);
  };
  const at = (i: number): string => `${(i / (n - 1)) * 100}%`;
  return (
    <div className={cx("scr-slidebar", `scr-slidebar-${labelSide}`)}>
      <span className="scr-slidebar-title">{title}</span>
      <div
        ref={trackRef}
        className="scr-slidebar-track"
        role="slider"
        tabIndex={0}
        aria-label={rest["aria-label"]}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={n - index}
        aria-valuetext={options[index]?.label}
        aria-orientation="vertical"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKeyDown}
      >
        <span className="scr-slidebar-rail" />
        {options.map((o, i) => (
          <span key={o.value} className="scr-slidebar-tickwrap" style={{ top: at(i) }}>
            <i className={cx("scr-slidebar-tick", i === index && "scr-slidebar-tick-on")} />
          </span>
        ))}
        <span className="scr-slidebar-thumb" style={{ top: at(index) }} />
      </div>
      {/* 눈금마다 값을 적지 않고 **고른 값 하나만 바 아래**에 적는다(요청) — 여섯 개
          라벨이 레일 옆에 늘어서느라 바 폭의 대부분을 라벨이 먹고 있었다. 값이 한 자리에
          고정되면 바는 눈금과 손잡이만 남아 얇아지고, 지금 값은 오히려 크게 읽힌다.
          ★ 자리는 **가장 긴 값만큼 미리 잡아 둔다**(지적: 슬라이드바 폭이 왔다 갔다 함) —
            ×1에서 ×20으로, 5°에서 30°로 넘어갈 때 글자가 한 칸 늘면서 바 전체가 그만큼
            넓어졌다 좁아졌다 했다. 지도 위에 얹힌 조작부라 그 흔들림이 곧장 눈에 띈다. */}
      <span className="scr-slidebar-value" style={{ minWidth: `${widest}ch` }}>
        {options[index]?.label}
      </span>
    </div>
  );
}
