/* 원작 타이밍표 — 수송선 승하차·건물 이착륙 ─────────────────────────────────────
 *
 * ■ 이 파일이 다시 쓰인 까닭 — 조사와 제출 사이에서 값이 퇴행했다
 * 앞 판은 하차 간격을 15프레임, 탑승 폴링을 7프레임으로 냈다. 둘 다 **타이머 원값**이지
 * 눈에 보이는 간격이 아니다. 게다가 같은 갈래의 조사 파일에는 이미 18프레임·실효 9프레임
 * 이라고 줄 인용까지 붙여 적혀 있었는데 제출본만 그 문단을 버렸다. 그리고 "실측 0.630초"
 * 는 원전을 잰 것이 아니라 **자기가 박은 상수를 되읽은 값**이었다. 검증 세 렌즈가 그
 * 자리를 그대로 짚었다(verdict-원전 [transport] ①②③).
 *
 * ■ 모든 값의 뿌리 — execute_main_order의 게이트
 * 그 함수 안에는 switch가 둘이고 그 사이에 게이트가 있다:
 *     if (order_process_timer) { --order_process_timer; return; }
 *     order_process_timer = 8;            // bwgame.h:7758-7762
 * 그래서 게이트 **뒤**에 있는 오더는 9프레임마다 한 번만 돈다. 탑승(order_PickupTransport,
 * case 7950)·하차(order_Unload, case 7972)·이륙(order_LiftingOff, 7908)이 전부 뒤에 있고,
 * 착륙(order_BuildingLand, 7686)만 게이트 **앞**이라 매 프레임 돈다. 이 비대칭이 아래
 * 숫자들의 전부다.
 *
 * main_order_timer는 1210에서 매 프레임 하나씩 준다. 어떤 오더가 타이머에 15를 걸어도,
 * 그 오더가 게이트 뒤에 있고 위상을 다시 잡지 않으면 **다음 폴링은 15가 아니라 18**이다.
 * 대조군이 바로 곁에 있다: order_hidden_BunkerGuard(12564)는 main_order_timer=15와
 * **함께** order_process_timer=0을 놓아 위상을 재설정한다 — 원작은 정말 15를 원할 때
 * 이렇게 명시한다. unit_unload(3163)는 그러지 않는다.
 *
 * 프레임→초는 빠른 속도 23.81fps 기준이다. 이 파일은 **아무것도 import 하지 않는다** —
 * 노드 CLI(scripts/sim-run.mjs)가 리액트 없이 그대로 번들해 쓴다. */

export const BW_FPS = 23.81;
/** 프레임 → 초. */
export const secOfFrames = (f: number): number => f / BW_FPS;

/* ── 오더 처리 주기 ────────────────────────────────────────────────────────── */

/** 게이트 주기(프레임) — 9. bwCombat.ORDER_PERIOD_FRAMES와 같은 값이고 뿌리도 같다.
 *  두 파일에 따로 적힌 것은 이 파일이 아무것도 import 하지 않기로 한 규약 때문이다;
 *  둘 중 하나를 고치는 일이 생기면 반드시 나머지도 같이 봐라. */
export const ORDER_POLL_FRAMES = 9;
export const ORDER_POLL_SEC = secOfFrames(ORDER_POLL_FRAMES);
/** 착륙 판정만은 매 프레임이다 — 게이트 앞에 있어 9프레임 격자에 안 걸린다. */
export const LAND_POLL_FRAMES = 1;
/** 이륙 판정은 게이트 뒤 — 9프레임 격자다. */
export const LIFTOFF_POLL_FRAMES = ORDER_POLL_FRAMES;

/** 시각 t(초)를 게이트 격자로 올려 붙인다. 게이트 뒤에 있는 일(탑승·하차·이륙)의 실제
 *  발동 시각을 만들 때 쓴다. 1e-9는 격자에 정확히 놓인 값이 한 칸 더 밀리는 것을 막는다. */
export const toPollGridSec = (t: number, phase = 0): number =>
  phase + Math.ceil((t - phase) / ORDER_POLL_SEC - 1e-9) * ORDER_POLL_SEC;

/* ── 정원 ─────────────────────────────────────────────────────────────────── */

/** 수송칸(units.dat spaceProvided) — 셔틀·드랍십·오버로드가 8, 벙커가 4.
 *  오버로드는 벤트럴 색을 캔 뒤에만 태울 수 있지만, 칸 수 자체는 8이다. */
export const TRANSPORT_SLOTS: Record<string, number> = {
  Shuttle: 8, Dropship: 8, Overlord: 8, Bunker: 4,
};

/** 유닛이 차지하는 자리(units.dat spaceRequired). 표에 없는 이름은 **못 탄다** —
 *  공중 유닛과 거미지뢰·인터셉터처럼 실릴 수 없는 것들이 거기 든다.
 *  잘 알려진 짝들이 이 표의 검산이다: 셔틀 하나에 질럿 넷(2×4)·드라군 둘(4×2)·리버
 *  둘(4×2), 드랍십 하나에 마린 여덟(1×8)·탱크 둘(4×2)·벌처 넷(2×4), 오버로드 하나에
 *  저글링 여덟(1×8)·히드라 넷(2×4)·럴커 둘(4×2)·울트라 하나(8×1). */
