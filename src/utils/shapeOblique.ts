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
  cx: number, cy: number, rx: number, ry: number = rx * GROUND_SQUASH,
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

/** 표준 시점 상수 — 요잉 −20°(시계), 피칭 +(내려다보기). */
export const VIEW = {
  yawDeg: -20,
  /** 앞뒤(깊이)의 화면 눌림 — 바닥 원의 납작비와 같다. */
  squash: GROUND_SQUASH,
  /** 높이(z)의 화면 배율 — cos(내려다보는 각) ≈ 0.89. */
  zScale: 0.89,
  /** 화면 원점 — 발밑 가운데가 앉는 자리. */
  originX: 8,
  originY: 12.6,
} as const;

/** 모형 좌표 (x,y,z) → 화면 [sx, sy]. y(앞)는 아래로, z(위)는 위로 간다. */
export function project(x: number, y: number, z: number): [number, number] {
  const th = (VIEW.yawDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const rx = x * c + y * sn;
  const ry = -x * sn + y * c;
  return [r2(VIEW.originX + rx), r2(VIEW.originY + ry * VIEW.squash - z * VIEW.zScale)];
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
  return groundEllipse(sx, sy, r, r * VIEW.squash);
}

/** 세운 상자 — 바닥 중심 (cx,cy), 가로 w(x)·세로 d(y)·높이 h. 표준 시점에서는 앞면과
 *  오른면이 보인다: 몸통(앞면+오른면+윗면 실루엣) · 윗면 밝게 · 오른면 어둡게. */
export function boxFaces3(
  cx: number, cy: number, w: number, d: number, h: number, z0 = 0,
): ShapeFace[] {
  const hw = w / 2;
  const hd = d / 2;
  // 바닥 네 모서리(모형 공간) — 앞왼·앞오른·뒤오른·뒤왼.
  const fl: [number, number] = [cx - hw, cy + hd];
  const fr: [number, number] = [cx + hw, cy + hd];
  const br: [number, number] = [cx + hw, cy - hd];
  const bl: [number, number] = [cx - hw, cy - hd];
  const zt = z0 + h;
  const top = polyPath3([
    [fl[0], fl[1], zt], [fr[0], fr[1], zt], [br[0], br[1], zt], [bl[0], bl[1], zt],
  ]);
  const front = polyPath3([
    [fl[0], fl[1], zt], [fr[0], fr[1], zt], [fr[0], fr[1], z0], [fl[0], fl[1], z0],
  ]);
  const right = polyPath3([
    [fr[0], fr[1], zt], [br[0], br[1], zt], [br[0], br[1], z0], [fr[0], fr[1], z0],
  ]);
  return [bodyFace(`${front} ${right} ${top}`), sideFace(right), topFace(top)];
}

/** 세운 원통 — 바닥 중심 (cx,cy), 반지름 r, 높이 h. 몸통 + 밝은 윗면 + 오른쪽 세로 음영. */
export function cylinderFaces3(
  cx: number, cy: number, r: number, h: number,
): ShapeFace[] {
  const [bx, by] = project(cx, cy, 0);
  const [, ty] = project(cx, cy, h);
  const ry = r * VIEW.squash;
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
/** X축으로 길게 눕힌 각기둥 — profile은 단면(y,z) 꼭짓점들(위→앞→아래 차례), hw는 반길이.
 *  몸통(앞쪽 면들+오른쪽 끝 단면) + 첫 면(윗면) 밝게 + 끝 단면 어둡게. 팩토리류. */
export function prismXFaces(profile: [number, number][], hw: number): ShapeFace[] {
  const cap = polyPath3(profile.map(([y, z]) => [hw, y, z] as [number, number, number]));
  const quads: string[] = [];
  for (let i = 0; i < profile.length - 1; i += 1) {
    const [y1, z1] = profile[i];
    const [y2, z2] = profile[i + 1];
    quads.push(polyPath3([[-hw, y1, z1], [hw, y1, z1], [hw, y2, z2], [-hw, y2, z2]]));
  }
  return [bodyFace(`${quads.join(" ")} ${cap}`), sideFace(cap, OP.sideDeep), topFace(quads[0])];
}

/** 넙적 피라미드 — 바닥 (w×d), 꼭짓점 높이 h. 앞면+오른면 실루엣, 오른면 어둡게. */
export function pyramidFaces3(
  cx: number, cy: number, w: number, d: number, h: number, z0 = 0,
): ShapeFace[] {
  const hw = w / 2;
  const hd = d / 2;
  const apex: [number, number, number] = [cx, cy, z0 + h];
  const fl: [number, number, number] = [cx - hw, cy + hd, z0];
  const fr: [number, number, number] = [cx + hw, cy + hd, z0];
  const br: [number, number, number] = [cx + hw, cy - hd, z0];
  const bl: [number, number, number] = [cx - hw, cy - hd, z0];
  const front = polyPath3([apex, fl, fr]);
  const right = polyPath3([apex, fr, br]);
  const left = polyPath3([apex, bl, fl]);
  return [bodyFace(`${front} ${right} ${left}`), sideFace(right, OP.sideSoft)];
}

export function limbFaces(
  angleDeg: number, len: number, w: number, r0 = 1.6, capOpen = true,
): ShapeFace[] {
  const a = ((angleDeg + VIEW.yawDeg) * Math.PI) / 180;
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
  const beta = Math.abs(angleDeg + VIEW.yawDeg);
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
