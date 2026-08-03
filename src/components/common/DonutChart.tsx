// 표 칸 안에 들어가는 아주 작은 도넛(요청: 통계 생산 칸에 도넛 셋).
//
// 이 그림이 답하는 것은 "무엇이 얼마나였나"의 구성비 하나뿐이라, 조각은 둘이나 셋이고
// 축도 눈금도 없다. 대신 두 가지를 반드시 글로 함께 준다 — 가장 큰 조각의 이름과 비율을
// 그림 밑에 직접 적고(색만으로 뜻을 전하지 않기 위해서다), 조각마다의 실제 수치는
// title로 붙인다(좁은 칸이라 범례를 다 펼칠 자리가 없다).
//
// 색은 조각 순서에 고정으로 붙는다 — 도넛 셋이 같은 순서를 쓰므로 첫 조각(생산·기본·지상)
// 은 어느 도넛에서나 같은 색이다. 남는 색을 돌려 쓰지 않는다.

import { cx } from "../../utils/format";

export interface DonutSlice {
  /** 조각 이름 — 글로 적히는 값이라 색과 별개로 뜻을 진다. */
  label: string;
  value: number;
}

interface DonutChartProps {
  /** 도넛 자체의 이름(건물/병력/지형) — 그림 밑 첫 줄. */
  title: string;
  slices: DonutSlice[];
  /** 지름(px). 표 칸에 들어가는 값이라 부르는 쪽이 정한다. */
  size?: number;
}

/** 조각 색 — 검증된 순서다(dataviz 팔레트 슬롯 1·2·3). 라이트/다크 값은 CSS 변수로
 *  갈아 끼운다(.scr-donut-seg-N). 여기서는 순번만 정한다. */
const SEG_MAX = 3;

export default function DonutChart({ title, slices, size = 44 }: DonutChartProps) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const top = [...slices].sort((a, b) => b.value - a.value)[0];
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  // 링의 굵기와 반지름 — 44px 안에서 가운데가 뚫려 보이되 조각 색이 충분히 읽히는 값.
  const stroke = Math.max(5, Math.round(size * 0.26));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  /* 조각 사이 2px 틈 — 붙여 그리면 비슷한 색끼리 한 덩어리로 읽힌다. 조각이 하나뿐이면
     틈을 낼 곳이 없으므로(원 하나가 잘려 보인다) 그때는 0으로 둔다. */
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let acc = 0;
  return (
    <div className="scr-donut" title={`${title} — ${slices.map((s) => `${s.label} ${s.value}`).join(" / ")}`}>
      <svg className="scr-donut-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="scr-donut-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {total > 0 && slices.slice(0, SEG_MAX).map((s, i) => {
          const len = (s.value / total) * c;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={s.label}
              className={cx("scr-donut-seg", `scr-donut-seg-${i + 1}`)}
              cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
              strokeDasharray={`${dash} ${c - dash}`}
              // 12시부터 시계방향 — 첫 조각이 늘 같은 자리에서 시작해야 여러 줄을 훑을 때
              // 눈이 기준을 잃지 않는다.
              strokeDashoffset={-acc}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          acc += len;
          return el;
        })}
      </svg>
      <span className="scr-donut-name">{title}</span>
      {/* 가장 큰 조각을 글로 직접 적는다 — 색만으로는 뜻이 안 선다. */}
      <span className="scr-donut-lead">
        {total > 0 && top ? `${top.label} ${pct(top.value)}%` : "-"}
      </span>
    </div>
  );
}
