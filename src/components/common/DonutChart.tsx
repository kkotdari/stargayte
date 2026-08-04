// 표 칸 안에 들어가는 작은 도넛(요청: 통계 생산 칸에 도넛 넷).
//
// 이 그림이 답하는 것은 "무엇이 얼마나였나"의 구성비 하나뿐이라, 조각은 둘이나 셋이고
// 축도 눈금도 없다. 대신 글을 그림 안에 직접 넣는다(요청) — 도넛 이름은 가운데 구멍에,
// 조각 이름(생산/방어·기본/고급/마법·지상/공중)은 제 조각 띠 위에. 색만으로 뜻을 전하지
// 않기 위한 장치이기도 하다.
//
// 띠에 글자를 얹으려면 그 조각이 글자를 담을 만큼 커야 한다. 작은 조각에 억지로 얹으면
// 글자가 옆 조각까지 넘어가 엉뚱한 조각의 이름처럼 읽힌다 — 그래서 담기는지 실제로 재고,
// 못 담는 조각은 이름을 생략한다(요청: 크기·자리 고정, 아래 캡션 생략). 그 조각의 이름과
// 실제 수치는 그림 전체에 붙은 title이 대신 말한다.
//
// 색은 조각 순서에 고정으로 붙는다 — 도넛들이 같은 순서를 쓰므로 첫 조각(생산·기본·지상·
// 초반)은 어느 도넛에서나 같은 색이다. 남는 색을 돌려 쓰지 않는다.

export interface DonutSlice {
  /** 조각 이름 — 글로 적히는 값이라 색과 별개로 뜻을 진다. */
  label: string;
  value: number;
}

interface DonutChartProps {
  /** 도넛 자체의 이름(건물/병력/지형/일꾼) — 가운데 구멍에 적힌다(요청). */
  title: string;
  slices: DonutSlice[];
  /** 지름(px). 표 칸에 들어가는 값이라 부르는 쪽이 정한다. */
  size?: number;
}

/** 조각 색은 순서에 고정이다(dataviz 팔레트 슬롯 1·2·3). 라이트/다크 값은 CSS 변수로
 *  갈아 끼운다(.scr-donut-seg-N) — 여기서는 순번만 정한다. */
const SEG_MAX = 3;
/** 한글 글자 하나의 폭은 대략 글자 크기와 같다(정사각 글립) — 띠에 담기는지 재는 어림자다.
 *  숫자·기호는 이보다 좁으니 이 어림은 늘 안전한 쪽으로 틀린다. */
const GLYPH_W = 1.0;
/** 그림 안으로 밀어 넣을 수 있는 한계(px) — 이보다 더 밀어야 하면 그 자리 글자가 아니다. */
const MAX_NUDGE = 2;
/** 글자와 그림 테두리 사이에 남겨 둘 여백(px) — 도넛이 나란히 서기 때문에 필요하다. */
const EDGE = 3;