export const SPACE_REQUIRED: Record<string, number> = {
  // ── 테란 ──
  Marine: 1, Firebat: 1, Ghost: 1, Medic: 1, SCV: 1,
  Vulture: 2,
  Goliath: 4, "Siege Tank": 4, "Siege Tank (Tank Mode)": 4, "Siege Tank (Siege Mode)": 4,
  // ── 프로토스 ──
  Probe: 1,
  Zealot: 2, "High Templar": 2, "Dark Templar": 2,
  Dragoon: 4, Archon: 4, "Dark Archon": 4, Reaver: 4,
  // ── 저그 ──
  Drone: 1, Zergling: 1, Broodling: 1, "Infested Terran": 1,
  Hydralisk: 2, Defiler: 2,
  Lurker: 4,
  Ultralisk: 8,
};

/** 그 수송선이 가진 칸 수 — 표에 없으면 0(수송선이 아니다). */
export const slotsOf = (transportKind: string): number => TRANSPORT_SLOTS[transportKind] ?? 0;
/** 그 유닛이 차지하는 자리 — null이면 애초에 실릴 수 없는 유닛이다. */
export const spaceOf = (kind: string): number | null => SPACE_REQUIRED[kind] ?? null;

/* ── 탑승 ─────────────────────────────────────────────────────────────────── */

/** 탑승 자체에 걸리는 프레임은 0이다 — 경계상자가 1픽셀만 닿으면 그 프레임에 실린다. */
export const BOARD_ACT_FRAMES = 0;

/** order_PickupTransport가 스스로 거는 타이머 원값(프레임). **이 값을 격자로 쓰지 마라.** */
export const PICKUP_TIMER_FRAMES = 7;

/** ★ 실효 탑승 폴링 격자(프레임) — 9.
 *  PickupTransport도 게이트 뒤(case 7950)이고 main_order_timer=7은 9보다 작아, 다음 폴링이
 *  올 때는 이미 0이다. 그래서 7이라는 값은 격자를 만들지 못하고 실효 간격은 게이트 주기
 *  그대로 9프레임이 된다. 앞 판이 7프레임 격자로 올림 정렬한 것이 이 자리의 오독이다. */
export const PICKUP_POLL_FRAMES = ORDER_POLL_FRAMES;
export const PICKUP_POLL_SEC = secOfFrames(PICKUP_POLL_FRAMES);

/* ── 하차 ─────────────────────────────────────────────────────────────────── */

/** unit_unload가 수송선에 거는 타이머 원값(프레임). **이 값이 간격이 아니다.** */
export const UNLOAD_TIMER_FRAMES = 15;

/** ★ 실제로 눈에 보이는 하차 간격(프레임) — 18.
 *  F프레임에 한 기를 내리면 타이머는 F+15에 0이 되지만, order_Unload는 게이트 뒤라
 *  F+9(타이머 6, 그냥 지나감) → F+18(타이머 0, 발동)로 돈다. unit_unload는 컨테이너의
 *  order_process_timer를 0으로 놓지 않는다 — 위상 재설정이 없으므로 간격은 **항상 정확히
 *  18**이고 유닛 수가 늘어도 어긋나지 않는다. 여덟 태운 셔틀이 다 내리는 데 18×7 = 126
 *  프레임(5.29초)이다(앞 판이 적은 105프레임이 아니다). */
export const UNLOAD_GAP_FRAMES = 18;
/** 0.756초. */
export const UNLOAD_GAP_SEC = secOfFrames(UNLOAD_GAP_FRAMES);

/** n기를 t0(초)부터 줄지어 내릴 때의 하차 시각들(초).
 *  첫 기는 t0에 그대로 내린다 — 18프레임은 '다음 기까지'의 간격이지 첫 기의 지연이 아니다.
 *  (t0 자체를 게이트 격자에 올리려면 toPollGridSec을 먼저 씌워라.) */
export const unloadTimesSec = (t0: number, n: number): number[] =>
  Array.from({ length: Math.max(0, Math.trunc(n)) }, (_, i) => t0 + i * UNLOAD_GAP_SEC);

/* ── 하차 벌칙 ── unit_unload(bwgame.h:3167-3178)는 **양자택일**이다.
   리버(와 쿨다운을 재장전할 무기가 없는 것)는 main_order_timer=30만 받고 무기 쿨 재장전은
   **안 받는다** — else 가지다. 앞 판은 "무기 쿨 재장전"을 일반 규칙으로 두고 리버에 30을
   더 얹어 리버가 이중으로 벌을 받았다. 그리고 벙커에서 나오는 것은 u_grounded_building
   가지라 벌칙 자체가 없다. ────────────────────────────────────────────────────── */

/** 리버·시전 유닛이 하차 뒤 아무것도 못 하는 프레임 — 30(1.260초). */
export const UNLOAD_ORDER_LOCK_FRAMES = 30;
export const UNLOAD_ORDER_LOCK_SEC = secOfFrames(UNLOAD_ORDER_LOCK_FRAMES);

