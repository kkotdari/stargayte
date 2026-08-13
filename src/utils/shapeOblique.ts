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
export type ShapeFace = [string, number, string?];

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
/** 지금 유효한 바닥 납작비. */
export function groundSquashNow(): number {
  /* 0.66 → 0.55(수리: 넥서스 앞 바닥·기둥이 뷰박스 밖으로 잘렸다) — 앞쪽 깊이가
     원점(아래 originYNow)과 함께 16칸 안에 들어오는 선까지만 부감을 준다. */
  return pitchView ? 0.71 : topView ? 0.55 : GROUND_SQUASH;
}
function zScaleNow(): number {
  return pitchView ? 0.71 : topView ? 0.66 : 0.89;
}
function originYNow(): number {
  return pitchView ? 12.2 : topView ? 12 : 12.6;
}

/** 몸통 — 본색 그대로. */
export const bodyFace = (d: string): ShapeFace => [d, 1];
/** 밝은 윗면 — 흰 반투명(기본 OP.top). */
export const topFace = (d: string, opacity: number = OP.top): ShapeFace => [d, opacity, "#fff"];
/** 어두운 옆·밑면 — 검 반투명(기본 OP.side). */
export const sideFace = (d: string, opacity: number = OP.side): ShapeFace => [d, opacity, "#000"];
/** 원통·구멍의 단면 — 동굴 입구처럼 깊은 어둠(기본 OP.cap). */
export const capFace = (d: string, opacity: number = OP.cap): ShapeFace => [d, opacity, "#000"];

/** 바닥에 놓인 원(납작 타원) 패스 — 밝은 윗면·발판·고리에 두루 쓴다. */
export const groundEllipse = (
  cx: number, cy: number, rx: number, ry: number = rx * groundSquashNow(),
): string =>
  `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(rx * 2)} 0`
  + `a${r2(rx)} ${r2(ry)} 0 1 0-${r2(rx * 2)} 0Z`;

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

/* 세계 광원(요청: 모델을 돌려도 광원은 고정) — 왼쪽에서 약간 앞으로 비춘다. 세로 면의
   평면 법선(모형 기준)을 요잉만큼 돌려 광원과 내적: 왼쪽을 보는 면은 밝고 오른쪽을 보는
   면은 어둡다. 면이 시청자 쪽을 보는지도 여기서 판단한다. */
const LIGHT_PLAN: [number, number] = [-0.9, 0.45];
export function faceLight(nxModel: number, nyModel: number): { visible: boolean; face: (d: string) => ShapeFace[] } {
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
  return { visible: ny > 0.02, face };
}

/* 모형 내부 원근(요청: 모델 안에서도 원근법 — 건물은 특히) — 앞(시청자 쪽)으로 나온
   점은 크게, 뒤로 물러난 점은 작게. 발밑 원점을 눈 축으로 삼아 깊이 나눗셈을 한다.
   project를 지나는 모든 프리미티브(상자·절두·기둥·다리·관·뿔)가 저절로 받는다. */
