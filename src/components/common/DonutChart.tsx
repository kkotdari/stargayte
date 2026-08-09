// 표 칸 안에 들어가는 작은 도넛(요청: 통계 생산 칸에 도넛 넷).
//
// 이 그림이 답하는 것은 "무엇이 얼마나였나"의 구성비 하나뿐이라, 조각은 둘이나 셋이고
// 축도 눈금도 없다. 대신 글을 그림 안에 직접 넣는다(요청) — 도넛 이름은 가운데 구멍에,
// 조각 이름(생산/방어·기본/고급/마법·지상/공중)은 제 조각 띠 위에. 색만으로 뜻을 전하지
// 않기 위한 장치이기도 하다.
//
// 이름은 조각이 아무리 가늘어도 그린다(요청: 칸이 좁아도 삐져나오게라도). 한때는 담기는지
// 재서 못 담는 조각의 이름을 생략했는데, 그러면 "마법 유닛을 거의 안 뽑았다"처럼 조각이
// 작다는 것 자체가 이야기인 경우에 그 이름이 사라졌다. 옆 조각까지 글자가 넘어가는 건
// 감수하고(그래서 title에 정확한 수치가 그대로 남아 있다), 그림 밖으로 나가 잘리는 것만
// 막는다.
//
// 색은 조각 순서에 고정으로 붙는다 — 도넛들이 같은 순서를 쓰므로 첫 조각(생산·기본·지상·
// 초반)은 어느 도넛에서나 같은 색이다. 남는 색을 돌려 쓰지 않는다.

export interface DonutSlice {
  /** 조각 이름 — 글로 적히는 값이라 색과 별개로 뜻을 진다. */
  label: string;
  value: number;
  /** 견줄 기간(전달)의 같은 조각 값 — 있으면 조각 이름 밑에 구성비 변동을 적는다(요청).
   *  적는 값은 원값의 차가 아니라 '몇 %p 움직였나'다: 원값은 그 달에 얼마나 뛰었느냐에
   *  통째로 끌려다녀서, 똑같이 절반씩 뽑아도 판수만 늘면 큰 수가 된다. 도넛이 말하는 것도
   *  구성비 하나뿐이라 변동도 같은 자로 재야 한다. */
  prev?: number;
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

  /* 견줄 기간의 합 — 구성비 변동을 재려면 그쪽도 제 전체로 나눠야 한다. 한 조각이라도
     prev가 오면 그 도넛은 변동을 그리는 도넛이다(안 온 조각은 0으로 친다 — 그 달에 아예
     안 나온 것이니 실제로 0이 맞다). 전달이 통째로 비었으면(합 0) 견줄 것이 없어 안 그린다. */
  const hasPrev = slices.some((s) => typeof s.prev === "number");
  const prevTotal = slices.reduce((n, s) => n + (s.prev ?? 0), 0);

  // 조각을 돌면서 그릴 것(호)과 적을 것(띠 위 글자 / 아래로 뺀 글자)을 한 번에 정한다.
  const segs: { key: string; idx: number; dash: number; offset: number }[] = [];
  const onBand: { key: string; x: number; y: number; text: string; delta: string | null }[] = [];
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
    /* 자리가 모자라도 이름은 그린다(요청: 칸이 좁아도 삐져나오게라도 나오게) — 조각이
       가늘면 이름을 생략했었는데, 그러면 정작 "이 사람은 마법 유닛을 거의 안 뽑았다"처럼
       조각이 작다는 사실 자체가 이야기인 경우에 그 이름이 사라졌다. 대신 그림 밖으로
       나가 잘리는 일만 막는다 — svg는 기본이 overflow:hidden이라 나간 만큼은 아예 안
       보인다. 가장자리에서 EDGE만큼 안쪽까지 밀어 넣고, 그 이상은 밀지 않는다. */
    const px = cx + r * Math.cos(th);
    const py = cx + r * Math.sin(th);
    const fx = Math.min(Math.max(px, w / 2 + EDGE), size - w / 2 - EDGE);
    const fy = Math.min(Math.max(py, h / 2 + EDGE), size - h / 2 - EDGE);
    /* 구성비가 지난달보다 몇 %p 움직였나(요청) — 1%p도 안 되게 움직인 것은 안 적는다.
       반올림해서 0이 되는 값에 "+0"을 달면 '안 변했다'와 구별이 안 되는 데다, 도넛마다
       조각마다 0이 늘어서면 정작 크게 움직인 조각이 묻힌다. */
    const dPt = hasPrev && prevTotal > 0
      ? Math.round(f * 100) - Math.round(((s.prev ?? 0) / prevTotal) * 100)
      : 0;
    onBand.push({
      key: s.label, x: fx, y: fy, text: s.label,
      delta: dPt === 0 ? null : `${dPt > 0 ? "+" : ""}${dPt}`,
    });
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
        {/* 이름 바로 밑에 전달 대비 구성비 변동(요청) — 이름과 한 덩어리로 읽히도록 같은
            x에 한 줄 아래로 놓고, 값이 아니라 값에 붙는 단서라 더 작고 흐리게 그린다.
            띠 밖으로 반쯤 나가도 그대로 둔다(이름과 같은 규칙) — 나간 쪽은 구멍이나 바탕이라
            아무것도 안 가린다. */}
        {onBand.map((l) => (l.delta ? (
          <text
            key={`d-${l.key}`} className="scr-donut-band-delta"
            x={l.x} y={l.y + labelFs * 0.95} fontSize={labelFs * 0.82}
            textAnchor="middle" dominantBaseline="central"
          >
            {l.delta}
          </text>
        ) : null))}
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