export type UnloadPenalty =
  /** 오더 잠금 — main_order_timer=30. 무기 쿨은 **안 건드린다.** */
  | { kind: "orderLock"; frames: number; sec: number }
  /** 무기 쿨 재장전 — 제 무기의 풀 쿨을 처음부터 다시 채운다. 오더 잠금은 없다. */
  | { kind: "weaponReload" }
  /** 벌칙 없음 — 벙커에서 나온 것. */
  | { kind: "none" };

/** 벙커는 한 프레임에 전부 내보내고 벌칙도 면제다 — 지상 건물 가지라 분기가 통째로 갈린다. */
export const UNLOAD_PENALTY_EXEMPT = new Set(["Bunker"]);
/** 벙커 하차는 줄을 안 선다(한 프레임에 전원). */
export const BUNKER_UNLOAD_ALL_AT_ONCE = true;

/** 하차 벌칙 갈래를 고른다.
 *  @param fromBunker  벙커에서 나왔는가 — 그러면 벌칙이 없다.
 *  @param orderLocked 오더 잠금 가지에 드는가. 리버는 확정이고, '재장전할 무기가 없는
 *                     유닛'(메딕·시전 유닛)도 같은 가지로 본다 — 후자는 [추정]이다.
 *                     쿨다운 대상 무기가 있는지 아는 쪽(bwCombat.profileOf(kind).ground/air)
 *                     이 판단해서 넘겨라. */
export function unloadPenaltyOf(o: {
  fromBunker?: boolean; orderLocked?: boolean;
} = {}): UnloadPenalty {
  if (o.fromBunker) return { kind: "none" };
  if (o.orderLocked) {
    return { kind: "orderLock", frames: UNLOAD_ORDER_LOCK_FRAMES, sec: UNLOAD_ORDER_LOCK_SEC };
  }
  return { kind: "weaponReload" };
}

/** 오더 잠금 가지에 드는 정체인가 — 리버는 원전 확정, 나머지는 '쏠 무기가 없다'로 가른다.
 *  hasWeapon은 부르는 쪽이 표에서 읽어 넘긴다(이 파일은 아무것도 import 하지 않는다). */
export const unloadOrderLocked = (kind: string, hasWeapon: boolean): boolean =>
  kind === "Reaver" || !hasWeapon;

/* ── 띄운 건물 ────────────────────────────────────────────────────────────── */

/** 띄운 건물의 속도는 건물 종류를 안 가린다 — 이·착륙 오더가 최고 속도를 1픽셀/프레임으로
 *  박아 넣고, 오더가 끝날 때의 속도 복원이 건물을 제외하기 때문에 원래 값으로 못 돌아온다.
 *  BWAPI의 top speed 1.00과도 서로 확증한다. 렌더러가 쓰던 1.2타일/초는 1.6배 빨랐다. */
export const FLYING_BUILDING_PXF = 1;
/** 0.7441 타일/초. */
export const FLYING_BUILDING_TPS = (FLYING_BUILDING_PXF * BW_FPS) / 32;

/** 띄운 건물도 **가속을 탄다** — flingy.dat 실덤프(research-accel.json의 "Terran Command
 *  Center (lifted)")가 movement_type 1, accel 33raw = 0.12891 px/프레임²를 준다. 다만
 *  movement_type 1은 halt_distance를 안 보므로 **브레이크가 없다** — 하이템플러와 같은
 *  가지다. 목적지에서 속도를 안 줄이고 그대로 멈춘다.
 *  덤프의 top_speed는 1.66797 px/프레임(1.241 타일/초)인데 BWAPI는 1.00을 보고한다. 둘 다
 *  맞다: 이·착륙 오더가 최고 속도를 1 px/프레임으로 덮어쓰기 때문이다. 위 FLYING_BUILDING_TPS
 *  가 그 덮어쓴 값이고, dat 원값은 이 코드가 쓰지 않는다. */
export const FLYING_BUILDING_ACCEL_PXF2 = 0.12891;
/** 2.284 타일/초². */
export const FLYING_BUILDING_ACCEL_TPS2 = (FLYING_BUILDING_ACCEL_PXF2 * BW_FPS * BW_FPS) / 32;
/** 덮어쓴 최고속(1 px/프레임)까지 걸리는 프레임 — 1 / 0.12891 = 7.76프레임(0.326초). */
export const FLYING_BUILDING_RAMP_FRAMES = FLYING_BUILDING_PXF / FLYING_BUILDING_ACCEL_PXF2;
/** 감속 브레이크가 없다(movement_type 1). 목적지 앞에서 미리 줄이지 마라. */
export const FLYING_BUILDING_HAS_HALT = false;

/** 이륙 완료(42px 상승)까지의 프레임은 **안 적는다.** 앞선 조사가 하한 45프레임으로만
 *  확정했고 iscript.bin을 못 읽어 실값을 모른다. 확인 못 한 값을 상수로 굳히면 나중에
 *  누군가 그것을 원전으로 오해한다 — 그래서 비워 둔다. */
