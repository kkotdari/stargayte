import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Avatar from "../common/Avatar";
import RaceBadge from "../common/RaceBadge";
import { cx } from "../../utils/format";
import type { ReplayMapGrid } from "../../utils/replayParser";
import type { Race } from "../../types";

// 경기 한 판의 미니맵 — 지형 그림 위에 본진 아바타·화살표를 얹는다.
//
// 지형 그림은 운영자가 올려 둔 실제 미니맵 하나뿐이다(운영 > 미니맵). 그림이 없는 맵은
// 이 컴포넌트를 아예 안 그리고 안내 문구만 띄운다(GameResultStory) — 한때 리플레이의 타일
// 격자로 그린 개략도를 대신 깔았지만, 타일 번호만으로 물·풀·땅·벽을 갈라 보려던 네 번의
// 시도가 다 실패해(ReplayMapCanvas 주석) 무슨 지형인지 못 읽는 그림만 남았다.
// 마커·화살표는 좌표를 맵 크기 비율로 얹으므로 그림의 픽셀 크기와 무관하게 제자리에 놓인다.

// 본진 아바타 크기 — 지금 문장의 주인공(ON)과 나머지(OFF). 차이를 크게 벌려 둔다(요청:
// 언급된 유저는 더 확실하게 크게, 기본은 축소).
const AVATAR_ON = 28;
const AVATAR_OFF = 13;

/** 본진에서 그 일이 있었던 자리까지 이어지는 화살표 하나(요청). 공격만이 아니라 "센터에
 *  포토를 지었다"처럼 자리가 남는 모든 장면이 대상이다. */
export interface MinimapArrow {
  key: string;
  /** 타일 좌표 — 시작(본진)과 끝(공격 자리). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  team: 1 | 2 | undefined;
  /** 날아서·워프로 간 것인가 — 곧은 점선으로 그린다. 지상은 곡선(요청). */
  flight: boolean;
  /** 상대 진영 안까지 과감하게 들어가도 되는가 — 일대일이고 상대 멀티가 없어서 목표가
   *  하나뿐일 때만 켠다(요청). 켜지면 끝 간격을 줄여 화살촉이 적진에 더 붙는다. */
  deep?: boolean;
  /** 화살촉 끝에 얹을 이모지 — 무슨 일인지 한 글자로 알려 준다(요청: 공격은 검 대결, 아군
   *  지원은 천사, 핵은 핵폭발 …). 없으면 안 그린다. */
  mark?: string;
  /** 화살표가 시작하는 자리에 얹을 이모지 — 리콜·커널처럼 '여기서 저기로 건너간' 수는
   *  출발점도 사건이다(요청: 원본 위치는 회오리, 이동 위치는 별 반짝). 없으면 안 그린다. */
  markFrom?: string;
  /** 기둥 위(촉 가까운 쪽)에 얹을 짧은 글 — 그 사람이 무엇으로 갔는지다(요청: 화살촉 위가
   *  아니라 기둥 위 촉에 가까운 쪽에 유닛 캡션). 유닛마다 한 줄씩 쌓는다(요청) — 가로로
   *  이으면 두 종류만 돼도 띠가 길어져 지도를 가리고, 모이는 화살표끼리 서로 겹친다.
   *  없거나 비어 있으면 안 그린다. */
  label?: string[];
  /** 화살표 목(촉 바로 뒤 기둥 위)에 얹을 이모지 — 그 화살표가 어떤 길인지를 말한다
   *  (요청: 팀원을 도와준 화살표에 천사 날개를, 화살표 끝 말고 목쯤에). 없으면 안 그린다. */
  markNeck?: string;
  /** 기둥 굵기(SVG stroke-width, 타일 좌표계) — 그 화살표에 실린 병력이 클수록 굵다
   *  (요청: 병력 규모에 따라 화살표 두께도 다르게). 없으면 CSS 기본값을 그대로 쓴다. */
  width?: number;
  /** 여러 화살표가 한 점에서 만나는가 — 양 팀이 부딪친 자리가 그렇다(요청: 상대편끼리
   *  충돌한 경우 화살표는 한곳으로 모여야 한다). 보통 화살표는 목표 앞에서 조금씩 다르게
   *  멈추고(길이에 비례한 여백) 이모지도 촉 앞에 따로 서는데, 그러면 같은 자리를 겨눈
   *  화살표들이 제각각 다른 데서 끝나 '모였다'로 안 읽힌다. 이 표가 붙으면 여백 없이
   *  목표에 정확히 닿고, 이모지도 그 점 위에 선다. */
  converge?: boolean;
  /** 같은 점에 모인 화살표들 사이의 순번 — 이름표를 서로 어긋나게 앉히는 데만 쓴다
   *  (위 LABEL_BACK_STEP). 안 붙이면 0으로 본다. */
  rank?: number;
}

// 화살표 모양 — 값은 모두 타일 단위다(SVG viewBox가 타일 격자와 같다).
//
// 지상 이동을 곡선으로 그리라는 요청이 있었지만, 실제 이동 경로를 리플레이에서 알 수는 없다
// (위 주석: 어디가 절벽이고 어디가 다리인지 모른다). 그래서 '가운데 쪽으로 조금 휘는' 곡선을
// 쓴다 — 스타에서 지상군은 본진을 나와 가운데 길로 돌아 들어가기 때문에, 곧은 직선보다 이게
// 실제 동선에 가깝다. 대각(크로스) 자리끼리는 현이 이미 가운데를 지나므로 자연히 직선이
// 된다(휘는 양이 0이 된다). 벽을 정확히 피해 가는 경로는 지형 표가 없으면 그릴 수 없다.
// 휘는 양(현 길이 대비) — 실제로는 더 크게 돌아가는 일이 많아 키웠다(요청).
const BEND = 0.4;
/** 시작·끝에서 이만큼 띄운다 — 아바타 밑에서 시작하면 화살표가 아바타에 가려 안 보인다.
 *  아바타를 CSS scale로 키우면서(요청: 평상시 크기 확대) 예전 값으로는 커진 아바타 밖으로
 *  화살 기둥이 삐져나와 보였다(지적: "화살기둥 끝이 아바타에 숨겨지지 않고 구분됨") —
 *  더 넉넉히 띄운다. */
const GAP_FROM = 7;
/* 끝은 더 넉넉히 띄운다 — 목표 자리에는 그 사람 본진 아바타(커지면 지름 28px+테두리)가 있어
   화살촉이 그 밑에 들어가 안 보였다(지적: "화살촉이 다른 요소들에 가려짐"). */
/* 끝은 목표 본진 한가운데를 겨눈다(요청: 타겟 아바타가 아니라 본진 중앙을 향하게) —
   화살촉이 아바타 밑으로 들어가지 않을 만큼만 남기고 바짝 붙인다. */
const GAP_TO = 3.5;
/** 일대일에서 목표가 하나뿐일 때는 이만큼만 띄운다 — 적진에 더 붙여 그린다(요청). */
const GAP_TO_DEEP = 2.5;
/** PC에서 자막을 지도 가장자리로부터 얼마나 안쪽에 두나(지도 대비) — 고른 방향은 그대로
 *  두되 가운데 언저리에서만 움직이게 한다(요청). CSS의 PC 규칙(.scr-minimap-caption-top 등)에
 *  같은 값이 여백으로 들어가 있으니 둘을 함께 고쳐야 한다. 세로가 더 큰 건 지도에서 위아래
 *  구석이 대체로 더 비어 있어서다 — 그만큼 더 들어와도 가릴 것이 없다. */
const CAP_PULL_X = 0.12;
const CAP_PULL_Y = 0.18;
/** 이보다 짧은 화살표는 그리지 않는다 — 자기 본진 안에서 벌어진 일은 '어디로 갔다'가 아니다.
 *  부르는 쪽에서도 같은 기준으로 걸러 낼 수 있게 내보낸다. */
export const ARROW_MIN_TILES = 8;
const MIN_LEN = ARROW_MIN_TILES;
const HEAD_LEN = 4.6;
const HEAD_WIDE = 2.6;
/** 이모지가 들어갈 자리(타일) — 이모지를 붙일 화살표는 그만큼 짧게 그린다(지적: 이모지 자리
 *  만큼 화살표를 줄여야 겹쳐서 정신없지 않다). 이모지를 15 → 26px로 키우면서(요청: 화살표에
 *  비해 액션 아이콘이 작음) 이 자리도 같은 비율로 늘린다 — 안 늘리면 커진 이모지가 화살촉과
 *  겹친다(지적: 화살표와 화살표 끝 이모지가 겹침). */
const MARK_ROOM = 12;
/** 그 자리 안에서 이모지를 화살촉보다 이만큼 앞에 둔다. */
const MARK_AHEAD = 5;
/** 한 점에 모이는 화살표(큰 싸움)를 만나는 점에서 이만큼 못 미쳐 끝낸다 — 그 점 위에는
 *  교전 이모지가 서 있어서, 여백 없이 정확히 닿게 두면 화살촉들이 이모지 밑에 통째로
 *  깔린다(지적: "화살표 끝에서 교전 표시할 때 폭발 이모지에 화살촉들이 가려짐. 화살표 끝
 *  위치를 좀 당겨서 보이게 하자"). 이모지가 차지하는 자리(MARK_ROOM)의 반지름만큼 물리면
 *  촉이 그 가장자리 바로 밖에 선다 — 여전히 한 점을 둘러싸고 모이는 그림이다. */
const CONVERGE_GAP = MARK_ROOM / 2 + 1;
/** 유닛 이름표를 화살촉에서 이만큼 뒤(기둥 쪽)에 둔다(요청: 촉 위가 아니라 기둥 위,
 *  촉에 좀 가까운 쪽). 촉 위에 얹으면 촉을 덮고, 기둥 한가운데에 두면 어느 화살표의
 *  이름표인지 헷갈린다 — 촉 바로 뒤가 둘 다 피하는 자리다. */
