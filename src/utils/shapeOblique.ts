/* ── 사선 입체(오블리크) 공통 로직(요청: 표준화해서 매번 고치지 않게) ─────────────────
   지도 위 건물·유닛 벡터는 전부 같은 시점 하나로 그린다. 16×16 뷰박스 기준이다.

   시점 모델 — 3D 모형을 세워 놓고 요잉 −20°, 피칭 +를 준 시점이다(요청):
   · 요잉 − — 모형이 시계로 살짝 돌아, 정면-왼쪽 요소가 카메라 쪽(가깝고 크게), 오른쪽
     요소는 옆·뒤로 물러난다. 방사형 갈래라면: 앞-왼이 짧고 단면 최대, 왼쪽이 가장 긴
     옆모습, 오른쪽은 살짝 뒤라 단면이 없고, 정뒤는 어깨 너머로 빼꼼한다.
   · 피칭 + — 내려다보므로 바닥 원이 납작 타원(GROUND_SQUASH)이 되고, 뒤로 갈수록 화면
     위쪽으로 올라간다. 지면은 화면 아래쪽, 높이는 위쪽.
   · 빛 — 왼쪽 위에서 온다. 윗면이 가장 밝고, 오른쪽 옆면·아랫면이 어둡다.
     모든 3D 요소는 제 그림자를 갖는다(요청) — 뿔·다리·부속까지, 오른쪽 반이 어두워야
     겹친 요소끼리도 구분된다.
   · 깊이 — 바닥에 놓인 원은 세로로 눌린 타원으로 보인다(납작비 기본 0.45 = GROUND_SQUASH).
   · 지상 유닛은 채운 도형, 공중 유닛은 속을 뚫은 도형 — 하늘·땅이 한눈에 갈린다.

   원통 단면(동굴 입구) 규칙 — 해처리 다리에서 다듬어진 결론:
   · 앞(시청자 쪽)으로 뻗은 원통 — 단면 구멍이 크고 또렷하게 정면으로 보인다.
   · 옆으로 뻗은 원통 — 단면이 작게, 뻗는 방향과 직각으로 기울어 보인다.
   · 뒤로 뻗은 원통 — 단면이 반대편을 보므로 아예 안 그린다(둥근 등만 보인다).
   · 무언가(가시 등)가 단면에서 솟으면 입구가 가려지므로 그 다리의 캡은 그리지 않는다.

   감김(winding) 주의 — 해처리 본 기둥과 다리 사이가 자꾸 비던 원인:
   한 path 문자열 안의 부속 도형(M…Z 조각)들이 서로 겹칠 때, 감김 방향이 반대면
   nonzero 채움 규칙이 그 겹침을 구멍으로 뚫는다. 구멍을 내려는 것(공중 유닛의 속)이
   아니면 모든 조각을 같은 방향(시계)으로 감아야 한다. */

/** 겹쳐 그리는 면 하나 — [패스, 불투명도, 색?]. 색을 안 주면 currentColor. */
/** [패스, 불투명도, 색?, 깊이?, 등급?] — 넷째 값은 부품 중심의 화면 깊이(요잉 반영,
 *  +가 시청자 쪽)로, zsorted가 painter 순서를 다시 세우는 열쇠다. 없으면 '직전 부품에
 *  붙은 장식'으로 본다.
 *
 *  다섯째는 부품 등급(LOD, 요청: "형체를 결정하는것(개인색 포함)이 1티어 장식이 2티어
 *  세부포인트 3티어") — 없으면 1이다. **숫자가 작을수록 끝까지 남는다**:
 *    1 형체   작아져도 끝까지 그린다. 없으면 무엇인지 못 알아본다 —
 *             몸통·머리·다리·포신·날개, 그리고 **개인색**(누구 것인지).
 *    2 장식   형체 위에 얹히는 것. 명암(윗면 밝기·옆면 그늘), 덧댄 판, 큰 무늬.
 *    3 세부   가장 작은 것. 원통 단면, 광택 점, 리벳, 데칼, 잔가시. 가장 먼저 빠진다.
 *  걸러 내는 일은 스프라이트를 굽는 순간 딱 한 번 일어난다(unitSprite/buildingSprite) —
 *  프레임마다 재는 것이 아니라, 등급이 캐시 열쇠에 들어가 판이 등급별로 따로 구워진다. */
/** 면 하나 — [경로, 농도, 색?, 깊이 열쇠?, 등급?, 부품 번호?].
 *  ★ 여섯째가 부품 번호다(수리: 각도에 따라 팔·다리가 저·중에서 사라진다) — 넷째(깊이
 *    열쇠)는 **각도마다 값이 달라지는 깊이**라 부품 신원으로 쓸 수 없었다. 등급 매기기
 *    (autoTier)가 그 값의 '같은 값이 이어지는 구간'으로 부품을 묶고 있었는데, 각도가
 *    바뀌면 깊이가 재편돼 묶음이 통째로 달라졌다(실측: 99종 중 74종에서 부품 수가
 *    각도마다 바뀌었고, 러커는 면 45개 고정인데 부품이 13~21개로 흔들렸다). 그래서
 *    같은 팔이 각도마다 다른 등급을 받아 나타났다 사라졌다. 부품 번호는 굽는 각도와
 *    무관하게 '빌더가 몇 번째로 선언한 부품인가'만 말한다. */
export type ShapeFace = [string, number, string?, number?, number?, number?];

/** 부품 등급 — 1(형체)은 기본값이라 아무 데도 안 적는다.
 *  0은 '형체 **확정**'이다(지적: 넥서스 네 기둥처럼 작아도 형태를 만드는 부품이 크기
 *  자동 판정에 밀려 내려갔다) — 자동 판정이 손대지 않고 어느 등급에서도 안 빠진다. */
export const LOD_CORE = 0;
export const LOD_TRIM = 2;
export const LOD_FINE = 3;
/** 이 면들을 '형체 확정(0티어)'으로 못 박는다 — 크기 자동 강등에서 빠진다. */
export function shape(faces: ShapeFace[]): ShapeFace[] {
  return faces.map(([p, o, f, k]) => [p, o, f, k, LOD_CORE] as ShapeFace);
}
/** 이 면들을 '장식(2티어)'으로 매긴다 — 중간 크기부터 빠진다. */
export function trim(faces: ShapeFace[]): ShapeFace[] {
  return faces.map(([p, o, f, k]) => [p, o, f, k, LOD_TRIM] as ShapeFace);
}
/** 이 면들을 '세부(3티어)'로 매긴다 — 가장 먼저 빠진다. */
export function fine(faces: ShapeFace[]): ShapeFace[] {
  return faces.map(([p, o, f, k]) => [p, o, f, k, LOD_FINE] as ShapeFace);
}
/** 등급 q까지만 남긴다(q=3이면 전부). 등급이 없는 면은 형체(1)로 본다.
 *
 *  단 하나 예외 — **개인색 면은 절대 전멸하지 않는다**(지적: "LOD는 낮은 티어에 필수로
 *  개인색 포인트를 넣어야겠네"). 작게 그려질수록 '이게 무엇인가'보다 '누구 것인가'가
 *  더 급한데, 개인색을 포인트(2)로 매겨 두면 하필 그때 사라진다. 그래서 색을 안 준 면
 *  (fill이 없는 = 임자 색이 칠해질 면)들에 한해, 그중 가장 낮은 등급까지는 q를 무시하고
 *  통과시킨다. 모델러가 개인색 띠를 3등급 장식으로 매겨 두어도 형체만 그리는 판에서
 *  그 띠 하나는 살아남는다. */
export function lodFilter(faces: ShapeFace[], q: number): ShapeFace[] {
  if (q >= LOD_FINE) return faces;
  let pcMin = Number.POSITIVE_INFINITY;
  for (const f of faces) if (f[2] === undefined) pcMin = Math.min(pcMin, f[4] ?? 1);
  const pcQ = Number.isFinite(pcMin) ? Math.max(q, pcMin) : q;
  return faces.filter((f) => (f[4] ?? 1) <= (f[2] === undefined ? pcQ : q));
}

/** 표준 농도 눈금 — 면 헬퍼의 기본값. 은은하게/깊게도 이 눈금 안에서 고른다. */
export const OP = {
  top: 0.3, topSoft: 0.22,
  side: 0.3, sideSoft: 0.22, sideDeep: 0.35,
  /** 원통 단면(동굴 입구) — 옆면보다 한 단 어둡다. */
  cap: 0.4,
} as const;

/** 바닥 원의 납작비 — 사선 시점에서 눌려 보이는 정도(ry = rx × 0.45). */
export const GROUND_SQUASH = 0.45;