const MODEL_PERSP = 30;
/** 모형 좌표 (x,y,z) → 화면 [sx, sy]. y(앞)는 아래로, z(위)는 위로 간다. */
export function project(x: number, y: number, z: number): [number, number] {
  const th = ((yawOverride ?? VIEW.yawDeg) * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const rx = x * c + y * sn;
  const ry = -x * sn + y * c;
  const f = MODEL_PERSP / (MODEL_PERSP - Math.max(-10, Math.min(10, ry)));
  /* 원근은 가로 수렴만(지적 둘: 높이까지 태우면 반대쪽이 들리는 가짜 롤, 깊이까지
     태우면 요잉한 옆구리가 앞으로 쏟아짐) — 세로선은 곧게, 앞뒤는 납작비 그대로. */
  return [r2(VIEW.originX + rx * f), r2(originYNow() + ry * groundSquashNow() - z * zScaleNow())];
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
  const [, ty] = project(cx, cy, z0 + h);
  const ry = r * groundSquashNow();
  const body = `M${r2(bx - r)} ${r2(ty)} L${r2(bx + r)} ${r2(ty)} L${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 1 1-${r2(r * 2)} 0Z`;
  const shade = `M${r2(bx + r * 0.35)} ${r2(ty)} L${r2(bx + r)} ${r2(ty)} L${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 0 1-${r2(r * 0.65)} ${r2(ry * 0.92)}Z`;
  return [bodyFace(body), sideFace(shade, OP.sideSoft), topFace(groundEllipse(bx, ty, r, ry))];
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
  return [bodyFace(bodyParts.join(" ")), ...out];
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
  const sides: { d: string; n: [number, number] }[] = [
    { d: polyPath3([apex, b[0], b[1]]), n: [0, 1] },
    { d: polyPath3([apex, b[1], b[2]]), n: [1, 0] },
    { d: polyPath3([apex, b[2], b[3]]), n: [0, -1] },
    { d: polyPath3([apex, b[3], b[0]]), n: [-1, 0] },
  ];
  const out: ShapeFace[] = [];
  const bodyParts: string[] = [];
  for (const f of sides) {
    const { visible, face } = faceLight(f.n[0], f.n[1]);
    if (!visible) continue;
    bodyParts.push(f.d);
    out.push(...face(f.d));
  }
  return [bodyFace(bodyParts.join(" ")), ...out];
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
  return faces;
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
  const sides: { d: string; n: [number, number] }[] = [
    { d: polyPath3([t[0], t[1], b[1], b[0]]), n: [0, 1] },
    { d: polyPath3([t[1], t[2], b[2], b[1]]), n: [1, 0] },
    { d: polyPath3([t[2], t[3], b[3], b[2]]), n: [0, -1] },
    { d: polyPath3([t[3], t[0], b[0], b[3]]), n: [-1, 0] },
  ];
  const out: ShapeFace[] = [];
  const bodyParts: string[] = [top];
  for (const f of sides) {
    const { visible, face } = faceLight(f.n[0], f.n[1]);
    if (!visible) continue;
    bodyParts.push(f.d);
    out.push(...face(f.d));
  }
  return [bodyFace(bodyParts.join(" ")), ...out, topFace(top)];
}

/** 반구 돔 — 회전 대칭이라 요잉 불변. 바닥 중심 (cx,cy,z0), 반지름 r, 높이 h. */
export function domeFaces3(
  cx: number, cy: number, r: number, hh: number, z0 = 0,
): ShapeFace[] {
  const [bx, by] = project(cx, cy, z0);
  const [, ty] = project(cx, cy, z0 + hh);
  const ry = r * groundSquashNow();
  const body = `M${r2(bx - r)} ${r2(by)} Q${r2(bx - r)} ${r2(ty)} ${r2(bx)} ${r2(ty)}`
    + ` Q${r2(bx + r)} ${r2(ty)} ${r2(bx + r)} ${r2(by)}`
    + `a${r2(r)} ${r2(ry)} 0 1 1-${r2(r * 2)} 0Z`;
  const shine = groundEllipse(bx - r * 0.25, (by + ty) / 2 - (by - ty) * 0.22, r * 0.4, r * 0.18);
  const shade = `M${r2(bx + r * 0.35)} ${r2(ty + (by - ty) * 0.08)} Q${r2(bx + r)} ${r2(ty + (by - ty) * 0.25)} ${r2(bx + r)} ${r2(by)}`
    + ` Q${r2(bx + r * 0.55)} ${r2(by + ry * 0.6)} ${r2(bx + r * 0.35)} ${r2(by)}Z`;
  return [bodyFace(body), sideFace(shade, OP.sideSoft), topFace(shine)];
}

/** 눕힌 원통(관) — 평면 두 점 사이를 반지름 r로 잇는다. 몸통 + (보이는 쪽) 끝 단면.
 *  단면 보임은 진행 방향이 시청자 쪽(+y)일 때 크고, 뒤로 가면 없다(캡 규칙). */
export function tubeFaces(
  x1: number, y1: number, x2: number, y2: number, r: number, z = 0, capOpen = false,
): ShapeFace[] {
  const [ax, ay] = project(x1, y1, z);
  const [bx, by] = project(x2, y2, z);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  const zr = r * 0.9;
  const body = `M${r2(ax + nx)} ${r2(ay + ny - zr)} L${r2(bx + nx)} ${r2(by + ny - zr)}`
    + ` A${r2(r)} ${r2(r * 0.8)} 0 0 1 ${r2(bx - nx)} ${r2(by - ny - zr)}`
    + ` L${r2(ax - nx)} ${r2(ay - ny - zr)}`
    + ` A${r2(r)} ${r2(r * 0.8)} 0 0 1 ${r2(ax + nx)} ${r2(ay + ny - zr)} Z`
    + ` M${r2(ax + nx)} ${r2(ay + ny - zr)} L${r2(bx + nx)} ${r2(by + ny - zr)}`
    + ` L${r2(bx + nx)} ${r2(by + ny)} L${r2(ax + nx)} ${r2(ay + ny)} Z`;
  const faces: ShapeFace[] = [bodyFace(body)];
  if (capOpen) {
    // 시청자 쪽 끝(화면 y가 큰 쪽)에만 어두운 단면.
    const toward = by >= ay ? [bx, by] : [ax, ay];
    faces.push(capFace(groundEllipse(toward[0], toward[1] - zr / 2, r * 0.85, r * 0.7)));
  }
  faces.push(sideFace(
    `M${r2(ax + nx)} ${r2(ay + ny - zr * 0.2)} L${r2(bx + nx)} ${r2(by + ny - zr * 0.2)} L${r2(bx + nx)} ${r2(by + ny)} L${r2(ax + nx)} ${r2(ay + ny)} Z`,
    OP.sideSoft,
  ));
  return faces;
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
  return [bodyFace(body), sideFace(shade, OP.sideSoft)];
}
