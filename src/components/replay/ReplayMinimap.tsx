import { useLayoutEffect, useRef, useState } from "react";
import ReplayMapCanvas from "./ReplayMapCanvas";
import Avatar from "../common/Avatar";
import RaceBadge from "../common/RaceBadge";
import { cx } from "../../utils/format";
import type { ReplayMapGrid } from "../../utils/replayParser";
import type { Race } from "../../types";

// 경기 한 판의 미니맵 — 지형 그림 위에 본진 아바타·화살표를 얹는다.
//
// 지형 그림은 둘 중 하나다: 운영자가 올려 둔 실제 미니맵(운영 메뉴의 미니맵 화면), 또는 그게
// 없을 때 리플레이의 타일 격자로 그린 개략도(ReplayMapCanvas). 그림이 무엇이든 마커·화살표는
// 좌표를 맵 크기 비율로 얹으므로 같은 자리에 놓인다.
//
// 왜 실제 그림을 사람이 올리는지, 타일 번호만으로 물·풀·땅·벽을 갈라 보려던 네 번의 시도가
// 어떻게 실패했는지는 ReplayMapCanvas 주석에 적어 뒀다.

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
const MARK_ROOM = 9;
/** 그 자리 안에서 이모지를 화살촉보다 이만큼 앞에 둔다. */
const MARK_AHEAD = 5;
/** 본진 이모지를 입구(맵 가운데) 쪽으로 이만큼 띄운다(타일) — 13 → 22(요청: 본진 한가운데
 *  느낌이 나게 자기 아바타에서 맵 중앙 쪽으로 많이 가서). */
const MARK_OUT = 22;
/** 이모지가 그림 밖으로 잘리지 않게 가장자리에서 남겨 두는 여백(타일). */
const MARK_EDGE = 3;

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
  const gapTo = Math.min(a.deep ? GAP_TO_DEEP : GAP_TO, len * 0.22) + (a.mark ? MARK_ROOM : 0);
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
  return {
    // 기둥은 화살촉 끝(x2,y2)이 아니라 촉의 밑동(bx,by)에서 멈춘다(지적: "화살촉 밑으로
    // 기둥 끝이 보임") — 촉 전체를 기둥이 관통해 그리면, 촉이 뾰족해지는 자리에서 굵은
    // 기둥이 삼각형 옆으로 삐져나와 보인다.
    d: `M ${x1} ${y1} Q ${cx0} ${cy0} ${bx} ${by}`,
    head: `${x2},${y2} ${bx - hy * headWide},${by + hx * headWide} ${bx + hy * headWide},${by - hx * headWide}`,
    // 이모지 자리 — 화살촉 바로 앞. 촉을 덮지 않고, 목표 아바타에도 닿지 않는 사이다.
    tip: [x2 + hx * MARK_AHEAD, y2 + hy * MARK_AHEAD] as [number, number],
    // 출발 쪽 이모지 자리 — 몸통이 시작하는 점 그대로. 아바타에서 이미 gapFrom만큼
    // 띄워 둔 자리라 아바타를 덮지 않는다.
    from: [x1, y1] as [number, number],
  };
}

/** 미니맵 위에 놓을 표시 하나. */
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
  /** 지금 문장에 이름이 나온 사람인가 — 아바타를 크게 키운다(요청). */
  featured?: boolean;
  /** 버리고 떠난 옛 본진인가 — 흑백으로만 남긴다(요청: 본진을 버리고 이동한 경우 본진은
   *  흑백 처리하고 새 기지에 마크를 옮긴다). */
  ghost?: boolean;
  /** 본진에 붙일 이모지 — 화살표가 없는 이야기(생산·테크·경제)에 쓴다(요청: 생산에도 본진에
   *  열심히 생산하는 이모지). 입구 쪽으로 띄워 그린다. */
  mark?: string;
  /** 아바타 위에 겹쳐 그리는 상태 얼굴 — 트로피·공격자·당한 정도·아군 헬프처럼 그 사람
   *  자체를 가리키는 표시에 쓴다(요청: 해골·트로피 말고도 아바타로 상태를 알려 달라). */
  face?: string;
  /** face가 승리 트로피인가 — 다른 상태 얼굴과 달리 더 크고 계속 바운스한다(요청). */
  faceIsTrophy?: boolean;
  /** 시작 스냅인가 — 로스터 없이 "게임 시작!"만 보여주는 자리라, 닉네임 글자도 아바타만큼
   *  키운다(요청: 시작시 로스터 대신 아바타·닉네임 확대). */
  introBig?: boolean;
}