/* 위에서 본 모드(요청: 입체 아닌 모드에서 에셋을 좀 더 부감으로) — 이 블록 안에서 구우면
   바닥 원은 더 동그랗고(0.66) 높이는 더 낮게(0.6) 투영된다. withYaw와 같은 수법. */
let topView = false;
/* 입체 보기 판(지적: 모델이 맵하고 안 맞음) — 지형이 45도로 기울어 보이므로 모델도
   같은 각으로 굽는다: 바닥 원 납작비·높이 배율 둘 다 cos45(0.71). 표준(0.45/0.89)은
   더 낮은 시점이라 45도 지형 위에서 어긋나 보였다. */
let pitchView = false;
export function withPitchView<T>(fn: () => T): T {
  pitchView = true;
  try {
    return fn();
  } finally {
    pitchView = false;
  }
}
export function withTopView<T>(fn: () => T): T {
  topView = true;
  try {
    return fn();
  } finally {
    topView = false;
  }
}
/* 시점 각 바(요청: PC 세로 바로 각도 5단계) — 입체 판의 바닥 눌림이 이제 고정값이
   아니다. 그리는 쪽(재생기)이 고른 각의 눌림을 여기 내려 주고, 이 판에서 굽는 모델이
   그 값을 쓴다. 기본값 0.52는 여태 붙박이로 있던 수 그대로다(=48도). */
let pitchSquash = 0.52;
export function setPitchSquash(v: number): void {
  pitchSquash = Math.min(0.95, Math.max(0.2, v));
}
/** 지금 유효한 바닥 납작비. */
export function groundSquashNow(): number {
  /* 0.66 → 0.55(수리: 넥서스 앞 바닥·기둥이 뷰박스 밖으로 잘렸다) — 앞쪽 깊이가
     원점(아래 originYNow)과 함께 16칸 안에 들어오는 선까지만 부감을 준다. */
  /* 입체 판 피칭(지적: 납작비가 아니라 피치가 안 맞음) — 지형의 화면 기하에 수치로
     맞춘다: 깊이 = 컨테이너 눌림 0.74 × cos45 ≈ 0.52, 높이 = cos45 ≈ 0.71. 여태
     높이를 0.84~0.94로 거의 안 줄여 모델만 껑충했던 게 피치 불일치의 정체다. */
  return pitchView ? pitchSquash : topView ? 0.55 : GROUND_SQUASH;
}
function zScaleNow(): number {
  // 0.71 → … → 0.94 → 1(지적: 1까지 늘려봐) — 높이 원본 그대로.
  return pitchView ? 1 : topView ? 0.66 : 0.89;
}
function originYNow(): number {
  return pitchView ? 12.6 : topView ? 12 : 12.6;
}

/* 등급은 면 헬퍼가 스스로 단다(요청: LOD 적용) — 모델 106개를 손으로 매기지 않아도
   프리미티브를 지나는 모든 면이 제 등급을 갖는다. 갈래가 곧 등급이기 때문이다:
     · 몸통(bodyFace) = 형체 1 — 개인색이 칠해지는 면이라 어느 등급에서도 안 빠진다.
     · 명암(topFace·sideFace) = 장식 2 — 형체 위에 얹는 흑백 반투명이다.
     · 단면·광택(capFace) = 세부 3 — 가장 작고 가장 먼저 빠진다.
   모델이 '이 흰 면은 형체다'라고 우기고 싶으면 lod 인자로 1을 준다(예: 빛나는 창처럼
   그 면이 없으면 실루엣이 안 읽히는 자리). */
/** 몸통 — 본색 그대로(형체 1티어). */
export const bodyFace = (d: string): ShapeFace => [d, 1];
/** 밝은 윗면 — 흰 반투명(기본 OP.top). 기본 등급은 장식 2. */
export const topFace = (d: string, opacity: number = OP.top, lod: number = LOD_TRIM): ShapeFace =>
  [d, opacity, "#fff", undefined, lod];
/** 어두운 옆·밑면 — 검 반투명(기본 OP.side). 기본 등급은 장식 2. */
export const sideFace = (d: string, opacity: number = OP.side, lod: number = LOD_TRIM): ShapeFace =>
  [d, opacity, "#000", undefined, lod];
/** 원통·구멍의 단면 — 동굴 입구처럼 깊은 어둠(기본 OP.cap). 기본 등급은 세부 3. */
export const capFace = (d: string, opacity: number = OP.cap, lod: number = LOD_FINE): ShapeFace =>
  [d, opacity, "#000", undefined, lod];

/** 바닥에 놓인 원(납작 타원) 패스 — 밝은 윗면·발판·고리에 두루 쓴다.
 *  시각 밀림 중이면 타원도 같이 기울인다(지적: 파일런·포토·소환구 원반만 안 기울어
 *  첨탑과 어긋난 롤로 보임) — 밀림 행렬 [[1,sh],[0,1]]을 입힌 타원도 타원이라,
 *  주축·각을 풀어 회전 타원 호로 그린다. */
export const groundEllipse = (
  cx: number, cy: number, rx: number, ry: number = rx * groundSquashNow(),
): string => {
  if (!viewShear) {
    return `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(rx * 2)} 0`
      + `a${r2(rx)} ${r2(ry)} 0 1 0-${r2(rx * 2)} 0Z`;
  }
  const b = viewShear * ry;
  const t = rx * rx + b * b;
  const e = ry * ry;
  const ang = 0.5 * Math.atan2(2 * b * ry, t - e);
  const disc = Math.sqrt((t - e) * (t - e) + 4 * b * b * e);
  const R1 = Math.sqrt((t + e + disc) / 2);
  const R2 = Math.sqrt(Math.max(0.0001, (t + e - disc) / 2));
  const ux = R1 * Math.cos(ang);
  const uy = R1 * Math.sin(ang);
  const angDeg = r2((ang * 180) / Math.PI);
  return `M${r2(cx - ux)} ${r2(cy - uy)}a${r2(R1)} ${r2(R2)} ${angDeg} 1 0 ${r2(2 * ux)} ${r2(2 * uy)}`
    + `a${r2(R1)} ${r2(R2)} ${angDeg} 1 0 ${r2(-2 * ux)} ${r2(-2 * uy)}Z`;
};

/** 지면과 평행한 **고리**(도넛) 패스 — 바깥 타원 안에 안 타원을 반대로 감아 뚫는다
 *  (감김 주의: 같은 방향으로 감으면 구멍이 안 뚫린다 — 맨 위 주석 참고).
 *  손으로 A 호를 두 줄 적던 자리를 대신한다 — 시각 밀림도 groundEllipse가 알아서 탄다. */
export function annulusPath(
  cx: number, cy: number, ro: number, ri: number, squash: number = groundSquashNow(),
): string {
  return `${groundEllipse(cx, cy, ro, ro * squash)}${ringHole(cx, cy, ri, ri * squash)}`;
}
/** 고리의 구멍 — groundEllipse와 반대로 감은 타원. */
function ringHole(cx: number, cy: number, rx: number, ry: number): string {
  return `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 1 ${r2(rx * 2)} 0`
    + `a${r2(rx)} ${r2(ry)} 0 1 1-${r2(rx * 2)} 0Z`;
}
/** 높이 z에 뜬 고리(3D 자리) — 몸통 + 윗면 밝기. 대야 테두리·부양 링에 쓴다. */
export function ringFaces3(
  cx: number, cy: number, z: number, ro: number, ri: number,
): ShapeFace[] {
  const [sx, sy] = project(cx, cy, z);
  const d = annulusPath(sx, sy, ro, ri);
  return tagKey([bodyFace(d), topFace(d, OP.topSoft)], depthNow(cx, cy) + ro);
}

/** 모형 공간 점 — project에 그대로 넘긴다. */
export type Pt3 = readonly [number, number, number];
/** 곡면 판의 한 변 — [끝점]이면 직선, [제어점, 끝점]이면 2차 곡선. */
export type Seg3 = readonly [Pt3] | readonly [Pt3, Pt3];

/** 곡면 판 패스(요청: 곡면 판 전용 프리미티브) — 모형 공간 점들로 닫힌 조각을 그린다.
 *
 *  손으로 `M${pt(..)} Q${pt(..)} ${pt(..)} L${pt(..)}`를 이어 붙이던 자리를 그대로
 *  대신한다. 제어점을 그 자리 그대로 받으므로 **그림이 안 바뀌고**(요청: 기존 모양
 *  최대한 유지), 대신 손 문자열이 못 받던 것들을 받는다:
 *    · project를 지나므로 요잉·시각 밀림·앞숙임·판(평면/부감/입체)이 저절로 실린다.
 *    · 부품 깊이(tagKey)가 붙어 화가 순서에 제대로 낀다 — 손 면은 무깊이라 직전
 *      부품의 깊이를 물려받아 앞뒤가 뒤집히곤 했다.
 *    · 등급(LOD)이 붙어 사양에 따라 빠진다.
 *  상자·원통으로는 못 만드는 굽은 등판·꽃잎·집게·아가리가 이 프리미티브의 몫이다. */
