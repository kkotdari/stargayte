/* ── 사선 입체(오블리크) 표준 규칙(요청: 매번 고치지 않게 유틸로) ─────────────────
   지도 위 건물·유닛 벡터는 전부 같은 시점 하나로 그린다: 위-앞의 xyz 사선 시점.
   16×16 뷰박스에 그리고, 면(face)은 [패스, 불투명도, 색?] 튜플을 겹쳐 만든다.

   면 규칙
   · 몸통(bodyFace) — 본색(currentColor) 그대로, 불투명 1.
   · 윗면(topFace) — 밝다: 본색 위에 흰 반투명을 겹친다(기본 0.3, 은은하게는 0.22~0.28).
   · 옆면·밑면(sideFace) — 어둡다: 검 반투명을 겹친다(기본 0.3, 은은하게 0.22, 깊게 0.35).
     빛은 왼쪽 위에서 온다고 치고, 어두운 면은 주로 오른쪽·아래쪽이다.
   · 지상 유닛은 채운 도형, 공중 유닛은 속을 뚫은 도형 — 하늘·땅이 한눈에 갈린다.

   감김(winding) 주의 — 해처리 본 기둥과 다리 사이가 자꾸 비던 원인:
   한 path 문자열 안의 부속 도형(M…Z 조각)들이 서로 겹칠 때, 감김 방향이 반대면
   nonzero 채움 규칙이 그 겹침을 구멍으로 뚫는다. 구멍을 내려는 것(공중 유닛의 속)이
   아니면 모든 조각을 같은 방향(시계)으로 감아야 한다. */

/** 겹쳐 그리는 면 하나 — [패스, 불투명도, 색?]. 색을 안 주면 currentColor. */
export type ShapeFace = [string, number, string?];

/** 몸통 — 본색 그대로. */
export const bodyFace = (d: string): ShapeFace => [d, 1];
/** 밝은 윗면 — 흰 반투명(기본 0.3). */
export const topFace = (d: string, opacity = 0.3): ShapeFace => [d, opacity, "#fff"];
/** 어두운 옆·밑면 — 검 반투명(기본 0.3). */
export const sideFace = (d: string, opacity = 0.3): ShapeFace => [d, opacity, "#000"];