const LABEL_BACK = 9;
/** 화살표 '목' — 촉 밑동에서 기둥 쪽으로 이만큼 물러선 자리(요청: 화살표 끝 말고 목쯤에).
 *  이름표(LABEL_BACK)보다 앞이라 둘이 같은 자리에 겹치지 않는다. */
const NECK_BACK = 3.4;
/** 한 점으로 모이는 화살표(큰 싸움)의 이름표는 더 뒤로 물린다 — 일곱 개가 한 점에 모이면
 *  촉 바로 뒤는 사실상 같은 자리라 이름표가 서로 겹쳐 읽히지 않는다(실측 스크린샷:
 *  "탱크·사이언스베러커·히드라"). 뒤로 갈수록 화살표들이 부채처럼 벌어지므로, 그만큼
 *  물리면 저절로 서로 떨어진다. */
const LABEL_BACK_CONVERGE = 22;
/** 같은 점에 모인 화살표끼리 이름표를 어긋나게 앉히는 간격(순번마다 이만큼 더 뒤로). */
const LABEL_BACK_STEP = 13;
/** 겹친 이름표를 출발 쪽으로 밀어낼 수 있는 한계(기둥 길이 대비) — 그보다 뒤는 출발한
 *  사람의 아바타·이름표 자리라, 거기까지 밀면 이번엔 그쪽과 겹친다. */
const LABEL_SLIDE_MAX = 0.78;
/* (삭제) 본진 이모지를 맵 가운데 쪽으로 멀리 띄우던 값(MARK_OUT/MARK_EDGE) — 이제 액션
   이모지는 아바타의 '위 안쪽' 슬롯에 고정으로 앉는다(아래 markPlace). 멀리 띄우면 본진이
   지도 어디에 있느냐에 따라 이름표·표정과 같은 칸에 몰리는 조합이 생겼다(지적). */

/** 팀 색 — 미니맵은 지형 위라 채도가 낮으면 두 편이 잘 안 갈린다(요청: 팀 구분이
 *  더 확실하게). CSS의 마커 테두리 색과 같은 값을 쓴다. */
const TEAM_COLOR: Record<number, string> = { 1: "#2b9bff", 2: "#ff4d68" };

/** 화살표 하나를 SVG 경로와 머리 삼각형으로 바꾼다. 그릴 값이 없으면 null. */
function arrowGeom(a: MinimapArrow, w: number, h: number) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  if (len < MIN_LEN) return null;
  const ux = dx / len;
  const uy = dy / len;
  // 짧은 화살표는 띄우는 양·머리 크기를 길이에 맞춰 줄인다 — 고정값을 쓰면 가까운 곳으로 간
  // 화살표가 몸통 없이 화살촉만 남아 지형 위에 얼룩처럼 찍혔다(실측 스크린샷).
  const gapFrom = Math.min(GAP_FROM, len * 0.2);
  // 이모지를 붙일 화살표는 그 자리만큼 더 짧게 끝낸다 — 안 그러면 이모지가 화살촉·목표
  // 아바타와 겹쳐 뭉친다(지적).
  // 한 점에 모이는 화살표는 그 점을 조금 못 미쳐 끝낸다 — 점 위에 선 교전 이모지에 촉이
  // 가리지 않을 만큼만(CONVERGE_GAP). 이모지 자리(MARK_ROOM)를 통째로 비우지는 않는다:
  // 그 이모지는 촉 앞이 아니라 만나는 점 위에 하나만 서기 때문이다(아래 tip).
  const gapTo = a.converge ? Math.min(CONVERGE_GAP, len * 0.3)
    : Math.min(a.deep ? GAP_TO_DEEP : GAP_TO, len * 0.22) + (a.mark ? MARK_ROOM : 0);
  const headLen = Math.min(HEAD_LEN, len * 0.3);
  const headWide = HEAD_WIDE * (headLen / HEAD_LEN);
  // 지상(곡선) 화살표는 아바타 한가운데가 아니라 '맵 가운데 쪽 가장자리'에서 나온다(요청) —
  // 병력은 본진 안쪽이 아니라 나가는 쪽에서 출발하므로 그림이 훨씬 자연스럽다. 곧은
  // 화살표(공중·워프)는 지금처럼 아바타 한가운데에서 나온다(요청).
  const ox = a.flight ? ux : (w / 2 - a.x1);
  const oy = a.flight ? uy : (h / 2 - a.y1);
  const ol = Math.hypot(ox, oy) || 1;
  const x1 = a.x1 + (ox / ol) * gapFrom;
  const y1 = a.y1 + (oy / ol) * gapFrom;
  const x2 = a.x2 - ux * gapTo;
  const y2 = a.y2 - uy * gapTo;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let cx0 = mx;
  let cy0 = my;
  if (!a.flight) {
    // 현에 수직인 방향 중 맵 가운데를 향하는 쪽으로 휜다. 휘는 양은 '가운데까지의 수직
    // 거리'를 넘지 않게 잡는다 — 그래서 현이 이미 가운데를 지나면 휘지 않는다.
    const nx = -uy;
    const ny = ux;
    const d = nx * (w / 2 - mx) + ny * (h / 2 - my);
    const amt = Math.sign(d) * Math.min(len * BEND, Math.abs(d));
    cx0 = mx + nx * amt;
    cy0 = my + ny * amt;
  }
  // 머리 방향은 곡선의 끝 접선(2차 베지에는 끝점 - 제어점).
  const tx = x2 - cx0;
  const ty = y2 - cy0;
  const tl = Math.hypot(tx, ty) || 1;
  const hx = tx / tl;
  const hy = ty / tl;
  const bx = x2 - hx * headLen;
  const by = y2 - hy * headLen;
  /* 기둥 위의 한 점을 '촉에서 얼마나 뒤'로 재서 집는다.

     여태 이 계산은 촉의 접선(hx,hy)을 따라 곧게 되짚었다 — 곧은 화살표(공중·워프)에서는
     그게 곧 기둥이지만, 지상 화살표는 휘어 있어서(위 Q 제어점) 되짚은 직선이 곡선에서
     점점 벌어진다. 많이 휜 화살표일수록 이름표가 선에서 멀리 떨어져 앉았다(지적 스크린샷:
     태섭 본진으로 모이는 파란 화살표들의 "저글링/질럿/마린"이 선 밖에 떠 있다).

     그래서 직선이 아니라 곡선 자신을 되짚는다. 2차 베지에는 닫힌 호길이 식이 없으므로
     끝에서부터 잘게 나눠 재고, 재던 거리를 넘어서는 토막 안에서 선형으로 끊는다.
     스물네 토막이면 이 지도 크기(128타일)에서 오차가 눈에 안 띈다(실측). */
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * x1 + 2 * u * t * cx0 + t * t * bx, u * u * y1 + 2 * u * t * cy0 + t * t * by];
  };
  const STEPS = 24;
  /** 촉 밑동에서 기둥을 따라 dist(타일)만큼 물러선 점. 기둥보다 멀면 출발점에서 멈춘다. */
  const backOnCurve = (dist: number): [number, number] => {
    let prev = at(1);
    let acc = 0;
    for (let i = STEPS - 1; i >= 0; i--) {
      const p = at(i / STEPS);
      const seg = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (acc + seg >= dist) {
        const k = seg > 0 ? (dist - acc) / seg : 0;
        return [prev[0] + (p[0] - prev[0]) * k, prev[1] + (p[1] - prev[1]) * k];
      }
      acc += seg;
      prev = p;
    }
    return prev;
  };
  /** 기둥의 실제 길이(호길이) — 이름표를 얼마나 물릴 수 있나가 이 값에 매인다. 현(직선
   *  거리)으로 재던 값은 휜 화살표에서 실제보다 짧아, 물릴 자리가 있는데도 안 물렸다. */
  const shaft = (() => {
    let acc = 0;
    let prev = at(0);
    for (let i = 1; i <= STEPS; i++) {
      const p = at(i / STEPS);
      acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    return acc;
  })();
  /** 그 점에서 '출발점 쪽'을 가리키는 접선 — 겹친 이름표를 밀어낼 방향이다. 곡선에서는
   *  촉의 접선과 다르므로, 미는 방향도 그 자리의 기울기를 따라야 선 위에 남는다. */
  const slideDir = (dist: number): [number, number] => {
    const p = backOnCurve(dist);
    const q = backOnCurve(Math.min(shaft, dist + 4));
    const dxx = q[0] - p[0];
    const dyy = q[1] - p[1];
    const l = Math.hypot(dxx, dyy);
    return l > 0 ? [dxx / l, dyy / l] : [-hx, -hy];
  };
  /** 이름표가 촉에서 물러설 거리 — label과 slide가 같은 값을 봐야 둘이 어긋나지 않는다. */
  const labelBack = Math.min(
    (a.converge ? LABEL_BACK_CONVERGE : LABEL_BACK) + (a.converge ? LABEL_BACK_STEP * (a.rank ?? 0) : 0),
    shaft / 2,
  );
  return {
    // 기둥은 화살촉 끝(x2,y2)이 아니라 촉의 밑동(bx,by)에서 멈춘다(지적: "화살촉 밑으로
    // 기둥 끝이 보임") — 촉 전체를 기둥이 관통해 그리면, 촉이 뾰족해지는 자리에서 굵은
    // 기둥이 삼각형 옆으로 삐져나와 보인다.
    d: `M ${x1} ${y1} Q ${cx0} ${cy0} ${bx} ${by}`,
    head: `${x2},${y2} ${bx - hy * headWide},${by + hx * headWide} ${bx + hy * headWide},${by - hx * headWide}`,
    // 이모지 자리 — 화살촉 바로 앞. 촉을 덮지 않고, 목표 아바타에도 닿지 않는 사이다.
    tip: (a.converge ? [a.x2, a.y2] : [x2 + hx * MARK_AHEAD, y2 + hy * MARK_AHEAD]) as [number, number],
    // 출발 쪽 이모지 자리 — 몸통이 시작하는 점 그대로. 아바타에서 이미 gapFrom만큼
    // 띄워 둔 자리라 아바타를 덮지 않는다.
    from: [x1, y1] as [number, number],
    /** 화살표 '목' — 촉 바로 뒤 기둥 위(요청). 촉에 붙는 이모지(tip)와 달리 목표를 덮지
     *  않아서, 그 화살표 자체의 성질(아군을 도우러 간 길이라는 표시)을 얹기에 맞다. */
    neck: backOnCurve(Math.min(NECK_BACK, shaft / 2)),
    /* 유닛 이름표 자리 — 촉의 밑동에서 기둥 쪽으로 조금 물러선 점(요청). 짧은 화살표에서는
       그만큼 물러설 기둥이 없어 출발점을 지나쳐 버리므로, 기둥 길이의 절반을 넘지 않게
       묶는다. */
    label: (() => {
      /* 한 점으로 모이는 화살표들은 뒤로 물려도 서로 겹칠 수 있다 — 세 개가 거의 같은
         각도로 들어오면 같은 거리에서는 여전히 한 자리다(실측: "히히드라러커/아비터").
         그래서 물리는 거리를 화살표마다 조금씩 달리 준다(rank) — 부채처럼 벌어지는 효과에
         더해, 아예 다른 높이에 앉아 글자가 안 포갠다.
         여기서 나온 자리는 어림값이다 — 글자가 실제로 얼마나 넓은지는 그려 보기 전엔
         모르므로, 그래도 겹치면 그린 뒤 실측해서 출발 쪽으로 밀어낸다(아래 labelSlide). */
      return backOnCurve(labelBack);
    })(),
    /** 이름표를 더 밀어낼 수 있는 방향(촉에서 출발점 쪽, 타일 단위 단위벡터)과 남은 거리
     *  (타일) — 그린 뒤 글자끼리 겹쳤을 때 얼마나 물릴 수 있는지를 실측 보정이 여기서 읽는다.
     *  기둥의 LABEL_SLIDE_MAX까지만 물러선다: 그보다 뒤는 출발한 사람 아바타·이름표 자리다. */
    slide: (() => {
      const back = labelBack;
      return {
        /* 미는 방향은 촉의 접선이 아니라 이름표가 앉은 자리의 기울기다 — 휜 화살표에서
           촉 접선으로 밀면 밀수록 선에서 멀어진다(이름표를 곡선 위로 옮긴 것과 같은 이유). */
        dir: slideDir(back),
        room: Math.max(0, shaft * LABEL_SLIDE_MAX - back),
        /* 촉 쪽으로도 조금은 갈 수 있다 — 자막이 이름표 바로 아래에 앉으면 뒤로는 자막을
           지나칠 만큼 기둥이 없고(실측: 76px 필요, 58px뿐), 앞으로 열댓 px이면 벗어난다.
           촉에서 LABEL_BACK만큼은 남긴다: 그보다 붙으면 화살촉·이모지를 덮는다. */
        fwd: Math.max(0, back - LABEL_BACK),
      };
    })(),
  };
}