export function curvePath3(start: Pt3, segs: readonly Seg3[], close = true): string {
  const p = (q: Pt3): string => {
    const [x, y] = project(q[0], q[1], q[2]);
    return `${x} ${y}`;
  };
  let d = `M${p(start)}`;
  for (const sg of segs) d += sg.length === 1 ? ` L${p(sg[0])}` : ` Q${p(sg[0])} ${p(sg[1])}`;
  return close ? `${d} Z` : d;
}

/** 곡면 판 — curvePath3에 몸통·명암·부품 깊이를 한 번에 얹는다.
 *  fill을 주면 그 색(안 주면 개인색), lit/shade는 얹을 명암의 농도다.
 *  깊이는 판의 **가장 앞점**으로 잡는다(tagKey 주석의 규칙 — 중앙값은 길쭉한 판에서
 *  틀린다). */
export function plateFaces3(
  start: Pt3, segs: readonly Seg3[],
  opts: { fill?: string; lit?: number; shade?: number } = {},
): ShapeFace[] {
  const d = curvePath3(start, segs);
  const out: ShapeFace[] = [opts.fill ? [d, 1, opts.fill] : bodyFace(d)];
  if (opts.lit) out.push(topFace(d, opts.lit));
  if (opts.shade) out.push(sideFace(d, opts.shade));
  let key = depthNow(start[0], start[1]);
  for (const sg of segs) {
    for (const q of sg) {
      const k = depthNow(q[0], q[1]);
      if (k > key) key = k;
    }
  }
  return tagKey(out, key);
}

/** 두 화면 점을 잇는 **띠**(폭 있는 사각 판) — 양 끝 반폭을 따로 줄 수 있어 끝이
 *  가늘어지는 칼날·팔·힘줄에도 쓴다. 손으로 네 꼭짓점을 적던 자리를 대신한다. */
export function bandPath(
  ax: number, ay: number, bx: number, by: number, hwA: number, hwB: number = hwA,
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return `M${r2(ax + nx * hwA)} ${r2(ay + ny * hwA)} L${r2(bx + nx * hwB)} ${r2(by + ny * hwB)}`
    + ` L${r2(bx - nx * hwB)} ${r2(by - ny * hwB)} L${r2(ax - nx * hwA)} ${r2(ay - ny * hwA)} Z`;
}

/** 세운 각기둥(상자) 3면 — 앞면(본색) + 윗면(밝게) + 오른 옆면(어둡게).
 *  (x, yBottom)이 앞면 왼쪽 아래, w×h가 앞면, depth가 뒤로 물러나는 길이다. */
export function boxFaces(
  x: number, yBottom: number, w: number, h: number, depth = 2,
): ShapeFace[] {
  const dx = r2(depth * 0.7);
  const dy = r2(-depth * 0.5);
  const yTop = yBottom - h;
  const front = `M${r2(x)} ${r2(yTop)} L${r2(x + w)} ${r2(yTop)} L${r2(x + w)} ${r2(yBottom)} L${r2(x)} ${r2(yBottom)} Z`;
  const top = `M${r2(x)} ${r2(yTop)} L${r2(x + dx)} ${r2(yTop + dy)} L${r2(x + w + dx)} ${r2(yTop + dy)} L${r2(x + w)} ${r2(yTop)} Z`;
  const side = `M${r2(x + w)} ${r2(yTop)} L${r2(x + w + dx)} ${r2(yTop + dy)} L${r2(x + w + dx)} ${r2(yBottom + dy)} L${r2(x + w)} ${r2(yBottom)} Z`;
  return [bodyFace(`${front} ${top} ${side}`), topFace(top), sideFace(side)];
}

/** 세운 원통 3면 — 몸통(본색, 바닥은 배부른 타원 호) + 윗면 타원(밝게) + 오른쪽 세로
 *  음영(어둡게). (cx, yBottom)이 바닥 타원의 중심이다. */
export function cylinderFaces(
  cx: number, yBottom: number, r: number, h: number, squash: number = GROUND_SQUASH,
): ShapeFace[] {
  const ry = r * squash;
  const yTop = yBottom - h;
  const body = `M${r2(cx - r)} ${r2(yTop)} L${r2(cx + r)} ${r2(yTop)} L${r2(cx + r)} ${r2(yBottom)}`
    + `a${r2(r)} ${r2(ry)} 0 1 1-${r2(r * 2)} 0Z`;
  const shade = `M${r2(cx + r * 0.35)} ${r2(yTop)} L${r2(cx + r)} ${r2(yTop)} L${r2(cx + r)} ${r2(yBottom)}`
    + `a${r2(r)} ${r2(ry)} 0 0 1-${r2(r * 0.65)} ${r2(ry * 0.92)}Z`;
  return [bodyFace(body), sideFace(shade, OP.sideSoft), topFace(groundEllipse(cx, yTop, r, ry))];
}

/** 방향 있는 원통(다리 등)의 단면을 어떻게 보일지 — 위 '원통 단면 규칙'의 코드판.
 *  앞이면 1(또렷), 옆이면 0.6(작고 기울여), 뒤면 0(그리지 않는다). 도형을 만드는 쪽이
 *  이 배율로 캡 크기를 정하고, 0이면 아예 빼면 된다. */
export type RadialDir = "front" | "side" | "back";
export const capScaleOf = (dir: RadialDir): number =>
  dir === "front" ? 1 : dir === "side" ? 0.6 : 0;

/** 소수 둘째 자리 반올림 — 패스 문자열이 지저분해지지 않게. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ── 3D 투영 엔진(요청: 고도화 — 모든 유닛·건물에 적용할 준비) ────────────────────
   손으로 좌표를 깎는 대신, 모형을 3D로 기술하면 표준 시점으로 투영해 면 목록을 만들어
   준다. 모형 공간: x 오른쪽 · y 앞(시청자 쪽) · z 위, 단위는 뷰박스 칸(16×16), 지면
   원점은 도형 발밑 가운데다.

   투영 = 요잉(모형을 z축으로 YAW_DEG만큼) → 피칭(내려다보기: 앞뒤가 GROUND_SQUASH로
   눌리고 높이는 Z_SCALE로 선다) → 화면 (ORIGIN_X, ORIGIN_Y) 평행이동.

   쓰는 법 — 도형 하나는 대개 이렇게 조립한다:
     const faces: ShapeFace[] = [
       ...boxFaces3(0, 0, 6, 4, 3),            // 몸통 상자
       ...cylinderFaces3(0, 0, 2, 5),          // 가운데 원통
       ...limbFaces(-20, 5, 1.8),              // 방사 다리(단면 보임은 각도가 정한다)
     ];
   각 프리미티브가 몸통·윗면·옆면(·단면)을 표준 농도로 겹쳐 준다. 손 튜닝이 필요하면
   반환된 면의 패스를 그대로 다듬으면 된다. */

/** 표준 시점 상수 — 요잉 0°(정면, 지적: 기본값 자체를 정면으로), 피칭 +(내려다보기). */
export const VIEW = {
  yawDeg: 0,
  /** 앞뒤(깊이)의 화면 눌림 — 바닥 원의 납작비와 같다. */
  squash: GROUND_SQUASH,
  /** 높이(z)의 화면 배율 — cos(내려다보는 각) ≈ 0.89. */
  zScale: 0.89,
  /** 화면 원점 — 발밑 가운데가 앉는 자리. */
  originX: 8,
  originY: 12.6,
} as const;

/* 요잉 오버라이드(요청: 모델링 뷰어에서 시점 회전) — withYaw 블록 안에서만 값이 서고,
   블록을 나가면 표준 시점으로 돌아온다. 3D 프리미티브로 만든 도형은 이걸로 아무 각도에서나
   다시 투영할 수 있다(손으로 깎은 도형은 좌표에 시점이 구워져 불가). */
let yawOverride: number | null = null;
/** 모델 자체를 돌린다(요청: "앞으로 내가 요잉하라고 하는 건 그릴 때가 아니라 본 모델에서
 *  돌리라는 뜻") — 빌더 몸을 이 안에서 부르면, deg만큼 돌아간 것이 곧 그 모델이다.
 *  withYaw가 절대각을 못 박는 것과 달리 이것은 **지금 요잉에 얹는 상대 회전**이라,
 *  그리는 쪽이 주는 방향(유닛의 진행 방향·건물 기본 요잉) 위에 모델의 제 각이 더해진다.
 *  그래서 도록·지도·미니맵 어디서 굽든 같은 모델이 같은 자세로 선다 — 그리기 단계에
 *  건물마다 다른 각을 끼워 넣던 보정표(MODEL_YAW_TWEAK)가 없어진 자리다. */