export default function DonutChart({ title, slices, size = 76 }: DonutChartProps) {
  const total = slices.reduce((n, s) => n + s.value, 0);

  // 링의 굵기와 반지름 — 가운데 구멍이 이름을 담을 만큼 남으면서 띠도 글자를 담을 만큼
  // 두꺼운 값. 구멍 지름은 size - 2*stroke다.
  const stroke = Math.max(12, Math.round(size * 0.265));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const labelFs = Math.max(9, Math.round(size * 0.125));
  const titleFs = Math.max(9, Math.round(size * 0.145));
  /* 조각 사이 2px 틈 — 붙여 그리면 비슷한 색끼리 한 덩어리로 읽힌다. 조각이 하나뿐이면
     틈을 낼 곳이 없으므로(원 하나가 잘려 보인다) 그때는 0으로 둔다. */
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;

  // 조각을 돌면서 그릴 것(호)과 적을 것(띠 위 글자 / 아래로 뺀 글자)을 한 번에 정한다.
  const segs: { key: string; idx: number; dash: number; offset: number }[] = [];
  const onBand: { key: string; x: number; y: number; text: string }[] = [];
  let acc = 0;
  slices.slice(0, SEG_MAX).forEach((s, i) => {
    if (total <= 0 || s.value <= 0) return;
    const f = s.value / total;
    const len = f * c;
    // 색은 그린 순서가 아니라 조각 순서를 따른다 — 값이 0이라 안 그려진 조각이 있어도
    // 남은 조각의 색이 밀리면 안 된다(기본이 0인 판에서 고급이 파랑이 돼 버린다).
    segs.push({ key: s.label, idx: i, dash: Math.max(0, len - gap), offset: -acc });
    // 조각 한가운데 각도 — 12시에서 시계방향으로 잰다(호를 그리는 rotate(-90)과 같은 기준).
    const th = 2 * Math.PI * (acc / c + f / 2) - Math.PI / 2;
    const w = s.label.length * labelFs * GLYPH_W;
    const h = labelFs;
    /* 글자 상자는 늘 수평이라, 조각이 어느 각도에 있느냐에 따라 필요한 자리가 다르다.
       띠를 따라가는 쪽(접선)으로는 호 길이 안에 들어와야 옆 조각을 안 침범하고, 띠를
       가로지르는 쪽(반지름)으로는 띠 두께를 크게 넘지 않아야 한다. 반지름 쪽만 조금
       느슨하게 두는 건(+6) 몇 px 삐져나오는 건 구멍/바탕이라 아무것도 안 가리기 때문이다. */
    const tangential = Math.abs(Math.sin(th)) * w + Math.abs(Math.cos(th)) * h;
    const radial = Math.abs(Math.cos(th)) * w + Math.abs(Math.sin(th)) * h;
    /* 그림 밖으로 나간 글자는 잘린다(svg의 기본 overflow가 hidden이다). 게다가 도넛들은
       바로 옆에 나란히 서므로, 가장자리에 딱 붙기만 해도 옆 도넛의 링에 닿은 것처럼
       읽힌다(실측: 3시 언저리 "기본"이 옆 도넛 테두리와 붙어 잘린 글자처럼 보였다).
       그래서 테두리에서 EDGE만큼 안쪽까지 들어와야 인정하고, 아주 조금 모자란 것만
       밀어 넣는다(띠가 두꺼워 1~2px 밀어도 여전히 제 조각 위다). */
    const px = cx + r * Math.cos(th);
    const py = cx + r * Math.sin(th);
    const fx = Math.min(Math.max(px, w / 2 + EDGE), size - w / 2 - EDGE);
    const fy = Math.min(Math.max(py, h / 2 + EDGE), size - h / 2 - EDGE);
    const nudged = Math.max(Math.abs(fx - px), Math.abs(fy - py));
    if (tangential <= len * 0.95 && radial <= stroke + 6 && nudged <= MAX_NUDGE) {
      onBand.push({ key: s.label, x: fx, y: fy, text: s.label });
    }
    acc += len;
  });

  return (
    <div
      className="scr-donut"
      title={`${title} — ${slices
        .map((s) => `${s.label} ${s.value}` + (total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ""))
        .join(" / ")}`}
    >
      <svg className="scr-donut-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="scr-donut-track" cx={cx} cy={cx} r={r} strokeWidth={stroke} fill="none" />
        {segs.map((s) => (
          <circle
            key={s.key}
            className={`scr-donut-seg scr-donut-seg-${s.idx + 1}`}
            cx={cx} cy={cx} r={r} strokeWidth={stroke} fill="none"
            strokeDasharray={`${s.dash} ${c - s.dash}`}
            // 12시부터 시계방향 — 첫 조각이 늘 같은 자리에서 시작해야 여러 줄을 훑을 때
            // 눈이 기준을 잃지 않는다.
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        ))}
        {onBand.map((l) => (
          <text
            key={l.key} className="scr-donut-band-label"
            x={l.x} y={l.y} fontSize={labelFs}
            textAnchor="middle" dominantBaseline="central"
          >
            {l.text}
          </text>
        ))}
        {/* 가운데 구멍 — 도넛 이름(요청). 한때 여기에 10분당 값도 함께 적었는데(note),
            이름과 나란히 서서 무엇의 수인지가 섞여 읽혔고 단위를 붙일 자리도 없어
            그림 위로 뺐다(.scr-stat-per10). */}
        <text
          className="scr-donut-center-title"
          x={cx} y={cx} fontSize={titleFs}
          textAnchor="middle" dominantBaseline="central"
        >
          {title}
        </text>
      </svg>
    </div>
  );
}