/** 미니맵 위에 놓을 표시 하나. */
/* ── 아바타 밑 기세 눈금(요청) ────────────────────────────────────────────────
   이 값이 재는 것은 "지금 얼마나 굴리고 있나"다 — 최근 창(replaySummary의 POWER_WINDOW_SEC)
   안에 나온 병력에 세워 둔 기반을 더한 것이고, 같은 장면 1등에 견준 비율이다.

   한동안 체력바로 그렸는데 뜻이 어긋나게 읽혔다(지적: "실제로는 활성도에 가까운 거라
   체력바가 아니라 다른 형태로 표시해야 맞을 것 같다"). 세 가지가 걸렸다.
     · 막대가 차 있다 = 안 다쳤다로 읽힌다. 짧으면 "죽어간다"인데 실제 뜻은 "요즘 조용하다"다.
     · 초록→노랑→빨강은 위험 신호다. 조용한 것은 위험이 아니라 모으는 중일 수도 있다.
     · 1등은 늘 꽉 찬 초록이다. 체력이라면 "한 번도 안 맞았다"가 되는데 그건 사실이 아니다.

   그래서 이어진 막대가 아니라 다섯 칸 눈금이다. 이어진 막대는 "이 값은 정밀하다"고 약속하는데
   리플레이에는 죽음이 없어 이 값은 그만큼 정밀하지 않다 — 눈금은 "대충 이 정도 급"까지만
   약속하므로 아는 만큼만 말하는 셈이다. 여덟이 나란히 서도 칸 수만 세면 견줘지고, 색이
   하나뿐이라(채움/빔) 위험 신호로 읽힐 여지도 없다. */
const VIGOR_PIPS = 5;
function VigorPips({ power, peak }: { power: number; peak: number }) {
  const ratio = peak > 0 ? Math.max(0, Math.min(1, power / peak)) : 0;
  /* 반올림하되 0이 아니면 한 칸은 남긴다 — 아주 뒤진 사람도 '거기 있다'는 것 자체는
     보여야 한다(옛 막대의 최소 길이 8%가 하던 일이다). */
  const on = ratio <= 0 ? 0 : Math.max(1, Math.round(ratio * VIGOR_PIPS));
  return (
    <span className="scr-minimap-vigor" aria-hidden>
      {/* 눈금 앞에 오른쪽으로 달리는 사람 하나(요청) — 칸 다섯만 놓여 있으면 그것이 무엇을
          재는 눈금인지 그림 안에서 알 길이 없다(체력으로 읽힌 적도 있다, 위 주석). 달리는
          사람은 '얼마나 굴리고 있나'와 곧바로 이어지는 그림이라, 글자 한 줄 없이도 이
          눈금의 이름표 노릇을 한다(톱니바퀴로 뒀다가 바꿨다 — 요청).
          방향까지 정해진 글자를 쓴다(🏃‍➡️) — 그냥 🏃는 글꼴마다 왼쪽을 보기도 해서, 눈금이
          오른쪽으로 차오르는 그림과 방향이 어긋난다. */}
      <span className="scr-minimap-vigor-icon">🏃‍➡️</span>
      {Array.from({ length: VIGOR_PIPS }, (_, i) => (
        <span key={i} className={cx("scr-minimap-vigor-pip", i < on && "scr-minimap-vigor-pip-on")} />
      ))}
    </span>
  );
}

export interface MinimapMarker {
  /** 리플레이 원본 게임 아이디 — 목록 키로도 쓴다. */
  key: string;
  /** 화면에 보일 이름. */
  name: string;
  avatar: string | null;
  memberId: string;
  /** ""는 screp이 종족을 못 읽은 드문 경우 — RaceBadge가 그대로 받아 빈칸으로 그린다. */
  race: Race | "";
  team: 1 | 2 | undefined;
  /** 타일 좌표. */
  x: number;
  y: number;
  /** 이름까지 함께 보일까 — 본진 표시는 이름을 단다(요청). */
  withName: boolean;
  /** 검색 중 짚어야 할 사람인가 — 로스터를 감춘 모바일에서는 여기가 유일한 표시 자리다. */
  highlight: boolean;
  /** 그 시점에 궤멸됐거나 빈사 상태인가 — 본진에 해골을 얹는다(요청). */
  downed?: boolean;
  /** 크게 다쳤지만 아직 끝난 건 아닌 상태(요청: 큰 타격·빈사는 해골 말고 반창고만) —
   *  해골과 같은 자리에 ❤️‍🩹만 얹고 아바타는 흑백으로 안 누른다. */
  hurt?: boolean;
  /** 지금 문장에 이름이 나온 사람인가 — 아바타를 크게 키운다(요청). */
  featured?: boolean;
  /** 버리고 떠난 옛 본진인가 — 흑백으로만 남긴다(요청: 본진을 버리고 이동한 경우 본진은
   *  흑백 처리하고 새 기지에 마크를 옮긴다). */
  ghost?: boolean;
  /** 본진에 붙일 이모지 — 화살표가 없는 이야기(생산·테크·경제)에 쓴다(요청: 생산에도 본진에
   *  열심히 생산하는 이모지). 자리는 markAt이 정한다 — 아바타 위가 아니다(요청). */
  mark?: string;
  /** 그 이모지를 얹을 자리(타일) — 본진이 아닌 곳에서 벌어진 일에 쓴다. 입구막기·입구
   *  방어가 그렇다: 그건 본진 안이 아니라 나가는 길목의 이야기라, 이모지도 진짜 입구
   *  자리에 서야 한다(지적: "입구도 본진 입구를 말한 거야 아바타 위가 아니라").
   *  본진에서 한 일이면 그 사람 본진 건물이 실제로 선 자리(요약의 hubs)가 들어온다.
   *  값이 없으면(옛 요약) 본진 자리(x, y) 그대로. */
  markAt?: [number, number];
  /** 그 이모지가 '무엇으로 한 일'인가 — 유닛·건물 이름을 이모지 밑에 적는다(요청: 방패
   *  이모지에도 캡션). 화살표가 있는 이야기는 기둥 위 이름표가 이 일을 하는데, 화살표
   *  없이 본진·입구에 이모지만 서는 이야기에는 그 자리가 없었다. */
  markText?: string;
  /** 아바타 위에 겹쳐 그리는 상태 얼굴 — 트로피·공격자·당한 정도·아군 헬프처럼 그 사람
   *  자체를 가리키는 표시에 쓴다(요청: 해골·트로피 말고도 아바타로 상태를 알려 달라). */
  face?: string;
  /** face가 승리 트로피인가 — 다른 상태 얼굴과 달리 더 크고 계속 바운스한다(요청). */
  faceIsTrophy?: boolean;
  /** 그 판의 BEST PLAYER인가 — 승패 스냅에서만 세운다(요청: 결론 장면 아바타에 표시).
   *  이긴 편 전원이 트로피를 받는 자리라, 그중 한 사람을 가리키는 표시가 따로 필요하다. */
  best?: boolean;
  /** 시작 스냅인가 — 로스터 없이 "게임 시작!"만 보여주는 자리라, 닉네임 글자도 아바타만큼
   *  키운다(요청: 시작시 로스터 대신 아바타·닉네임 확대). */
  introBig?: boolean;
  /** 이 사람이 그 무렵 한 말 — 아바타 위에 말주머니로 띄운다(요청: 스냅으로 선정한 부근의
   *  채팅만 말주머니로). 양쪽이 다 본 말(전체챗)만 온다(요청: 팀챗 없애고 전체챗만). */
  bubble?: string;
  /** 그 시각까지 갖춘 규모(병력 + 건물 몫; 요약의 hp). 닉네임 밑 기세 눈금이 쓴다 —
   *  길이는 규모, 색은 같은 시각의 적정치에 견준 상태다(요청). 없으면 바를 안 그린다. */
  power?: number;
  /** 그 스냅의 시각(초) — 적정치가 시간에 비례해 오르므로 색을 정하려면 필요하다. */
  powerAtSec?: number;
}