export function withSpin<T>(deg: number, fn: () => T): T {
  return withYaw(currentYaw() - deg, fn);
}
export function withYaw<T>(deg: number, fn: () => T): T {
  yawOverride = deg;
  try {
    return fn();
  } finally {
    yawOverride = null;
  }
}

/** 지금 유효한 요잉(도) — withYaw 안이면 그 값. */
function currentYaw(): number {
  return yawOverride ?? VIEW.yawDeg;
}

/** 화면 깊이(요잉 반영) — painter 정렬용. +가 시청자 쪽(앞). */
export function depthNow(x: number, y: number): number {
  const th = (currentYaw() * Math.PI) / 180;
  return -x * Math.sin(th) + y * Math.cos(th);
}
/* 부품 번호 매기개 — 굽기 한 판 안에서 tagKey·tagDepth가 불릴 때마다 하나씩 는다.
   빌더가 "여기까지가 한 부품이다"라고 선언하는 자리가 곧 그 둘이라, 호출 차례가 그대로
   부품 신원이 된다. 같은 빌더는 어느 각도에서도 같은 차례로 부르므로 각도와 무관하다. */
let partSeq = 0;
/** 굽기 한 판을 시작한다 — 부품 번호를 0부터 다시 센다. 모든 굽기가 이 문을 지나야
 *  같은 모델의 같은 부품이 각도가 달라도 같은 번호를 받는다. */
export function bake<T>(fn: () => T): T {
  partSeq = 0;
  return fn();
}
/** 부품 면들에 중심 깊이를 매긴다 — 손 면 묶음이 제 자리를 밝힐 때 쓴다. */
export function tagDepth(faces: ShapeFace[], x: number, y: number): ShapeFace[] {
  const d = depthNow(x, y);
  partSeq += 1;
  const pid = partSeq;
  return faces.map(([p, o, f, , l]) => [p, o, f, d, l, pid] as ShapeFace);
}
/** 깊이 키를 그대로 매긴다 — 프리미티브가 '부품 전체에서 가장 앞점'을 셈해 단다
 *  (지적: 중앙값 기준은 길쭉한 부품에서 틀린다 — 같은 부품도 깊이가 많이 다르다). */
export function tagKey(faces: ShapeFace[], key: number): ShapeFace[] {
  partSeq += 1;
  const pid = partSeq;
  return faces.map(([p, o, f, , l]) => [p, o, f, key, l, pid] as ShapeFace);
}
/** 부품 깊이 정렬(지적: 요잉으로 뒤로 간 부품이 앞 부품 위에 그려져 '비쳐 보임') —
 *  깊이 있는 면은 뒤→앞으로, 깊이 없는 면은 직전 깊이를 물려받아(장식은 제 부품에
 *  붙어 다닌다) 안정 정렬한다. 맨 앞의 무깊이 면(바닥 그림자·스플랫)은 맨 뒤 층이다. */
export function zsorted(faces: ShapeFace[]): ShapeFace[] {
  let cur = -1e9;
  const keyed = faces.map((f, i) => {
    if (f[3] !== undefined) cur = f[3];
    return [f, cur, i] as const;
  });
  keyed.sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]));
  return keyed.map(([f]) => f);
}

/* 세계 광원(요청: 모델을 돌려도 광원은 고정) — 왼쪽에서 약간 앞으로 비춘다. 세로 면의
   평면 법선(모형 기준)을 요잉만큼 돌려 광원과 내적: 왼쪽을 보는 면은 밝고 오른쪽을 보는
   면은 어둡다. 면이 시청자 쪽을 보는지도 여기서 판단한다. */
