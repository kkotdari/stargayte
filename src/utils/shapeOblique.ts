/* ── 사선 입체(오블리크) 공통 로직(요청: 표준화해서 매번 고치지 않게) ─────────────────
   지도 위 건물·유닛 벡터는 전부 같은 시점 하나로 그린다. 16×16 뷰박스 기준이다.

   시점 모델
   · 카메라 — 위-앞의 xyz 사선 시점(비스듬히 내려다봄). 지면은 화면 아래쪽, 높이는 위쪽.
   · 빛 — 왼쪽 위에서 온다. 윗면이 가장 밝고, 오른쪽 옆면·아랫면이 어둡다.
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