export default function ReplayMinimap({
  grid, bases, arrows = [], onStep, className, caption,
}: {
  grid: ReplayMapGrid;
  /** 늘 보이는 본진 표시(요청: 본진은 아바타+닉네임 계속 표시). 지금 문장의 주인공은
   *  featured로 크게 그린다 — 자리마다 아바타를 따로 띄우는 표시는 없앴다(요청). */
  bases: MinimapMarker[];
  /** 본진 → 그 일이 있었던 자리로 잇는 화살표(요청). */
  arrows?: MinimapArrow[];
  /** 그림 좌·우 절반을 눌러 장면을 옮긴다(요청) — -1이면 이전, +1이면 다음. */
  onStep?: (delta: -1 | 1) => void;
  className?: string;
  /** 자막 — 별도 패널 없이 미니맵 가운데에 얹는다(요청: 자막 패널을 없애고 자막을 미니맵
   *  가운데에 노출). 클릭은 그대로 지도 좌우 절반(.scr-minimap-half)에 떨어져야 하므로
   *  이 레이어는 pointer-events:none이다. */
  caption?: ReactNode;
}) {
  /* 이름표가 프레임 밖(카드 자체의 바깥 패딩)까지 나가면 그만큼 안으로 되돌린다(지적:
   * "이름표가 밖으로 나가면 보정해서 안으로 이동시키라고 했잖아") — 닉네임 글자 수마다
   * 실제로 얼마나 튀어나오는지는 그려 보기 전엔 모르니, 어림값을 아무리 잘 잡아도
   * 완벽할 수 없다. 그려진 뒤 실제 자리를 재서(getBoundingClientRect) 튀어나온 만큼만
   * 보정값으로 얹는다 — 페인트 전에 반영해야 눈에 깜빡임이 없다(useLayoutEffect). */
  /** 재는 기준은 지도 자체다 — 예전에는 바깥 프레임이었다. 이름표를 지도 안에 두기로
   *  했으니(labelPlace) 넘어가면 안 되는 선도 지도 가장자리다. */
  const frameRef = useRef<HTMLDivElement>(null);
  const labelElsRef = useRef<Map<string, HTMLSpanElement>>(new Map());
  /** 본진 액션 이모지 엘리먼트 — 이름표가 그 위에 얹히지 않게 실제 자리를 재는 데 쓴다. */
  const markElsRef = useRef<Map<string, HTMLSpanElement>>(new Map());
  const [labelFix, setLabelFix] = useState<Map<string, { x: number; y: number }>>(new Map());
  /** 자막 상자 — 자리를 고르려면 '이 자막이 실제로 얼마나 덮나'를 알아야 한다. 폭은 CSS가
   *  정하니 계산으로 알지만(아래 wideCaption), 높이는 문장이 몇 줄이 되느냐라 그려 보기
   *  전엔 모른다. 한때 "두세 줄이면 한 칸쯤"이라고 1/3로 어림했는데, 네 줄짜리 자막은
   *  지도의 절반(실측 0.48)을 덮어서 '아래 칸'에 뒀는데도 한가운데까지 올라와 화살표를
   *  끊었다(지적). 그려진 높이를 재서 그 값으로 자리를 다시 고른다 — 페인트 전에
   *  반영해야 자막이 튀지 않는다(useLayoutEffect, 아래 이름표 보정과 같은 방식). */
  const capRef = useRef<HTMLDivElement>(null);
  const [capH, setCapH] = useState(1 / 3);
  /* 자막 폭이 지도의 2/3인가(PC) 1/2인가(모바일) — 아래 자막 자리 고르기가 '자막이 덮을
     네모'로 겹침을 재는데, 그 네모의 폭이 곧 이 값이다. CSS와 같은 경계(1160px)를 본다. */
  const [wideCaption, setWideCaption] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1160px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1160px)");
    const sync = () => setWideCaption(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  /* 그려진 자막이 지도 높이의 몇 할을 덮나 — 이 값으로 아래 capCell이 자리를 다시 고른다.
     캡션 컨테이너는 지도를 통째로 덮는 정렬용 상자라, 실제로 글이 앉은 알맹이(.scr-story-cap)
     를 잰다. 값이 눈에 띄게 달라졌을 때만 state를 건드린다 — 매 렌더 재기 → 상태 변경 →
     다시 렌더의 고리를 끊는다. 한 칸(1/3)보다 작게는 안 본다: 그보다 작아도 칸 하나는
     차지한다고 봐야 이웃 칸 판정이 흔들리지 않는다. */
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = capRef.current?.querySelector(".scr-story-cap") ?? capRef.current?.firstElementChild;
    if (!frame || !box) return;
    const fh = frame.getBoundingClientRect().height;
    if (fh <= 0) return;
    const next = Math.min(1, Math.max(1 / 3, box.getBoundingClientRect().height / fh));
    setCapH((prev) => (Math.abs(prev - next) > 0.02 ? next : prev));
  });
  // 리사이즈 리스너가 오래 살아 있는 동안 labelFix state가 여러 번 바뀔 수 있다 — 리스너
  // 클로저 안의 값은 등록 시점에 멈춰 있으므로(오래된 값), ref로 늘 최신 값을 읽는다.
  const labelFixRef = useRef(labelFix);
  labelFixRef.current = labelFix;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // 한 축을 재는 규칙 — 가로·세로 둘 다 같은 규칙을 쓴다(지적: "이름표 잘림이 양옆뿐
    // 아니라 위아래도 잘릴 수 있어서 그때도 보정 필요").
    /* 가장자리에 딱 붙이지 않고 아주 살짝만 띄운다(요청) — 0으로 두면 이름표가 지도 선에
       그대로 얹혀 잘린 것처럼 보인다. */
    const EDGE_INSET = 4;
    /** 이름표가 액션 이모지를 피해 내려설 때 두는 사이 간격. */
    const MARK_DODGE_GAP = 3;
    const clamp = (naturalMin: number, naturalMax: number, frameMin0: number, frameMax0: number): number => {
      const frameMin = frameMin0 + EDGE_INSET;
      const frameMax = frameMax0 - EDGE_INSET;
      if (naturalMax - naturalMin >= frameMax - frameMin) {
        // 이름표 자체가 프레임보다 크면(아주 긴 닉네임) 어느 한쪽도 완전히는 못 담는다 —
        // 그럴 땐 한가운데로 맞춰 최대한 보이게 한다.
        return (frameMin + frameMax) / 2 - (naturalMin + naturalMax) / 2;
      }
      if (naturalMin < frameMin) return frameMin - naturalMin;
      if (naturalMax > frameMax) return frameMax - naturalMax;
      return 0;
    };
    const measure = () => {
      const frameBox = frame.getBoundingClientRect();
      let changed = false;
      const next = new Map<string, { x: number; y: number }>();
      labelElsRef.current.forEach((el, key) => {
        // 이전 보정을 걷어낸 '있는 그대로'의 자리를 봐야 한다 — 안 그러면 보정값이
        // 매번 자기 자신 위에 쌓여 점점 커진다.
        const prev = labelFixRef.current.get(key) ?? { x: 0, y: 0 };
        const box = el.getBoundingClientRect();
        const top0 = box.top - prev.y;
        const bottom0 = box.bottom - prev.y;
        /* 액션 이모지가 이름표 자리를 덮었으면 그만큼 아래로 비켜선다. 이모지는 이제
           아바타에 딸린 표시가 아니라 '그 일이 벌어진 타일'에 서므로(markPlace), 본진이
           지도 위쪽이고 입구가 아래인 조합에서는 이름표 자리에 그대로 내려앉는다(실측:
           벽돌이 닉네임 글자 위에 앉았다). 어림값으로는 못 막는다 — 이모지 크기도
           화면마다 다르고 입구까지의 거리도 본진마다 달라서, 여기서 실제로 잰다. */
        const markBox = markElsRef.current.get(key)?.getBoundingClientRect();
        const dodge = markBox
          && markBox.bottom > top0 && markBox.top < bottom0
          && markBox.right > box.left - prev.x && markBox.left < box.right - prev.x
          ? markBox.bottom + MARK_DODGE_GAP - top0 : 0;
        const fixX = clamp(box.left - prev.x, box.right - prev.x, frameBox.left, frameBox.right);
        const fixY = dodge + clamp(top0 + dodge, bottom0 + dodge, frameBox.top, frameBox.bottom);
        if (Math.abs(fixX) > 0.5 || Math.abs(fixY) > 0.5) { next.set(key, { x: fixX, y: fixY }); changed = true; }
        else if (prev.x !== 0 || prev.y !== 0) changed = true;
      });
      if (changed || next.size !== labelFixRef.current.size) setLabelFix(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [bases, grid]);

  /* 그 시점의 1등 규모 — 눈금 다섯 칸이 다 켜지는 값이다(요청). 지금 지도에 선 사람들 중 가장 큰 값이고,
     같은 스냅 안에서만 견준다: 맵마다 자원 수급이 달라 판 밖의 잣대를 들이대면 막대가
     사람이 아니라 맵을 말하게 된다(위 PowerBar 주석). */
  const powerPeak = useMemo(
    () => bases.reduce((mx, m) => (typeof m.power === "number" && m.power > mx ? m.power : mx), 0),
    [bases],
  );

  /* 기둥 위 유닛 이름표가 서로(또는 자막·본진 이름표와) 겹치면 출발 쪽으로 밀어낸다(요청:
     "화살표 여러 개가 집중할 땐 좀 더 화살표 출발 쪽으로"). 자리를 계산으로만 잡으면 못 막는다
     — 몇 글자짜리 유닛명이 몇 줄로 앉느냐에 따라 상자 크기가 제각각이고, 화살표가 몇 도로
     들어오느냐에 따라 같은 거리도 겹치기도 안 겹치기도 한다. 그려진 것을 재서, 실제로 겹친
     것만 겹치지 않을 만큼만 물린다(위 이름표 보정과 같은 방식).
     밀어내는 방향·남은 거리는 화살표마다 다르므로 그리는 쪽에서 data-*로 얹어 둔다. */
  const arrowLabelElsRef = useRef<Map<string, HTMLSpanElement>>(new Map());
  const [labelSlide, setLabelSlide] = useState<Map<string, { x: number; y: number }>>(new Map());
  const labelSlideRef = useRef(labelSlide);
  labelSlideRef.current = labelSlide;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    /** 한 번에 이만큼씩 물려 보며 빈자리를 찾는다(px). */
    const SLIDE_STEP = 6;
    /** 이만큼은 떨어져야 '안 겹친다'로 본다 — 글자끼리 딱 붙으면 붙은 대로 못 읽는다. */
    const GAP = 3;
    /** 기둥에 직각으로 비켜설 수 있는 폭(px) — 이보다 크게 옮기면 이름표가 제 화살표에서
     *  떨어져 나온다. 가운데(0)를 먼저 보므로, 안 겹치면 아예 안 비킨다. */
    const SIDE_STEPS = [0, 8, -8, 16, -16, 24, -24];
    type Box = { left: number; right: number; top: number; bottom: number };
    const over = (a: Box, b: Box) => {
      const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left) + GAP;
      const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + GAP;
      return ow > 0 && oh > 0 ? ow * oh : 0;
    };
    const measure = () => {
      const fb = frame.getBoundingClientRect();
      if (fb.width <= 0 || arrowLabelElsRef.current.size === 0) return;
      /* 피해야 할 것 — 지금 보이는 자막 한 줄, 본진 이름표, 이모지 밑 캡션.
         자막은 컨테이너가 지도를 통째로 덮는 정렬용 상자라 그걸 재면 어디로 밀어도 겹친
         것이 된다. 실제로 글이 앉은 잎사귀만, 그것도 지금 보이는 것만 센다(장면이 바뀌어도
         지난 문장들은 투명도 0으로 그 자리에 남아 있다). */
      const blockers: Box[] = [];
      /* '지금 보이는 줄'을 불투명도로 가리면 안 된다 — 장면이 바뀐 직후 이 계산이 도는
         시점(useLayoutEffect)에는 새 줄이 아직 투명하고 옛 줄이 사라지는 중이라, 방금
         지나간 문장을 피해 자리를 잡는다(실측: 자막을 문장으로 되돌리자 이름표가 다시
         겹쳤다). aria-hidden은 React가 그 자리에서 바로 바꾸므로 전환에 흔들리지 않는다. */
      const visible = (el: Element) => {
        const st = getComputedStyle(el);
        return el.getAttribute("aria-hidden") !== "true"
          && st.visibility !== "hidden" && st.display !== "none";
      };
      const collect = (el: Element) => {
        for (const kid of Array.from(el.children)) {
          if (!visible(kid)) continue;
          if (kid.children.length > 0) collect(kid);
          else blockers.push(kid.getBoundingClientRect());
        }
      };
      if (capRef.current) collect(capRef.current);
      frame.querySelectorAll(".scr-minimap-mark-label-out, .scr-minimap-mark-caption")
        .forEach((el) => blockers.push(el.getBoundingClientRect()));

      let changed = false;
      const next = new Map<string, { x: number; y: number }>();
      arrowLabelElsRef.current.forEach((el, key) => {
        // 이전 보정을 걷어낸 '있는 그대로'의 자리에서 다시 고른다 — 안 그러면 보정이
        // 자기 자신 위에 쌓여 이름표가 렌더마다 뒤로 기어간다.
        const prev = labelSlideRef.current.get(key) ?? { x: 0, y: 0 };
        const b = el.getBoundingClientRect();
        const nat: Box = { left: b.left - prev.x, right: b.right - prev.x, top: b.top - prev.y, bottom: b.bottom - prev.y };
        const [dxT, dyT] = (el.dataset.back ?? "0,0").split(",").map(Number);
        const roomT = Number(el.dataset.room ?? 0);
        const fwdT = Number(el.dataset.fwd ?? 0);
        const vx = dxT * (fb.width / grid.width);
        const vy = dyT * (fb.height / grid.height);
        const perTile = Math.hypot(vx, vy);
        const maxPx = perTile > 0 ? roomT * perTile : 0;
        const minPx = perTile > 0 ? -fwdT * perTile : 0;
        const ux = perTile > 0 ? vx / perTile : 0;
        const uy = perTile > 0 ? vy / perTile : 0;
        /* 기둥을 따라 물리는 것만으로는 못 피하는 자리가 있다 — 아래에서 위로 꽂히는
           화살표의 이름표가 두 줄짜리 자막에 걸리면, 자막을 지나칠 만큼 물리자니 기둥이
           모자란다(실측). 그래서 기둥에 직각으로 아주 조금 비켜서는 것도 함께 본다:
           옆으로 한 뼘이면 글줄을 벗어나고, 그만큼으로는 어느 화살표의 이름표인지가
           흐려지지 않는다. 같은 값이면 덜 움직이는 쪽을 고른다(아래 비용의 뒷자리). */
        const px = -uy;
        const py = ux;
        let best = { x: 0, y: 0, score: Infinity };
        for (let t = minPx; t <= maxPx + 0.001; t += SLIDE_STEP) {
          for (const u of SIDE_STEPS) {
            const dx = ux * t + px * u;
            const dy = uy * t + py * u;
            const cand: Box = { left: nat.left + dx, right: nat.right + dx, top: nat.top + dy, bottom: nat.bottom + dy };
            // 지도 밖으로 나가면서까지 피하지는 않는다 — 처음 자리는 늘 후보로 남긴다.
            const moved = Math.hypot(dx, dy);
            if (moved > 0 && (cand.left < fb.left || cand.right > fb.right || cand.top < fb.top || cand.bottom > fb.bottom)) continue;
            let cost = 0;
            for (const bl of blockers) cost += over(cand, bl);
            const score = cost * 1000 + moved;
            if (score < best.score) best = { x: dx, y: dy, score };
          }
        }
        const fix = { x: best.x, y: best.y };
        // 자리를 정한 이름표는 다음 이름표가 피해야 할 것이 된다 — 안 그러면 둘이 같은
        // 빈자리로 나란히 밀려가 그대로 다시 겹친다.
        blockers.push({ left: nat.left + fix.x, right: nat.right + fix.x, top: nat.top + fix.y, bottom: nat.bottom + fix.y });
        if (Math.abs(fix.x - prev.x) > 0.5 || Math.abs(fix.y - prev.y) > 0.5) changed = true;
        if (Math.abs(fix.x) > 0.5 || Math.abs(fix.y) > 0.5) next.set(key, fix);
      });
      if (changed || next.size !== labelSlideRef.current.size) setLabelSlide(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [arrows, bases, grid, caption]);

  /* ── 아바타 둘레의 고정 슬롯(요청) ──
     닉네임은 아래 바깥쪽, 표정은 위 바깥쪽, 액션 이모지는 위 안쪽, 해골은 아래 안쪽.
     넷이 서로 다른 칸을 쓰므로 본진이 지도 어디에 있든 절대 포개지지 않는다.

     예전에는 셋이 저마다 다른 규칙으로 자리를 잡았다 — 이름표는 '지도 바깥 방향', 표정은
     CSS에 왼쪽 위 고정, 액션은 '본진에서 맵 한가운데를 잇는 선 위'. 그래서 본진 위치에
     따라 두셋이 같은 칸에 몰리는 조합이 생겼다(지적: 닉네임·표정·액션 이모지가 겹친다).

     '바깥쪽/안쪽'은 맵 한가운데를 기준으로 한 가로 방향이다. 세로는 방향을 안 나눈다 —
     위/아래를 슬롯으로 고정하는 편이 규칙이 단순하고, 어차피 넘치면 아래 실측 보정
     (labelFix)이 지도 안으로 되돌린다. */
  /** 가로 중앙선에 거의 걸친(12시·6시) 본진은 어느 쪽도 아니다 — 그때는 왼쪽을 바깥으로
   *  친다. 0에 아주 가까운 값을 "왼쪽이 아니면 오른쪽"으로 갈라 버리면 늘 한쪽으로 쏠린다. */
  const CENTER_EPS = 4;
  const outwardX = (m: MinimapMarker): -1 | 1 => {
    const dx = m.x - grid.width / 2;
    return Math.abs(dx) < CENTER_EPS ? -1 : dx < 0 ? -1 : 1;
  };
  /** 표정·해골이 앉는 어깨까지의 거리. 주인공(featured)은 아바타가 커지므로 그만큼
   *  바깥으로 물린다 — 작은 아바타 기준값 그대로 두면 큰 아바타 안쪽에 파묻힌다(예전에
   *  CSS의 .scr-minimap-mark-on 규칙이 하던 일인데, 이제 자리는 인라인이 정하므로
   *  여기서 갈라야 한다). */
  const shoulderOf = (m: MinimapMarker) => (m.featured || m.introBig ? 13 : 9);
  const place = (m: MinimapMarker) => ({
    left: `${(m.x / grid.width) * 100}%`,
    top: `${(m.y / grid.height) * 100}%`,
  });
  /** 표정 = 위 바깥쪽 / 해골 = 아래 안쪽. */
  const shoulder = (m: MinimapMarker, kind: "face" | "skull") => {
    const d = shoulderOf(m);
    return kind === "face"
      ? { left: `${outwardX(m) * d}px`, top: `${-d}px` }
      : { left: `${-outwardX(m) * d}px`, top: `${d}px` };
  };

  /* 액션 이모지는 '그 일이 벌어진 자리'에 선다 — 아바타에 딸린 표시가 아니라 지도 위의
     한 지점이다(지적: "본진 이모지는 아바타가 아니라 본진 중앙, 입구도 본진 입구를
     말한 거야 아바타 위가 아니라").

     그래서 자리는 아바타 기준의 픽셀 오프셋이 아니라 타일 좌표로 받는다(markAt). 본진에서
     한 일이면 본진 자리 그대로이고, 입구막기·입구 방어면 부르는 쪽이 진짜 입구 좌표를
     넣어 준다(GameResultStory의 FRONT) — 아바타 옆에 살짝 비켜 뜨는 것과 지도의 입구에
     서 있는 것은 그림이 아예 다르다.

     CSS의 translate(-50%,-50%)를 여기서 다시 써야 한다 — 인라인 transform이 그 규칙을
     통째로 덮어쓰기 때문이다. */
  const markPlace = (m: MinimapMarker) => {
    const [mx, my] = m.markAt ?? [m.x, m.y];
    return {
      left: `${(mx / grid.width) * 100}%`,
      top: `${(my / grid.height) * 100}%`,
      transform: "translate(-50%, -50%)",
    };
  };

  /** 닉네임 = 아래 바깥쪽. 아바타를 CSS scale로 키우면서 세로 간격이 빡빡해져(지적)
   *  아래로 26px 띄운다. 가로로는 살짝만 — 크게 밀면 지도를 쉽게 벗어난다. */
  const LABEL_OUT_Y = 26;
  const LABEL_OUT_X = 8;
  const labelPlace = (m: MinimapMarker) => {
    const dx = m.x - grid.width / 2;
    const ox = Math.abs(dx) < CENTER_EPS ? 0 : outwardX(m) * LABEL_OUT_X;
    // 이름표는 밀려난 방향과 같은 쪽으로 자라야 한다 — 반대로 자라면 그 길이만큼
    // 도로 아바타를 덮는다(지적: 아바타·닉네임은 겹치면 안 된다).
    const anchorX = ox < -0.5 ? "-100%" : ox > 0.5 ? "0%" : "-50%";
    return {
      left: `${(m.x / grid.width) * 100}%`,
      top: `${(m.y / grid.height) * 100}%`,
      transform: `translate(calc(${anchorX} + ${ox.toFixed(1)}px), ${LABEL_OUT_Y}px)`,
    };
  };
  /** 말주머니 = 아바타 위. 닉네임이 아래에 붙으므로(labelPlace) 반대쪽으로 올려 서로
   *  안 겹치게 두고, 지도 밖으로 나가면 아래 실측 보정(labelFix)이 안으로 되돌린다. */
  const BUBBLE_UP_Y = -30;
  const bubblePlace = (m: MinimapMarker) => ({
    left: `${(m.x / grid.width) * 100}%`,
    top: `${(m.y / grid.height) * 100}%`,
    transform: `translate(-50%, ${BUBBLE_UP_Y}px)`,
  });
  // 그릴 화살표만 미리 계산한다 — 몸통 레이어와 머리 레이어가 같은 값을 쓴다.
  const geoms = arrows
    .map((a) => ({ a, g: arrowGeom(a, grid.width, grid.height) }))
    .filter((v): v is { a: MinimapArrow; g: NonNullable<ReturnType<typeof arrowGeom>> } => v.g !== null);

  /* 자막이 앉을 칸 — 지도를 아홉 칸(3×3)으로 나눠 이번 스냅의 '일'과 가장 덜 겹치는 칸에
     둔다(요청). 늘 한가운데 고정이던 때는 가운데에서 붙은 싸움이나 지도를 가로지르는
     화살표를 자막이 그대로 끊어 놓았다(실측 스크린샷).

     겹침은 칸 자체가 아니라 '자막이 실제로 덮을 네모'로 잰다 — 자막은 폭이 지도의 절반
     남짓이라 한 칸보다 넓어서, 칸 안의 것만 세면 옆 칸까지 덮으면서도 깨끗한 자리로
     보인다. 무게는 '가려지면 얼마나 아쉬운가'로 준다: 화살촉·본진 액션 이모지처럼 그
     장면의 결론에 해당하는 표시가 가장 무겁고, 주인공 아바타가 그다음, 그냥 서 있는
     아바타와 화살표 몸통이 지나가는 자리는 가볍다. 몸통까지 세는 이유는 자막이 가운데를
     막으면 '어디서 어디로 갔나'가 통째로 끊기기 때문이다.

     단, 화살표가 하나도 없고 가운데 칸에 액션 이모지도 없으면 가운데에 고정한다(요청) —
     그때는 지도 한복판이 비어 있어서, 굳이 구석으로 밀어내면 읽기만 불편해진다. */
  const capCell = ((): { row: "top" | "mid" | "bottom"; col: "left" | "center" | "right" } => {
    const MID = { row: "mid", col: "center" } as const;
    /** 자막이 덮는다고 보는 너비·높이(지도 대비) — 폭은 CSS의 최대폭 그대로다(PC 2/3,
     *  모바일 1/2). 높이는 그려진 것을 실측한 값이다(위 capH). */
    const CAP_W = wideCaption ? 2 / 3 : 1 / 2;
    const CAP_H = capH;
    /* PC에서는 자막이 지도 가장자리까지 나가지 않는다(요청: 노출 부분을 중앙점 주변으로
       제한 — 방향성은 유지하되 맵의 중앙부에서 조절되게). 고른 방향은 그대로 두고 그 방향으로
       '조금만' 물러나게 CSS가 여백을 두는데(.scr-minimap-caption-* PC 규칙), 자리를 고르는
       이 계산도 같은 자리를 봐야 한다 — 안 그러면 구석에 앉는다고 셈하고 실제로는 가운데
       가까이 그려져, 정작 덮으면 안 되는 것을 덮는다. 값은 CSS의 여백과 같다. */
    const PULL_X = wideCaption ? CAP_PULL_X : 0;
    const PULL_Y = wideCaption ? CAP_PULL_Y : 0;
    const cx = [CAP_W / 2 + PULL_X, 0.5, 1 - CAP_W / 2 - PULL_X];
    const cy = [CAP_H / 2 + PULL_Y, 0.5, 1 - CAP_H / 2 - PULL_Y];
    /** 지도 위 표시 하나가 차지하는 반지름(지도 대비) — 아바타 한 개 남짓. */
    const SOFT_R = 0.05;
    /** 그 표시가 자막 네모에 '얼마나' 덮이나(0~1) — 한 축의 겹침 비율이다.
     *
     *  예전에는 중심점이 네모 안이냐 밖이냐로만 갈랐는데(<=), 그러면 경계에 정확히 선 것이
     *  양쪽 칸 모두에서 '온전히 덮인다'가 된다. 8인용 맵은 12시·6시 시작 지점이 정확히
     *  가로 한가운데(x=0.5)에 있어서, 자막 폭이 지도의 절반일 때 그 아바타가 왼·가운데·
     *  오른쪽 세 칸에 똑같이 7점씩 얹혔다 — 그 바람에 아무도 없는 구석보다 화살표만 지나는
     *  한복판이 싸게 나왔다(지적: 11시나 5시에 놓이는 게 맞다). 가장자리에 걸친 것은 절반만
     *  센다: 딱 경계면 0.5, 안쪽으로 반지름만큼 들어가면 1, 바깥으로 나가면 0. */
    const cover = (d: number, half: number) =>
      Math.min(1, Math.max(0, (half + SOFT_R - Math.abs(d)) / (2 * SOFT_R)));
    const inBox = (r: number, c: number, x: number, y: number) =>
      cover(x / grid.width - cx[c], CAP_W / 2) * cover(y / grid.height - cy[r], CAP_H / 2);
    // 가운데 칸에 액션 이모지가 서 있나 — 화살표가 없을 때 가운데 고정 여부를 가른다.
    const markInMid = bases.some((m) => !m.ghost && m.mark
      && inBox(1, 1, (m.markAt ?? [m.x, m.y])[0], (m.markAt ?? [m.x, m.y])[1]) > 0.5);
    if (geoms.length === 0 && !markInMid) return MID;

    const cost = Array.from({ length: 3 }, () => [0, 0, 0]);
    const add = (x: number, y: number, w: number) => {
      for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cost[r][c] += w * inBox(r, c, x, y);
    };
    for (const m of bases) {
      // 버린 본진(흑백)은 이번 장면의 이야기가 아니라 배경이다.
      if (m.ghost) continue;
      add(m.x, m.y, m.featured || m.introBig ? 3 : 1);
      if (m.mark) add((m.markAt ?? [m.x, m.y])[0], (m.markAt ?? [m.x, m.y])[1], 4);
      /* 말주머니도 자막이 피해야 할 글자다(실측: "ㅈㅈ" 주머니가 맺음말 자막 위에 앉았다).
         글자끼리 겹치면 둘 다 못 읽으므로 기둥 이름표와 같은 무게로 본다. 자리는 아바타
         바로 위라 아바타 좌표에서 살짝 올려 잡는다 — 칸 판정에는 이 정도면 충분하다. */
      if (m.bubble) add(m.x, m.y - grid.height * 0.04, 4);
    }
    /** 화살표 몸통이 지나가는 자리 — 곡선을 직선으로 어림해 훑는다(칸 판정에는 충분하다).
     *  한 화살표가 칸을 온전히 가로지르면 BODY_WEIGHT만큼 든다. 예전엔 이 값이 1이라
     *  '화살표 한 줄을 통째로 끊는 것'과 '가만히 서 있는 아바타 하나를 가리는 것'이 같은
     *  값이었다 — 그 바람에 아무도 안 싸우는 구석을 두고 굳이 진격로 위에 자막이 앉았다
     *  (지적: 참여 안 하는 사람 자리로 가는 게 낫다). 화살표는 그 장면의 이야기 자체라
     *  훨씬 비싸야 한다. */
    const BODY_SAMPLES = 12;
    const BODY_WEIGHT = 6;
    for (const { a, g } of geoms) {
      add(g.tip[0], g.tip[1], 4);
      add(g.from[0], g.from[1], 2);
      /* 기둥 위 이름표도 자막이 피해야 할 글자다 — 여태 한 번도 안 셌더니 자막이 그 위에
         겹쳐 앉았다(지적 스크린샷: "1팀 교전 — 팽팽"이 "질럿·히드라"와 포개짐). 글자끼리
         겹치면 둘 다 못 읽으므로 아바타보다 무겁게 본다. */
      if ((a.label?.length ?? 0) > 0) add(g.label[0], g.label[1], 4);
      for (let i = 0; i <= BODY_SAMPLES; i += 1) {
        const t = i / BODY_SAMPLES;
        add(a.x1 + (a.x2 - a.x1) * t, a.y1 + (a.y2 - a.y1) * t, BODY_WEIGHT / BODY_SAMPLES);
      }
    }
    /* 같은 점수면 아래 → 위 → 가운데, 가로는 가운데 → 왼쪽 → 오른쪽 순으로 고른다.
       자막은 원래 아래에서 읽는 것이고, 가운데 줄은 지도에서 가장 자주 무슨 일이 벌어지는
       자리라 마지막이다. */
    const rows = [2, 0, 1] as const;
    const cols = [1, 0, 2] as const;
    let best = { r: 1, c: 1, v: Infinity };
    for (const r of rows) {
      for (const c of cols) {
        if (cost[r][c] < best.v) best = { r, c, v: cost[r][c] };
      }
    }
    return {
      row: best.r === 0 ? "top" : best.r === 1 ? "mid" : "bottom",
      col: best.c === 0 ? "left" : best.c === 1 ? "center" : "right",
    };
  })();

  return (
    <div className="scr-minimap-frame">
      {/* 이름표가 나갈 자리를 지도 바깥에 미리 마련해 둔다(요청: 미니맵 바깥을 자막
          패널과 같은 재질의 테두리로 감싸서 이름표 공간을 확보) — 지도 자체(.scr-minimap)
          는 그대로 두고, 그 바깥에 자막 패널(.scr-story-cap)과 같은 톤의 여백을 두른다.
          카드 자체의 바깥 패딩까지 넘어가면 안 되므로(지적) 이 여백은 부모 폭 안에서만
          늘어난다 — 지도가 그만큼 작아지는 대신 이름표가 늘 이 안에 머문다. */}
      <div className={cx("scr-minimap", !grid.image && "scr-minimap-noimage", className)} ref={frameRef}>
        {/* 바탕은 사람이 올려 둔 실제 미니맵 그림뿐이다(요청). 아직 안 올린 맵이면 그림
            자리를 빈 회색으로 두고 그 위에 이야기를 그대로 그린다(요청) — 예전에는 이럴 때
            컴포넌트를 통째로 안 그려서 옛 로스터+요약 문단으로 되돌아갔는데, 같은 경기가
            맵 연결 여부에 따라 다른 화면으로 보이는 게 더 헷갈렸다. 아바타·화살표는 좌표를
            비율로 얹으므로 바탕 그림이 없어도 제자리에 놓인다.
            타일 격자로 그린 개략도를 깔지 않는 건, 타일 번호만으로는 게임과 같은 색을 못
            만들어(ReplayMapCanvas 주석) 무슨 지형인지 못 읽는 그림이 되기 때문이다. */}
      {grid.image && (
        <img className="scr-minimap-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
      )}
      {/* 화살표 — 몸통은 지형 위·아바타 아래에 둔다. viewBox를 타일 격자와 같게 두어 좌표를
          그대로 쓰고, preserveAspectRatio를 끄면 아바타(퍼센트 위치)와 같은 자리에 놓인다.
          화살촉만은 아바타 위에 올린 별도 레이어에 그린다(아래) — 어디를 쳤는지가 이 그림에서
          가장 중요한 정보인데, 목표 자리의 아바타·이름표에 가려 안 보였다(지적). */}
      <svg
        className="scr-minimap-arrows" aria-hidden
        viewBox={`0 0 ${grid.width} ${grid.height}`} preserveAspectRatio="none"
      >
        {geoms.map(({ a, g }) => (
          <g key={`arw-${a.key}`} stroke={TEAM_COLOR[a.team ?? 0] ?? "#d8dee6"}>
            {/* 어두운 지형에도 밝은 지형에도 걸치므로 검은 테를 한 겹 깔아 둔다. */}
            <path
              d={g.d} className="scr-minimap-arrow-halo" fill="none"
              strokeDasharray={a.flight ? "3 2.4" : undefined}
            />
            <path
              d={g.d} fill="none" className="scr-minimap-arrow"
              strokeDasharray={a.flight ? "3 2.4" : undefined}
              {...(a.width ? { strokeWidth: a.width } : {})}
            />
          </g>
        ))}
      </svg>
      {bases.map((m) => (
        <span
          key={`base-${m.key}`}
          className={cx("scr-minimap-mark", "scr-minimap-mark-base",
            m.team === 1 && "scr-minimap-mark-t1", m.team === 2 && "scr-minimap-mark-t2",
            m.highlight && "scr-minimap-mark-hit",
            m.downed && "scr-minimap-mark-downed",
            m.ghost && "scr-minimap-mark-ghost",
            m.featured && "scr-minimap-mark-on",
            m.best && "scr-minimap-mark-best",
            m.introBig && "scr-minimap-mark-introbig")}
          style={place(m)}
        >
          {/* 지금 문장의 주인공은 확실히 크게, 나머지는 작게(요청) — 크기 차이가 곧
              "이 문장은 이 사람 이야기"라는 표시다. */}
          <Avatar
            member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }}
            /* 시작 스냅에서는 아무도 '주인공'이 아니지만 모두를 크게 그린다(요청: 시작
               스냅에 아바타들 확대) — 자막 패널의 로스터를 걷어내면서 그 자리를 미니맵이
               대신하기로 한 화면이라, 여기서 작으면 누가 나왔는지 알 길이 없다. */
            size={m.featured || m.introBig ? AVATAR_ON : AVATAR_OFF}
          />
          {/* 궤멸·빈사 — 본진 위에 해골을 얹는다(요청). 아바타는 흑백으로 눌러 두어
              해골이 그 사람 자리에 붙은 표시로 읽히게 한다. 다른 상태 표시가 전부 이모지로
              통일되면서(요청) 여기도 아이콘 컴포넌트 대신 이모지로 맞추고, 딤 처리는 CSS
              필터로 남긴다. */}
          {m.downed && (
            <span
              className="scr-minimap-mark-skull" role="img" aria-label="궤멸"
              style={shoulder(m, "skull")}
            >
              💀
            </span>
          )}
          {/* 크게 다친 상태 — 해골과 같은 어깨 자리에 반창고만 얹는다(요청). 해골이 이미
              붙은 사람에게는 안 붙인다(둘이 한 자리에 겹친다). */}
          {!m.downed && m.hurt && (
            <span
              className="scr-minimap-mark-skull scr-minimap-mark-hurt" role="img" aria-label="큰 타격"
              style={shoulder(m, "skull")}
            >
              ❤️‍🩹
            </span>
          )}
          {/* 트로피·공격자·당한 정도·아군 헬프 같은 상태 얼굴 — 해골과 같은 자리·크기로
              아바타 반대쪽 어깨에 붙인다(지적: 상태 얼굴도 해골처럼 아바타에 바짝 붙어야
              한다). 해골과 자리가 겹치지 않게 반대쪽(왼쪽 위)에 둔다. */}
          {m.face && (
            <span
              className={cx("scr-minimap-mark-face", m.faceIsTrophy && "scr-minimap-mark-face-trophy")}
              style={shoulder(m, "face")}
              aria-hidden
            >
              {m.face}
            </span>
          )}
        </span>
      ))}
      {/* 이름표 — 아바타 바로 바깥(지도 중심의 반대 방향)에 고정 거리로 붙인다(요청:
          화살표·아바타·상태 얼굴에 가려지지 않되, 지도가 커도 타이틀·자막 칸까지 멀리
          밀려나지 않게 아바타 코앞에). 본진 span 안에 두면 아바타 자리에 묶여 같이
          가려지므로 따로 뗀다. */}
      {bases.map((m) => (m.withName ? (
        <span
          key={`lb-${m.key}`}
          ref={(el) => {
            if (el) labelElsRef.current.set(m.key, el);
            else labelElsRef.current.delete(m.key);
          }}
          className={cx("scr-minimap-mark-label-out",
            m.team === 1 && "scr-minimap-mark-t1", m.team === 2 && "scr-minimap-mark-t2",
            m.highlight && "scr-minimap-mark-hit", m.downed && "scr-minimap-mark-downed",
            m.introBig && "scr-minimap-mark-introbig")}
          // 실측 보정(labelFix) — 프레임 밖으로 나간 만큼 안으로 되돌린다(지적: "이름표가
          // 밖으로 나가면 보정해서 안으로 이동시키라고 했잖아", 위아래도 잘릴 수 있다는
          // 지적까지 포함해 가로·세로 둘 다). transform 뒤에 적용되는 margin이라 기존
          // 위치 계산과 섞이지 않고 그 값에 더해진다.
          style={{
            ...labelPlace(m),
            marginLeft: `${labelFix.get(m.key)?.x ?? 0}px`,
            marginTop: `${labelFix.get(m.key)?.y ?? 0}px`,
          }}
        >
          <span className="scr-minimap-mark-line">
            <span className="scr-minimap-mark-name">{m.name}</span>
            {/* 로스터를 감춘 모바일에서 종족이 통째로 사라지지 않게 여기 함께 붙인다. */}
            <RaceBadge race={m.race} size={11} circleLetter className="scr-minimap-mark-race" />
            {/* BEST PLAYER — 아바타 금테(scr-minimap-mark-best)만으로는 무슨 뜻인지 알 길이 없어
                이름 옆에 넉 자로 못 박는다(요청). 승패 스냅에서만 붙는다. */}
            {m.best && <span className="scr-minimap-mark-best-tag">BEST</span>}
          </span>
          {/* 닉네임 밑 기세 눈금(요청) — 그 시각의 1등 대비 규모. */}
          {typeof m.power === "number" && powerPeak > 0 && (
            <VigorPips power={m.power} peak={powerPeak} />
          )}
        </span>
      ) : null))}
      {/* 말주머니 — 그 무렵 그 사람이 한 말을 아바타 위에 띄운다(요청: 스냅으로 선정한
          부근의 채팅만). 이름표와 같은 실측 보정을 타서 지도 밖으로 안 나간다. */}
      {bases.map((m) => (m.bubble ? (
        <span
          key={`bub-${m.key}`}
          ref={(el) => {
            if (el) labelElsRef.current.set(`bub-${m.key}`, el);
            else labelElsRef.current.delete(`bub-${m.key}`);
          }}
          className="scr-minimap-bubble"
          style={{
            ...bubblePlace(m),
            marginLeft: `${labelFix.get(`bub-${m.key}`)?.x ?? 0}px`,
            marginTop: `${labelFix.get(`bub-${m.key}`)?.y ?? 0}px`,
          }}
        >
          {m.bubble}
        </span>
      ) : null))}
      {/* 화살촉 — 아바타·이름표 위에 올린다(지적: 화살촉이 다른 요소들에 가려짐). 몸통까지
          위로 올리면 긴 화살표가 남의 얼굴을 가로지르므로 머리만 올린다. */}
      <svg
        className="scr-minimap-arrow-tips" aria-hidden
        viewBox={`0 0 ${grid.width} ${grid.height}`} preserveAspectRatio="none"
      >
        {geoms.map(({ a, g }) => (
          <polygon
            key={`tip-${a.key}`} points={g.head}
            className="scr-minimap-arrow-head" fill={TEAM_COLOR[a.team ?? 0] ?? "#d8dee6"}
          />
        ))}
      </svg>
      {/* 무슨 일인지 알려 주는 이모지 — 화살촉 앞에 얹는다(요청). SVG가 아니라 DOM으로 두는
          이유는 글꼴 이모지라 브라우저가 그대로 그려 주는 편이 안전하고, 크기를 px로 잡아야
          맵 크기와 무관하게 같게 보이기 때문이다. */}
      <div className="scr-minimap-arrow-marks" aria-hidden>
        {/* 화살표가 없는 장면의 본진 이모지 — 아바타가 아니라 '그 일이 벌어진 타일'에
            선다(markPlace): 본진에서 한 일이면 그 사람 본진 건물이 실제로 선 자리,
            입구막기·입구 방어면 그 본진의 입구다(요청). */}
        {bases.map((m) => (m.mark ? (
          <span
            key={`bm-${m.key}`}
            ref={(el) => {
              if (el) markElsRef.current.set(m.key, el);
              else markElsRef.current.delete(m.key);
            }}
            className="scr-minimap-arrow-mark scr-minimap-mark-home"
            style={markPlace(m)}
          >
            {m.mark}
          </span>
        ) : null))}
        {/* 그 이모지가 무엇으로 한 일인가(요청: 방패 이모지에도 유닛명·건물명·기술명 캡션)
            — 화살표가 있는 이야기는 기둥 위 이름표가 이 일을 하는데, 화살표 없이 이모지만
            서는 이야기(방어·입구막기·생산)에는 그 자리가 없었다. 이모지 바로 밑이다. */}
        {bases.map((m) => (m.mark && m.markText ? (
          <span
            key={`bmt-${m.key}`} className="scr-minimap-mark-caption"
            style={markPlace(m)} aria-hidden
          >
            {m.markText}
          </span>
        ) : null))}
        {geoms.map(({ a, g }) => (a.markFrom ? (
          <span
            key={`mf-${a.key}`} className="scr-minimap-arrow-mark scr-minimap-arrow-mark-pop"
            style={{ left: `${(g.from[0] / grid.width) * 100}%`, top: `${(g.from[1] / grid.height) * 100}%` }}
          >
            {a.markFrom}
          </span>
        ) : null))}
        {/* 화살표 목의 표시(요청: 도와준 화살표에 천사 날개) — 촉의 이모지가 '무슨 일이
            벌어졌나'라면 이쪽은 '이 화살표가 어떤 길인가'다. */}
        {geoms.map(({ a, g }) => (a.markNeck ? (
          <span
            key={`mn-${a.key}`} className="scr-minimap-arrow-mark scr-minimap-arrow-mark-neck"
            style={{ left: `${(g.neck[0] / grid.width) * 100}%`, top: `${(g.neck[1] / grid.height) * 100}%` }}
          >
            {a.markNeck}
          </span>
        ) : null))}
        {/* 유닛 이름표 — 촉 바로 뒤 기둥 위(요청). 화살표와 같은 편 색을 써서 어느 쪽
            병력인지가 글을 안 읽어도 보인다. */}
        {geoms.map(({ a, g }) => ((a.label?.length ?? 0) > 0 ? (
          <span
            key={`lbl-${a.key}`}
            ref={(el) => {
              if (el) arrowLabelElsRef.current.set(a.key, el);
              else arrowLabelElsRef.current.delete(a.key);
            }}
            className={cx("scr-minimap-arrow-label",
              a.team === 1 && "scr-minimap-mark-t1", a.team === 2 && "scr-minimap-mark-t2")}
            /* 겹쳤을 때 밀어낼 방향(촉 → 출발점)과 남은 거리 — 실측 보정(labelSlide)이 읽는다. */
            data-back={`${g.slide.dir[0].toFixed(4)},${g.slide.dir[1].toFixed(4)}`}
            data-room={g.slide.room.toFixed(2)}
            data-fwd={g.slide.fwd.toFixed(2)}
            style={{
              left: `${(g.label[0] / grid.width) * 100}%`,
              top: `${(g.label[1] / grid.height) * 100}%`,
              // transform 뒤에 얹히는 margin이라 자리 계산과 섞이지 않고 그 값에 더해진다.
              marginLeft: `${labelSlide.get(a.key)?.x ?? 0}px`,
              marginTop: `${labelSlide.get(a.key)?.y ?? 0}px`,
            }}
          >
            {a.label!.map((u) => <span key={u}>{u}</span>)}
          </span>
        ) : null))}
        {geoms.map(({ a, g }) => (a.mark ? (
          <span
            key={`mk-${a.key}`} className="scr-minimap-arrow-mark scr-minimap-arrow-mark-pop"
            style={{ left: `${(g.tip[0] / grid.width) * 100}%`, top: `${(g.tip[1] / grid.height) * 100}%` }}
          >
            {a.mark}
          </span>
        ) : null))}
      </div>
      {/* 그림의 좌·우 절반을 누르면 이전/다음 장면으로 옮긴다(요청). 이 카드는 눌러서 접는
          동작을 갖고 있어(활동 묶음) 여기서 이벤트를 반드시 끊어야 한다 — click만 막으면
          pointerdown을 보고 접는 쪽이 먼저 반응한다(요청: 접기로 작동 안 하게 주의). */}
      {onStep && ([-1, 1] as const).map((d) => (
        <button
          key={`step${d}`} type="button"
          className={cx("scr-minimap-half", d < 0 ? "scr-minimap-half-prev" : "scr-minimap-half-next")}
          aria-label={d < 0 ? "이전 장면" : "다음 장면"}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onStep(d); }}
        />
      ))}
      {caption && (
        <div
          ref={capRef}
          className={cx("scr-minimap-caption",
            `scr-minimap-caption-${capCell.row}`, `scr-minimap-caption-${capCell.col}`)}
        >
          {caption}
        </div>
      )}
      </div>
    </div>
  );
}