export default function ReplayMinimap({
  grid, bases, arrows = [], onStep, className,
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
  const [labelFix, setLabelFix] = useState<Map<string, { x: number; y: number }>>(new Map());
  // 리사이즈 리스너가 오래 살아 있는 동안 labelFix state가 여러 번 바뀔 수 있다 — 리스너
  // 클로저 안의 값은 등록 시점에 멈춰 있으므로(오래된 값), ref로 늘 최신 값을 읽는다.
  const labelFixRef = useRef(labelFix);
  labelFixRef.current = labelFix;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // 한 축을 재는 규칙 — 가로·세로 둘 다 같은 규칙을 쓴다(지적: "이름표 잘림이 양옆뿐
    // 아니라 위아래도 잘릴 수 있어서 그때도 보정 필요").
    const clamp = (naturalMin: number, naturalMax: number, frameMin: number, frameMax: number): number => {
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
        const fixX = clamp(box.left - prev.x, box.right - prev.x, frameBox.left, frameBox.right);
        const fixY = clamp(box.top - prev.y, box.bottom - prev.y, frameBox.top, frameBox.bottom);
        if (Math.abs(fixX) > 0.5 || Math.abs(fixY) > 0.5) { next.set(key, { x: fixX, y: fixY }); changed = true; }
        else if (prev.x !== 0 || prev.y !== 0) changed = true;
      });
      if (changed || next.size !== labelFixRef.current.size) setLabelFix(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [bases, grid]);

  const place = (m: MinimapMarker) => ({
    left: `${(m.x / grid.width) * 100}%`,
    top: `${(m.y / grid.height) * 100}%`,
  });

  /** 본진 이모지 자리 — 본진과 맵 한가운데를 잇는 선 위에 올린다(요청). 전에는 가로로만
   *  띄웠던 탓에, 가운데와 세로로 마주 보는(12시·6시) 본진의 이모지가 선을 벗어나 엉뚱하게
   *  맵 바깥쪽으로 밀려났다(지적: 왜 자꾸 맵 외곽에 위치하냐). */
  const markPoint = (m: MinimapMarker): [number, number] => {
    const dx = grid.width / 2 - m.x;
    const dy = grid.height / 2 - m.y;
    const len = Math.hypot(dx, dy) || 1;
    // 가운데를 지나쳐 반대편으로 넘어가지 않게 거리도 함께 줄인다.
    const out = Math.min(MARK_OUT, len * 0.7);
    const px = m.x + (dx / len) * out;
    const py = m.y + (dy / len) * out;
    return [
      Math.min(grid.width - MARK_EDGE, Math.max(MARK_EDGE, px)),
      Math.min(grid.height - MARK_EDGE, Math.max(MARK_EDGE, py)),
    ];
  };

  const markPlace = (m: MinimapMarker) => {
    const [x, y] = markPoint(m);
    return {
      left: `${(x / grid.width) * 100}%`,
      top: `${(y / grid.height) * 100}%`,
    };
  };

  /** 이름표는 지도 '안'에 둔다(요청: 미니맵 테두리를 없애고 이름표는 안에서 위치조정으로
   *  커버). 예전에는 바깥으로 밀어 놓고 그 자리를 프레임 여백으로 마련했는데, 테두리가
   *  사라지면 그 여백은 그냥 빈 공간이라 지도만 작아 보인다. 그래서 미는 방향을 뒤집어
   *  맵 한가운데 쪽으로 넣는다 — 가장자리 본진일수록 지도 안쪽에 빈 칸이 많으니 자리도
   *  거기가 넉넉하다. 모든 본진에 같은 규칙을 쓴다(지적: 전부 이탈 방지가 필요). */
  // 아바타를 CSS scale로 키우면서(요청: 평상시 크기 확대) 세로 간격이 빡빡해졌다(지적:
  // 확대 상태를 고려해 아바타·닉네임 세로 갭을 조금 늘려야 함) — 20 → 26.
  const LABEL_OUT_Y = 26;
  const LABEL_OUT_X = 8;
  /** 가로 중앙선에 거의 걸친(예: 12시·6시) 본진은 옆으로 밀지 않고 가운데 정렬한다
   *  (지적: "12시 6시 이름표는 왜 우측으로 옮겨짐? 가운데 정렬해도 되는데") — dx가 0에
   *  아주 가까운 값도 "왼쪽이 아니면 오른쪽"으로 갈라 버리면 늘 한쪽(오른쪽)으로 쏠린다. */
  const CENTER_EPS = 4;
  const labelPlace = (m: MinimapMarker) => {
    const dx = m.x - grid.width / 2;
    const dy = m.y - grid.height / 2;
    // 부호가 안쪽(가운데) 방향이다 — 왼쪽 본진이면 오른쪽으로, 위쪽 본진이면 아래로.
    const ox = Math.abs(dx) < CENTER_EPS ? 0 : dx < 0 ? LABEL_OUT_X : -LABEL_OUT_X;
    const oy = Math.abs(dy) < CENTER_EPS ? LABEL_OUT_Y : dy < 0 ? LABEL_OUT_Y : -LABEL_OUT_Y;
    // 이름표는 밀려난 방향과 같은 쪽으로 자라야 한다 — 반대로 자라면 그 길이만큼
    // 도로 아바타를 덮는다(지적: 아바타·닉네임은 겹치면 안 된다).
    const anchorX = ox < -0.5 ? "-100%" : ox > 0.5 ? "0%" : "-50%";
    const anchorY = oy < -0.5 ? "-100%" : oy > 0.5 ? "0%" : "-50%";
    return {
      left: `${(m.x / grid.width) * 100}%`,
      top: `${(m.y / grid.height) * 100}%`,
      transform: `translate(calc(${anchorX} + ${ox.toFixed(1)}px), calc(${anchorY} + ${oy.toFixed(1)}px))`,
    };
  };
  // 그릴 화살표만 미리 계산한다 — 몸통 레이어와 머리 레이어가 같은 값을 쓴다.
  const geoms = arrows
    .map((a) => ({ a, g: arrowGeom(a, grid.width, grid.height) }))
    .filter((v): v is { a: MinimapArrow; g: NonNullable<ReturnType<typeof arrowGeom>> } => v.g !== null);

  return (
    <div className="scr-minimap-frame">
      {/* 이름표가 나갈 자리를 지도 바깥에 미리 마련해 둔다(요청: 미니맵 바깥을 자막
          패널과 같은 재질의 테두리로 감싸서 이름표 공간을 확보) — 지도 자체(.scr-minimap)
          는 그대로 두고, 그 바깥에 자막 패널(.scr-story-cap)과 같은 톤의 여백을 두른다.
          카드 자체의 바깥 패딩까지 넘어가면 안 되므로(지적) 이 여백은 부모 폭 안에서만
          늘어난다 — 지도가 그만큼 작아지는 대신 이름표가 늘 이 안에 머문다. */}
      <div className={cx("scr-minimap", className)} ref={frameRef}>
        {/* 사람이 올려 둔 실제 미니맵 그림이 있으면 그것을, 없으면 타일 격자로 그린 개략도를
            쓴다(요청: 물·풀·땅·벽을 실제와 비슷하게). 아바타·화살표는 좌표를 비율로 얹으므로
            어느 쪽이든 같은 자리에 놓인다. */}
      {grid.image
        ? <img className="scr-minimap-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
        : <ReplayMapCanvas grid={grid} />}
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
            m.introBig && "scr-minimap-mark-introbig")}
          style={place(m)}
        >
          {/* 지금 문장의 주인공은 확실히 크게, 나머지는 작게(요청) — 크기 차이가 곧
              "이 문장은 이 사람 이야기"라는 표시다. */}
          <Avatar
            member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }}
            size={m.featured ? AVATAR_ON : AVATAR_OFF}
          />
          {/* 궤멸·빈사 — 본진 위에 해골을 얹는다(요청). 아바타는 흑백으로 눌러 두어
              해골이 그 사람 자리에 붙은 표시로 읽히게 한다. 다른 상태 표시가 전부 이모지로
              통일되면서(요청) 여기도 아이콘 컴포넌트 대신 이모지로 맞추고, 딤 처리는 CSS
              필터로 남긴다. */}
          {m.downed && (
            <span className="scr-minimap-mark-skull" role="img" aria-label="궤멸">💀</span>
          )}
          {/* 트로피·공격자·당한 정도·아군 헬프 같은 상태 얼굴 — 해골과 같은 자리·크기로
              아바타 반대쪽 어깨에 붙인다(지적: 상태 얼굴도 해골처럼 아바타에 바짝 붙어야
              한다). 해골과 자리가 겹치지 않게 반대쪽(왼쪽 위)에 둔다. */}
          {m.face && (
            <span
              className={cx("scr-minimap-mark-face", m.faceIsTrophy && "scr-minimap-mark-face-trophy")}
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
          <span className="scr-minimap-mark-name">{m.name}</span>
          {/* 로스터를 감춘 모바일에서 종족이 통째로 사라지지 않게 여기 함께 붙인다. */}
          <RaceBadge race={m.race} size={11} circleLetter className="scr-minimap-mark-race" />
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
        {/* 화살표가 없는 장면의 본진 이모지 — 본진에서 입구 쪽으로 띄워 크게(요청). */}
        {bases.map((m) => (m.mark ? (
          <span
            key={`bm-${m.key}`}
            className="scr-minimap-arrow-mark scr-minimap-mark-home"
            style={markPlace(m)}
          >
            {m.mark}
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
          동작을 갖고 있어(피드 묶음) 여기서 이벤트를 반드시 끊어야 한다 — click만 막으면
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
      </div>
    </div>
  );
}