const LIGHT_PLAN: [number, number] = [-0.9, 0.45];
export function faceLight(
  nxModel: number, nyModel: number,
  /** 법선의 위 성분(경사면용, 지적: 벙커 하단·넥서스의 기운 옆면이 위 45도 시점에서
   *  안 보임) — 카메라가 내려다보므로 위로 기운 면은 수평 법선이 뒤를 향해도 보인다.
   *  수평 전용 판정은 그 면을 걷어내 구멍을 냈고, 그 틈으로 뒤 요소가 비쳐 보였다. */
  nzModel = 0,
): { visible: boolean; face: (d: string) => ShapeFace[] } {
  const th = (currentYaw() * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const nx = nxModel * c + nyModel * sn;
  const ny = -nxModel * sn + nyModel * c;
  const dot = nx * LIGHT_PLAN[0] + ny * LIGHT_PLAN[1];
  const face = (d: string): ShapeFace[] => {
    if (dot > 0.3) return [topFace(d, Math.min(0.2, (dot - 0.3) * 0.3 + 0.08))];
    if (dot < -0.1) return [sideFace(d, Math.min(0.38, (-dot - 0.1) * 0.45 + 0.12))];
    return [];
  };
  /* 보임 판정도 시각 밀림만큼 돌린다(지적: 넥서스 옆면이 안 보임) — 소실점이 옮겨 간
     만큼 카메라가 비껴 보므로, 화면 가운데 쪽 옆면이 드러나야 한다. */
  const vphi = Math.atan(viewShear);
  // 내려다보는 몫 — 납작비가 곧 부감의 세기다(납작할수록 더 위에서 본다).
  const elev = groundSquashNow();
  return {
    visible: (ny * Math.cos(vphi) - nx * Math.sin(vphi)) + nzModel * elev > 0.02,
    face,
  };
}

/** 면이 카메라를 얼마나 마주보는가(−1~1) — faceLight의 보임 판정을 눈금으로 돌려준다.
 *  둥근 몸에 붙은 장식(어시밀레이터 알 등)을 모서리에서 뚝 끊지 않고, 돌아 나가며
 *  서서히 줄이는 데 쓴다. */
export function facingRatio(nxModel: number, nyModel: number): number {
  const th = (currentYaw() * Math.PI) / 180;
  const nx = nxModel * Math.cos(th) + nyModel * Math.sin(th);
  const ny = -nxModel * Math.sin(th) + nyModel * Math.cos(th);
  const vphi = Math.atan(viewShear);
  return ny * Math.cos(vphi) - nx * Math.sin(vphi);
}

/* 모형 내부 원근(요청: 모델 안에서도 원근법 — 건물은 특히) — 앞(시청자 쪽)으로 나온
   점은 크게, 뒤로 물러난 점은 작게. 발밑 원점을 눈 축으로 삼아 깊이 나눗셈을 한다.
   project를 지나는 모든 프리미티브(상자·절두·기둥·다리·관·뿔)가 저절로 받는다. */
// 30 → 48(지적: 모델 원근이 과함) — 수렴을 눅인다.
const MODEL_PERSP = 48;
/* 시각 밀림(지적: 소실점이 정면이 아니라 시각을 반영해야) — 화면 가운데에서 벗어난
   마커는 깊이에 비례해 가로로 민다(앞은 바깥, 뒤는 안). 모델을 돌리는 요잉과 달리
   폭·세로선이 안 바뀌어 찌그러지지 않고, 내부 소실점만 시각 방향으로 옮겨 간다. */
let viewShear = 0;
export function withViewShear<T>(sh: number, fn: () => T): T {
  viewShear = sh;
  try {
    return fn();
  } finally {
    viewShear = 0;
  }
}
/** 모형 좌표 (x,y,z) → 화면 [sx, sy]. y(앞)는 아래로, z(위)는 위로 간다. */
export function project(x: number, y: number, z: number): [number, number] {
  const th = ((yawOverride ?? VIEW.yawDeg) * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const rx = x * c + y * sn;
  const ry = -x * sn + y * c;
  /* 앞으로 숙임(지적: 시청자 쪽으로 숙여야 한다) — 입체 판에서 꼭대기일수록 시청자
     쪽으로 기운다(z가 깊이에 태워짐). 지붕 윗면이 드러나 45도 내려다보는 지형과 자세가
     맞는다. sin20° ≈ 0.34. */
  const ry2 = pitchView ? ry + z * 0.34 : ry;
  /* 원근 배율은 원래 깊이만(지적: 원근이 과함) — 앞숙임 몫(z×0.34)까지 넣으면 키 큰
     꼭대기가 덩달아 확대돼 과한 원근으로 보였다. */
  const f = MODEL_PERSP / (MODEL_PERSP - Math.max(-10, Math.min(10, ry)));
  /* 원근은 가로 수렴만(지적 둘: 높이까지 태우면 반대쪽이 들리는 가짜 롤, 깊이까지
     태우면 요잉한 옆구리가 앞으로 쏟아짐) — 세로선은 곧게, 앞뒤는 납작비 그대로.
     시각 밀림(viewShear)은 화면 깊이(ry×납작비)에 태워, 바닥의 남북 선 기울기가
     지도의 소실 기울기(u/P)와 정확히 같아진다(지적: 노란선-빨간선 어긋남). */
  /* 가로 밀림은 앞숙임 제외한 원래 깊이(ry)에만(지적: 가장자리에서 안쪽으로 롤 된
     느낌) — 숙임 몫(z×0.34)까지 태우면 바닥 앞변만 바깥으로 밀려 세로선이 기운다.
     세로 기울임은 + 방향(초록 기대선)이 맞고, 0.8은 과했다(지적 왕복: -0.8은 이상,
     +0.8은 수정탑이 통째 이동해 떨어져 보임 — 그건 파일런 보석의 화면 좌표 문제로
     따로 수리) — 절반쯤인 +0.5로. */
  const rx2 = rx + ry * groundSquashNow() * viewShear
    + (pitchView ? z * 0.5 * viewShear : 0);
  return [r2(VIEW.originX + rx2 * f), r2(originYNow() + ry2 * groundSquashNow() - z * zScaleNow())];
}

/** 3D 꼭짓점 목록 → 닫힌 직선 패스. (곡선이 필요하면 결과 좌표를 Q로 이어 다듬는다.) */
export function polyPath3(pts: [number, number, number][]): string {
  const s = pts.map(([x, y, z], i) => {
    const [sx, sy] = project(x, y, z);
    return `${i === 0 ? "M" : "L"}${sx} ${sy}`;
  }).join(" ");
  return `${s} Z`;
}

/** 지면과 평행한 원(높이 z) — 화면에선 납작 타원. */
export function discPath3(cx: number, cy: number, z: number, r: number): string {
  const [sx, sy] = project(cx, cy, z);
  return groundEllipse(sx, sy, r, r * groundSquashNow());
}

/* 켤레 지름 타원 — 평면 위 원을 투영하면 화면에선 두 켤레 반지름 벡터 u·v로 표현되는
   타원이 된다(P(t) = C + u·cos t + v·sin t). 주축 반지름·기움각을 풀어 호 둘로 그린다.
   groundEllipse의 밀림 처리와 같은 수법을 일반화한 것. */
function conjugateEllipsePath(
  cx: number, cy: number, ax: number, ay: number, bx: number, by: number,
): string {
  const dot = ax * bx + ay * by;
  const t0 = 0.5 * Math.atan2(2 * dot, ax * ax + ay * ay - (bx * bx + by * by));
  const ux = ax * Math.cos(t0) + bx * Math.sin(t0);
  const uy = ay * Math.cos(t0) + by * Math.sin(t0);
  const R1 = Math.max(Math.hypot(ux, uy), 0.01);
  const R2 = Math.max(Math.abs(ax * by - ay * bx) / R1, 0.01);
  const angDeg = r2((Math.atan2(uy, ux) * 180) / Math.PI);
  return `M${r2(cx - ux)} ${r2(cy - uy)}a${r2(R1)} ${r2(R2)} ${angDeg} 1 0 ${r2(2 * ux)} ${r2(2 * uy)}`
    + `a${r2(R1)} ${r2(R2)} ${angDeg} 1 0 ${r2(-2 * ux)} ${r2(-2 * uy)}Z`;
}

/** 세로 벽에 붙은 원 무늬(지적: 서플라이 앞 팬·어시밀레이터 앞 알이 각도 따라 본체와
 *  따로 놈) — 화면 좌표에 동그라미를 그리면 요잉해도 시청자만 바라봐 벽에서 떨어져
 *  보인다. 벽 평면(x축과 나란, 깊이 y) 위 중심 (cx, cz)·반지름 rx(가로)·rz(세로)를
 *  제 투영으로 구워, 벽과 함께 돌고 눌리게 한다. */
export function wallDiscPath(
  cx: number, y: number, cz: number, rx: number, rz: number = rx,
): string {
  const [sx, sy] = project(cx, y, cz);
  const [axx, axy] = project(cx + rx, y, cz);
  const [bxx, bxy] = project(cx, y, cz + rz);
  return conjugateEllipsePath(sx, sy, axx - sx, axy - sy, bxx - sx, bxy - sy);
}

/** 벽 무늬의 평면 좌표계 — 중심과 켤레 축을 돌려주어, 부속 장식(팬 날개 등)을 같은
 *  평면 안에서 그릴 수 있게 한다. pt(각, 가로배율, 세로배율)가 화면 점을 준다. */
export function wallFrame(
  cx: number, y: number, cz: number, rx: number, rz: number = rx,
): { c: [number, number]; pt: (t: number, kx?: number, kz?: number) => [number, number] } {
  const [sx, sy] = project(cx, y, cz);
  const [axx, axy] = project(cx + rx, y, cz);
  const [bxx, bxy] = project(cx, y, cz + rz);
  const ux = axx - sx;
  const uy = axy - sy;
  const vx = bxx - sx;
  const vy = bxy - sy;
  return {
    c: [sx, sy],
    pt: (t, kx = 1, kz = kx) => [
      r2(sx + ux * kx * Math.cos(t) + vx * kz * Math.sin(t)),
      r2(sy + uy * kx * Math.cos(t) + vy * kz * Math.sin(t)),
    ],
  };
}

/** 세운 다각기둥 — 평면 다각형(plan)을 z0에서 h만큼 밀어 올린다. 규칙 다각형이 아니어도
 *  되므로 사다리꼴·모서리 깎은 육각형처럼 손으로 잡은 단면을 그대로 세울 수 있다.
 *  옆면은 보이는 것만, 세계 광원 밝기로(faceLight) — 돌려도 명암이 안 뒤집힌다. */
export function prismZFaces(
  plan: readonly (readonly [number, number])[], z0: number, h: number,
  /** 윗면을 덮을지 — 남의 몸에 두르는 띠는 뚜껑이 몸속에 묻혀 있어 그리면 안 된다
   *  (그리면 그 원판이 몸을 덮는다). 그런 토막은 false로 벽만 남긴다. */
  capTop = true,
): ShapeFace[] {
  const n = plan.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of plan) { cx += x; cy += y; }
  cx /= n;
  cy /= n;
  let rad = 0;
  for (const [x, y] of plan) rad = Math.max(rad, Math.hypot(x - cx, y - cy));
  const faces: ShapeFace[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    // 벽의 바깥 법선 — 변의 가운데가 단면 중심에서 어느 쪽인가로 잡는다.
    const mx = (plan[i][0] + plan[j][0]) / 2 - cx;
    const my = (plan[i][1] + plan[j][1]) / 2 - cy;
    const len = Math.hypot(mx, my) || 1;
    const { visible, face } = faceLight(mx / len, my / len);
    if (!visible) continue;
    const d = polyPath3([
      [plan[i][0], plan[i][1], z0], [plan[j][0], plan[j][1], z0],
      [plan[j][0], plan[j][1], z0 + h], [plan[i][0], plan[i][1], z0 + h],
    ]);
    faces.push(bodyFace(d), ...face(d));
  }
  if (capTop) {
    const top = polyPath3(plan.map(([x, y]) => [x, y, z0 + h] as [number, number, number]));
    faces.push(bodyFace(top), topFace(top, OP.topSoft));
  }
  // 깊이 키는 원기둥과 같은 규칙 — 가장 앞점이되 제 높이만큼만.
  return tagKey(faces, depthNow(cx, cy) + Math.min(h, rad));
}

/** 눕힌 다각기둥 — **앞뒤가 밑면**이다(지적: "앞뒤가 밑면인 기둥이야"). 단면(plan)은
 *  (x, z) 평면의 다각형이고, 그것을 y0에서 앞으로 len만큼 민다. prismZFaces가 다각형을
 *  위로 미는 것과 짝이고, prismXFaces(옆으로 미는 것)와는 미는 축이 다르다.
 *
 *  옆면의 법선은 (x, 0, z)라 수평 성분이 0인 면(위·아래 뚜껑)이 생긴다 — faceLight에
 *  z 성분을 그대로 넘겨 '내려다보는 카메라'가 위를 보는 면만 살리게 하고, 하늘을 보는
 *  면에는 윗면 밝기를 얹는다(수평 광원 셈만으로는 밋밋하다).
 *  앞뒤 밑면은 그쪽을 마주볼 때만 그린다 — 남의 몸에 두르는 띠는 둘 다 꺼서 벽만 남긴다. */
export function prismYFaces(
  plan: readonly (readonly [number, number])[], y0: number, len: number,
  capFront = true, capBack = false,
): ShapeFace[] {
  const n = plan.length;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of plan) { cx += x; cz += z; }
  cx /= n;
  cz /= n;
  let rad = 0;
  for (const [x, z] of plan) rad = Math.max(rad, Math.hypot(x - cx, z - cz));
  const faces: ShapeFace[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const mx = (plan[i][0] + plan[j][0]) / 2 - cx;
    const mz = (plan[i][1] + plan[j][1]) / 2 - cz;
    const l = Math.hypot(mx, mz) || 1;
    const nx = mx / l;
    const nz = mz / l;
    const { visible, face } = faceLight(nx, 0, nz);
    if (!visible) continue;
    const d = polyPath3([
      [plan[i][0], y0, plan[i][1]], [plan[j][0], y0, plan[j][1]],
      [plan[j][0], y0 + len, plan[j][1]], [plan[i][0], y0 + len, plan[i][1]],
    ]);
    faces.push(bodyFace(d), ...face(d));
    if (nz > 0.35) faces.push(topFace(d, OP.topSoft * nz));
  }
  const capAt = (y: number, sgn: 1 | -1): void => {
    if (facingRatio(0, sgn) <= 0.02) return;
    const pts = plan.map(([x, z]) => [x, y, z] as [number, number, number]);
    const d = polyPath3(sgn > 0 ? pts : [...pts].reverse());
    faces.push(bodyFace(d), ...faceLight(0, sgn).face(d));
  };
  if (capFront) capAt(y0 + len, 1);
  if (capBack) capAt(y0, -1);
  // 깊이 키는 다른 기둥과 같은 규칙 — 제 가운데이되, 이길 수 있는 폭은 제 굵기까지.
  return tagKey(faces, depthNow(cx, y0 + len / 2) + Math.min(rad, len));
}

/** 세운 상자 — frustum의 특수형. 보이는 면·세계 광원은 frustumFaces3가 맡는다. */
export function boxFaces3(
  cx: number, cy: number, w: number, d: number, h: number, z0 = 0,
): ShapeFace[] {
  return frustumFaces3(cx, cy, w, d, w, d, h, z0);
}

/** 세운 원통 — 바닥 중심 (cx,cy), 반지름 r, 높이 h. 몸통 + 밝은 윗면 + 오른쪽 세로 음영. */
export function cylinderFaces3(
  cx: number, cy: number, r: number, h: number, z0 = 0,
): ShapeFace[] {
  const [bx, by] = project(cx, cy, z0);
  /* 꼭대기 x도 제 투영으로(지적: 파일런·포토가 안쪽 기움) — 바닥 x를 재사용하면
     몸통이 바깥 롤·앞숙임을 안 타고 수직으로만 서서, 기운 바닥 타원과 어긋난다. */
  const [tx, ty] = project(cx, cy, z0 + h);
  const ry = r * groundSquashNow();
  /* 실루엣의 윗변은 직선 현이 아니라 윗타원의 '뒤 반호'(수리·지적: 동그란 판 뒤 반쪽이
     검게 뚫림) — 직선으로 자르면 납작하고 넓은 드럼일수록 윗면 뒤 반쪽이 몸에 안 담겨
     배경이 비쳤다. 뒤 반호(위로 볼록) + 오른 벽 + 앞 반호(아래로 볼록) + 왼 벽. */
  const body = `M${r2(tx - r)} ${r2(ty)} A${r2(r)} ${r2(ry)} 0 0 1 ${r2(tx + r)} ${r2(ty)}`
    + ` L${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 1 1-${r2(r * 2)} 0Z`;
  const shade = `M${r2(tx + r * 0.35)} ${r2(ty)} L${r2(tx + r)} ${r2(ty)} L${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 0 1-${r2(r * 0.65)} ${r2(ry * 0.92)}Z`;
  /* 깊이 키 = 가장 앞점, 단 제 높이만큼만(재지적: 넓고 낮은 받침이 몸통을 덮음) —
     부품이 이웃을 가릴 수 있는 건 제 키 높이까지라, 앞으로 뻗은 만큼을 높이로 자른다. */
  return tagKey(
    [bodyFace(body), sideFace(shade, OP.sideSoft), topFace(groundEllipse(tx, ty, r, ry))],
    depthNow(cx, cy) + Math.min(h, r),
  );
}

/** 방사형 다리(수평 반원통) — 평면각 angleDeg(0=시청자 쪽, +는 오른쪽), 뿌리 거리 r0,
 *  길이 len, 폭 w. 단면(동굴 입구)의 보임은 각도가 정한다(요잉이 이미 계산에 들어간다):
 *  실효각 |β| < 55°면 앞(단면 크게), < 100°면 옆(작게), 그 너머는 뒤(없음). 뒤로 뻗는
 *  다리는 몸통에 가려질 수 있으니 부르는 쪽이 그릴지 말지를 정한다. */
/** X축으로 눕힌 각기둥 — profile은 단면 (y,z)들(위→앞→아래). 앞띠·뒷띠·양 끝 단면을
 *  보이는 것만, 세계 광원 밝기로 그린다(요청: 돌려도 광원 고정). */
export function prismXFaces(profile: [number, number][], hw: number): ShapeFace[] {
  const out: ShapeFace[] = [];
  const bodyParts: string[] = [];
  const strip = (sign: 1 | -1): void => {
    const { visible, face } = faceLight(0, sign);
    if (!visible) return;
    for (let i = 0; i < profile.length - 1; i += 1) {
      const [y1, z1] = profile[i];
      const [y2, z2] = profile[i + 1];
      const d = polyPath3([[-hw, sign * y1, z1], [hw, sign * y1, z1], [hw, sign * y2, z2], [-hw, sign * y2, z2]]);
      bodyParts.push(d);
      if (i === 0) out.push(topFace(d));
      else out.push(...face(d));
    }
  };
  strip(1);
  strip(-1);
  for (const sign of [1, -1] as const) {
    const { visible, face } = faceLight(sign, 0);
    if (!visible) continue;
    const cap = polyPath3(profile.map(([y, z]) => [sign * hw, y, z] as [number, number, number]));
    bodyParts.push(cap);
    out.push(...face(cap));
  }
  return tagKey(
    [bodyFace(bodyParts.join(" ")), ...out],
    Math.min(
      Math.max(...profile.map(([y]) => y * depthNow(0, 1))) + hw * Math.abs(depthNow(1, 0)),
      Math.max(...profile.map(([, z]) => z)) - Math.min(...profile.map(([, z]) => z)),
    ),
  );
}

/** 넙적 피라미드 — 네 삼각 면을 보이는 것만, 세계 광원 밝기로. */
export function pyramidFaces3(
  cx: number, cy: number, w: number, d: number, h: number, z0 = 0,
): ShapeFace[] {
  const apex: [number, number, number] = [cx, cy, z0 + h];
  const b: [number, number, number][] = [
    [cx - w / 2, cy + d / 2, z0], [cx + w / 2, cy + d / 2, z0],
    [cx + w / 2, cy - d / 2, z0], [cx - w / 2, cy - d / 2, z0],
  ];
  // 피라미드 옆면의 위 성분 — 절두체와 같은 규칙(꼭짓점이 곧 위 극단).
  const nzW = (w / 2) / (Math.hypot(h, w / 2) || 1);
  const nzD = (d / 2) / (Math.hypot(h, d / 2) || 1);
  const sides: { d: string; n: [number, number]; nz: number }[] = [
    { d: polyPath3([apex, b[0], b[1]]), n: [0, 1], nz: nzD },
    { d: polyPath3([apex, b[1], b[2]]), n: [1, 0], nz: nzW },
    { d: polyPath3([apex, b[2], b[3]]), n: [0, -1], nz: nzD },
    { d: polyPath3([apex, b[3], b[0]]), n: [-1, 0], nz: nzW },
  ];
  const out: ShapeFace[] = [];
  const bodyParts: string[] = [];
  for (const f of sides) {
    const { visible, face } = faceLight(f.n[0], f.n[1], f.nz);
    if (!visible) continue;
    bodyParts.push(f.d);
    out.push(...face(f.d));
  }
  return tagKey(
    [bodyFace(bodyParts.join(" ")), ...out],
    depthNow(cx, cy)
      + Math.min(h, (w / 2) * Math.abs(depthNow(1, 0)) + (d / 2) * Math.abs(depthNow(0, 1))),
  );
}

export function limbFaces(
  angleDeg: number, len: number, w: number, r0 = 1.6, capOpen = true,
): ShapeFace[] {
  // 모형 공간 각도 그대로 — 요잉은 project가 입힌다(예전엔 여기서 한 번 더 더해 이중
  // 회전이었고, 뷰어에서 다리가 고정 오프셋으로 어긋났다).
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = Math.cos(a); // +면 시청자 쪽
  const rootX = dx * r0;
  const rootY = dy * r0;
  const tipX = dx * (r0 + len);
  const tipY = dy * (r0 + len);
  // 다리 진행과 직각인 반폭 벡터(지면 위).
  const nx = Math.cos(a) * (w / 2);
  const ny = -Math.sin(a) * (w / 2);
  const hRoot = w * 0.62; // 뿌리 쪽 등 높이
  const hTip = w * 0.5;
  const body = polyPath3([
    [rootX - nx, rootY - ny, hRoot],
    [tipX - nx, tipY - ny, hTip],
    [tipX + nx, tipY + ny, hTip],
    [rootX + nx, rootY + ny, hRoot],
    [rootX + nx, rootY + ny, 0],
    [tipX + nx, tipY + ny, 0],
    [tipX - nx, tipY - ny, 0],
    [rootX - nx, rootY - ny, 0],
  ]);
  const faces: ShapeFace[] = [bodyFace(body)];
  // 단면 보임도 지금 유효한 요잉으로(수리: 기본 시점 고정이라 좌우로 굽힐 때 비대칭).
  const beta = Math.abs(angleDeg + currentYaw());
  if (capOpen && beta < 100) {
    // 단면 반원 — 앞이면 꽉 차게, 옆이면 작게(capScaleOf와 같은 눈금).
    const scale = beta < 55 ? 1 : 0.6;
    const [c1x, c1y] = project(tipX - nx * scale, tipY - ny * scale, 0);
    const [c2x, c2y] = project(tipX + nx * scale, tipY + ny * scale, 0);
    const rr = (Math.hypot(c2x - c1x, c2y - c1y) / 2) * 1.05;
    faces.push(capFace(`M${c1x} ${c1y} A${r2(rr)} ${r2(rr * 0.95)} 0 0 1 ${c2x} ${c2y} Z`));
  }
  const dR = depthNow(rootX, rootY);
  const dT = depthNow(tipX, tipY);
  return tagKey(faces, (dR + dT) / 2 + Math.min(w, Math.abs(dR - dT) / 2));
}

/* ── 전면 3D화 프리미티브(요청: 모든 건물·수송선을 3D 도형으로) ──────────────────── */

/** 절두 각뿔(상자 포함) — 바닥 (wB×dB) → 윗면 (wT×dT). 네 세로 면을 보이는 것만,
 *  세계 광원 밝기로 그린다(요청: 돌려도 광원 고정). 윗면은 항상 밝다. */
export function frustumFaces3(
  cx: number, cy: number, wB: number, dB: number, wT: number, dT: number, h: number, z0 = 0,
): ShapeFace[] {
  const zt = z0 + h;
  const corners = (w: number, d: number, z: number): [number, number, number][] => [
    [cx - w / 2, cy + d / 2, z], [cx + w / 2, cy + d / 2, z],
    [cx + w / 2, cy - d / 2, z], [cx - w / 2, cy - d / 2, z],
  ];
  const b = corners(wB, dB, z0);
  const t = corners(wT, dT, zt);
  const top = polyPath3(t);
  /* 기운 옆면의 위 성분(지적: 벙커·넥서스처럼 위가 좁은 절두체) — 밑이 넓을수록
     벽이 위로 눕고, 법선이 하늘을 향한 만큼 내려다보는 카메라에 잡힌다. */
  const nzOf = (eB: number, eT: number): number =>
    (eB - eT) / (Math.hypot(h, eB - eT) || 1);
  const sides: { d: string; n: [number, number]; nz: number }[] = [
    { d: polyPath3([t[0], t[1], b[1], b[0]]), n: [0, 1], nz: nzOf(dB / 2, dT / 2) },
    { d: polyPath3([t[1], t[2], b[2], b[1]]), n: [1, 0], nz: nzOf(wB / 2, wT / 2) },
    { d: polyPath3([t[2], t[3], b[3], b[2]]), n: [0, -1], nz: nzOf(dB / 2, dT / 2) },
    { d: polyPath3([t[3], t[0], b[0], b[3]]), n: [-1, 0], nz: nzOf(wB / 2, wT / 2) },
  ];
  const out: ShapeFace[] = [];
  const bodyParts: string[] = [top];
  for (const f of sides) {
    const { visible, face } = faceLight(f.n[0], f.n[1], f.nz);
    if (!visible) continue;
    bodyParts.push(f.d);
    out.push(...face(f.d));
  }
  return tagKey(
    [bodyFace(bodyParts.join(" ")), ...out, topFace(top)],
    depthNow(cx, cy) + Math.min(
      h,
      (Math.max(wB, wT) / 2) * Math.abs(depthNow(1, 0))
        + (Math.max(dB, dT) / 2) * Math.abs(depthNow(0, 1)),
    ),
  );
}

/** 반구 돔 — 회전 대칭이라 요잉 불변. 바닥 중심 (cx,cy,z0), 반지름 r, 높이 h. */
export function domeFaces3(
  cx: number, cy: number, r: number, hh: number, z0 = 0,
): ShapeFace[] {
  const [bx, by] = project(cx, cy, z0);
  // 꼭대기 x도 제 투영으로(지적) — 원통과 같은 이유. 정수리만 기울고 발은 붙는다.
  const [tx, ty] = project(cx, cy, z0 + hh);
  const ry = r * groundSquashNow();
  const body = `M${r2(bx - r)} ${r2(by)} Q${r2(tx - r)} ${r2(ty)} ${r2(tx)} ${r2(ty)}`
    + ` Q${r2(tx + r)} ${r2(ty)} ${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 1 1-${r2(r * 2)} 0Z`;
  const shine = groundEllipse((bx + tx) / 2 - r * 0.25, (by + ty) / 2 - (by - ty) * 0.22, r * 0.4, r * 0.18);
  const shade = `M${r2(tx + r * 0.35)} ${r2(ty + (by - ty) * 0.08)} Q${r2(tx + r)} ${r2(ty + (by - ty) * 0.25)} ${r2(bx + r)} ${r2(by)}`
    + ` Q${r2(bx + r * 0.55)} ${r2(by + ry * 0.6)} ${r2(bx + r * 0.35)} ${r2(by)}Z`;
  return tagKey(
    [bodyFace(body), sideFace(shade, OP.sideSoft), topFace(shine)],
    depthNow(cx, cy) + Math.min(hh, r),
  );
}

/** 화면 원 — 납작비도, 시각 밀림도 먹이지 않는 진짜 동그라미.
 *  바닥 원(groundEllipse)과 다른 점이 요점이다: 땅에 누운 원반은 시점을 따라 눌리고
 *  기울어야 맞지만, **떠 있는 공은 그러면 안 된다**(지적: "구 형태가 찌그러져 보인다").
 *  구는 회전 대칭이라 어느 방향에서 봐도 투영이 원이다. */
export const screenCircle = (cx: number, cy: number, r: number): string =>
  `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(r * 2)} 0`
  + `a${r2(r)} ${r2(r)} 0 1 0-${r2(r * 2)} 0Z`;

/** 화면 반구 — 구의 **위 절반**. 구(sphereFaces3)와 같은 자를 쓴다: 중심만 투영하고
 *  반지름은 화면 원이라 어느 요잉에서도 안 찌그러진다. 잘린 밑면은 카메라가 내려다보는
 *  만큼(납작비) 아래로 부푼 타원 호로 닫아, 판판한 뚜껑이 아니라 둥근 밑으로 읽힌다. */
export function halfSphereFaces3(
  cx: number, cy: number, cz: number, r: number, fill?: string,
): ShapeFace[] {
  const [sx, sy] = project(cx, cy, cz);
  const ry = r * groundSquashNow();
  // 위 반원 → 아래로 부푼 타원 호로 닫는다.
  const d = `M${r2(sx - r)} ${r2(sy)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(sx + r)} ${r2(sy)}`
    + `A${r2(r)} ${r2(ry)} 0 0 1 ${r2(sx - r)} ${r2(sy)}Z`;
  const body: ShapeFace = fill ? [d, 1, fill] : bodyFace(d);
  /* 명암은 **호를 따라 도는 초승달**이다(지적: 동그란 점 둘이 눈처럼 보인다) — 원반
     두 장을 얹던 것을 걷는다. 밑동 호와 그보다 납작한 호 사이가 아랫배 그늘, 꼭대기
     호와 조금 낮은 호 사이가 정수리 빛이다. 둘 다 실루엣 안에 딱 맞아 어느 크기에서도
     밖으로 삐치지 않는다(원반은 작게 그릴수록 눈처럼 도드라졌다). */
  const shade = `M${r2(sx + r)} ${r2(sy)}A${r2(r)} ${r2(ry)} 0 0 1 ${r2(sx - r)} ${r2(sy)}`
    + `A${r2(r)} ${r2(ry * 0.42)} 0 0 0 ${r2(sx + r)} ${r2(sy)}Z`;
  const gloss = `M${r2(sx - r)} ${r2(sy)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(sx + r)} ${r2(sy)}`
    + `A${r2(r)} ${r2(r * 0.78)} 0 0 0 ${r2(sx - r)} ${r2(sy)}Z`;
  return tagKey([body, sideFace(shade, OP.sideSoft), topFace(gloss, OP.topSoft)],
    depthNow(cx, cy) + r);
}

/** 화면 1/4구 — 반구를 다시 앞뒤로 갈라 **뒤 절반**만 남긴 껍데기. 위 반원과, 세로로
 *  자른 단면(위로 부푼 타원 호) 사이의 초승달이다. 얼굴가리개 뒤에 한 겹 세우면 그것이
 *  곧 뒤통수를 감싸는 껍데기다. */
export function quarterSphereFaces3(
  cx: number, cy: number, cz: number, r: number, fill?: string,
): ShapeFace[] {
  const [sx, sy] = project(cx, cy, cz);
  const ry = r * groundSquashNow();
  const d = `M${r2(sx - r)} ${r2(sy)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(sx + r)} ${r2(sy)}`
    + `A${r2(r)} ${r2(ry)} 0 0 0 ${r2(sx - r)} ${r2(sy)}Z`;
  const body: ShapeFace = fill ? [d, 1, fill] : bodyFace(d);
  return tagKey([body, topFace(d, OP.topSoft)], depthNow(cx, cy) + r);
}

/** 공(구) 한 덩이 — 중심만 투영하고 반지름은 화면 원이다. 몸 + 좌상 광택 + 우하 그늘.
 *  광택·그늘은 몸 안쪽에 물려 두어(중심 오프셋 + 반지름 < 1) 어떤 크기에서도 실루엣
 *  밖으로 삐치지 않는다. 세계 광원과 같은 방향(좌상)이라 다른 부품과 결이 맞는다. */
export function sphereFaces3(
  cx: number, cy: number, cz: number, r: number, fill?: string,
): ShapeFace[] {
  const [sx, sy] = project(cx, cy, cz);
  const body: ShapeFace = fill
    ? [screenCircle(sx, sy, r), 1, fill]
    : bodyFace(screenCircle(sx, sy, r));
  return tagKey([
    body,
    sideFace(screenCircle(sx + r * 0.28, sy + r * 0.24, r * 0.68), OP.sideSoft),
    topFace(screenCircle(sx - r * 0.34, sy - r * 0.34, r * 0.3)),
  ], depthNow(cx, cy) + r);
}

/** 눕힌 원통(관) — 평면 두 점 사이를 반지름 r로 잇는다. 몸통 + (보이는 쪽) 끝 단면.
 *  단면 보임은 진행 방향이 시청자 쪽(+y)일 때 크고, 뒤로 가면 없다(캡 규칙). */
export function tubeFaces(
  x1: number, y1: number, x2: number, y2: number, r: number, z = 0, capOpen = false,
): ShapeFace[] {
  /* 원기둥 투영 그대로(재재수리·지적: 원통 끝면 처리) — 스타디움·벽 짜깁기를 걷고,
     원기둥의 실제 투영으로 그린다: 축 양끝의 단면 타원 두 장 + 그 사이 접선 사각.
     단면 타원은 축과 수직 지름이 2r, 축 방향 두께는 축이 화면을 마주보는 만큼
     (facing) 도톰해진다. 어느 요잉에서도 끝이 물리거나 뚫리지 않는다. */
  const zr = r * 0.9;
  const dzc = -zr / 2; // 예전 배치(투영선이 관의 배)와 눈높이를 맞추는 오프셋.
  const [ax0, ay0] = project(x1, y1, z);
  const [bx0, by0] = project(x2, y2, z);
  const ax = ax0;
  const ay = ay0 + dzc;
  const bx = bx0;
  const by = by0 + dzc;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const ml = Math.hypot(x2 - x1, y2 - y1) || 1;
  const fB = facingRatio((x2 - x1) / ml, (y2 - y1) / ml);
  const f = Math.abs(fB);
  // 축 방향 반두께 — 옆을 볼 땐 납작(내려다봄 몫만), 마주볼수록 원에 가깝다.
  const re = r * Math.max(0.22, f);
  const ang = r2((Math.atan2(dy, dx) * 180) / Math.PI);
  const endDisc = (ex: number, ey: number, k = 1): string => {
    const nx2 = len < 0.05 ? 0 : (-dy / len) * r * k;
    const ny2 = len < 0.05 ? r * k : (dx / len) * r * k;
    return `M${r2(ex + nx2)} ${r2(ey + ny2)} A${r2(re * k)} ${r2(r * k)} ${ang} 1 1 ${r2(ex - nx2)} ${r2(ey - ny2)}`
      + ` A${r2(re * k)} ${r2(r * k)} ${ang} 1 1 ${r2(ex + nx2)} ${r2(ey + ny2)} Z`;
  };
  const faces: ShapeFace[] = [bodyFace(endDisc(ax, ay)), bodyFace(endDisc(bx, by))];
  if (len >= 0.05) {
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    faces.push(bodyFace(`M${r2(ax + nx)} ${r2(ay + ny)} L${r2(bx + nx)} ${r2(by + ny)}`
      + ` L${r2(bx - nx)} ${r2(by - ny)} L${r2(ax - nx)} ${r2(ay - ny)} Z`));
    // 배 쪽 음영 띠 — 화면 아래쪽 긴 변.
    const ws: 1 | -1 = ny >= 0 ? 1 : -1;
    faces.push(sideFace(
      `M${r2(ax + nx * ws * 0.55)} ${r2(ay + ny * ws * 0.55)} L${r2(bx + nx * ws * 0.55)} ${r2(by + ny * ws * 0.55)}`
      + ` L${r2(bx + nx * ws)} ${r2(by + ny * ws)} L${r2(ax + nx * ws)} ${r2(ay + ny * ws)} Z`,
      OP.sideSoft,
    ));
  }
  /* 시청자를 향한 끝의 단면 — capOpen이면 어두운 포구, 아니면 옅은 끝판 씸(막힌
     원기둥의 끝면이 읽히게). 마주볼수록 또렷해진다. */
  if (f > 0.08) {
    const k = Math.min(1, (f - 0.08) / 0.4);
    const [ex, ey] = fB > 0 ? [bx, by] : [ax, ay];
    faces.push(capFace(endDisc(ex, ey, capOpen ? 0.78 : 0.92), (capOpen ? 0.42 : 0.14) * k));
  }
  const dA = depthNow(x1, y1);
  const dB2 = depthNow(x2, y2);
  return tagKey(faces, (dA + dB2) / 2 + Math.min(r * 2, Math.abs(dA - dB2) / 2));
}

/** 뿔·가시 — 평면 밑점(bx,by,z0)에서 평면 끝점(tx,ty,zt)으로 솟는 가는 원뿔. */
export function hornFaces(
  bx: number, by: number, z0: number, tx: number, ty: number, zt: number, w: number,
): ShapeFace[] {
  const [ax, ay] = project(bx, by, z0);
  const [cx2, cy2] = project(tx, ty, zt);
  const dx = cx2 - ax;
  const dy = cy2 - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  const body = `M${r2(ax + nx)} ${r2(ay + ny)} Q${r2((ax + cx2) / 2 + nx)} ${r2((ay + cy2) / 2 + ny)} ${r2(cx2)} ${r2(cy2)}`
    + ` Q${r2((ax + cx2) / 2 - nx)} ${r2((ay + cy2) / 2 - ny)} ${r2(ax - nx)} ${r2(ay - ny)} Z`;
  const shade = `M${r2(cx2)} ${r2(cy2)} Q${r2((ax + cx2) / 2 - nx)} ${r2((ay + cy2) / 2 - ny)} ${r2(ax - nx)} ${r2(ay - ny)}`
    + ` L${r2(ax - nx * 0.2)} ${r2(ay - ny * 0.2)} Z`;
  const dRt = depthNow(bx, by);
  const dTp = depthNow(tx, ty);
  return tagKey(
    [bodyFace(body), sideFace(shade, OP.sideSoft)],
    (dRt + dTp) / 2 + Math.min(Math.abs(zt - z0) + w, Math.abs(dRt - dTp) / 2),
  );
}
