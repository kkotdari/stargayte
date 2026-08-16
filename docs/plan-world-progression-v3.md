# 기획서 — 연속 재생 세계 진행 모델 v3: 교전 접근·건물 표적·파서 데이터 수리

> 대상 독자: 이 저장소를 처음 보는 구현 모델. 이 문서만으로 구현할 수 있게
> 앵커(찾을 코드 조각)·치환 코드·수식·엣지케이스·검증 목록을 전부 적었다.
> 조사 방법과 배경은 `docs/handoff-motion-world-model.md` 참고.
> 줄 번호는 2026-08-16 main 기준 근사치다 — **반드시 앵커 코드 조각으로 grep해서
> 위치를 다시 잡아라.** 작업 규칙: 빌드는 `npm run build > /tmp/build.log 2>&1;
> rc=$?`로 검증(파이프 금지), 단계마다 로컬 커밋, **푸시 금지**(사용자가 한다).

---

## 0. 증상과 원인 요약

증상: 질럿 부대가 해처리에 어택을 받았는데 화면에서는 멀리 서서 몸만 돌리며
"싸우는 척"하고, 해처리는 체력이 80~100% 남은 채 돌연 무너진다.

원인은 한 개가 아니라 **파서 6 + 렌더러 7**이 겹친 것이다. 전부 코드로 검증됐다
(적대적 반박 시도에서 살아남은 것만 "확정"으로 표기).

### 파서(src/utils/replayUnits.ts) — 데이터가 이미 틀려 있다

| # | 확정 원인 | 위치(앵커) |
|---|---|---|
| P1 | 어택 명령의 표적 태그(atg)는 표적에 Life(명령 이력)가 있을 때만 실린다. 시작 해처리처럼 명령받은 적 없는 건물을 찍으면 명시적 AttackUnit이어도 **atg=0** → 렌더러가 표적을 원천적으로 못 겨눈다 | L777-782 `const tgtLife = … alive.get(tgtTag0)`, L856 `hostileClick ? tgtTag0 : 0` |
| P2 | 시작 건물(본진 해처리·커맨드·넥서스)은 태그 없는 `t:-1` 물리 개체로만 존재. 렌더러 bldTagSpots 조건(`e.t>0 && f=2\|5`)을 채우는 건물은 **저그 드론 건설 건물(+변태 후계)과 착륙한 테란 건물뿐** — 테란/프로토스가 지은 모든 건물과 모든 시작 홀이 표적 지도에 없다 | L409-421, L525-577, L2169-2172 |
| P3 | 건물 체력·파괴는 공격자의 실위치와 무관하게 "공격 명령의 클릭 좌표·시각"만으로 진행된다. 태그 생애는 lastAtk+4초(L2107-2109, **건물 가드 없음**), 물리 행은 lastAtk+8초(L2158-2163)에 무조건 붕괴하는데 HP 원장은 클릭당 ~21만 깎아 **체력 80~100%에서 돌연 붕괴** | L1736-1799, L2107-2109, L2157-2168 |
| P4 | 태그 재사용 분리 생애(+1,000,000·n 합성 태그)는 원시 태그로 저장된 atg와 영원히 불일치 — 분리된 표적은 그 뒤 못 겨눈다 | L907-966, L1907-1956 |
| P5 | `tgtTag0 < 60000` 필터가 유효 태그를 버린다. BW 태그는 11비트 인덱스+5비트 재활용 카운터라 59392~65534도 정상 태그다 | L778, L863, L880, L894 |
| P6 | `ATTACK_ORDERS`에 "AttackFixedRange"가 없어 그 어택이 f=0 이동으로 격하된다 | L212-216 |

부가 확정: 발치 공격 증거는 건물 "왼쪽 위 앵커 ±2.5타일" 박스라 4×3 건물의
먼쪽 클릭이 샌다(L890-902 vs HP 판정은 중심+반경 7타일 — 기준 불일치). 죽은
태그의 stale Life로 적아 판정이 뒤집힐 수 있다(L777-781). v2는 건물 우클릭
랠리를 무시한다(L774, v1은 잡음).

### 렌더러(src/components/replay/ReplayMotionPlayer.tsx) — 데이터가 맞아도 그림이 틀린다

| # | 확정 원인 | 위치(앵커) |
|---|---|---|
| R1 | **정체 미상 개체(k="")는 질럿 모형으로 그려지지만 `MELEE_UNITS.has("")`가 실패**해 근접 파고들기가 안 걸리고, 원거리 규칙(당김 상한 2.5)로 표적 5.5~6.5타일 밖에 영구 주차 — 보고된 증상의 최다 재현 경로 | 8655-8657(drawUnit 폴백), 8710-8714 |
| R2 | 교전이 켜지면 표시 위치가 "교전 시작 순간의 자리(base)"에 박제되고, 원자취(rawPos)가 표적으로 전진해도 화면은 base에 남는다 | 8698-8701 |
| R3 | 파고든 거리가 지속 상태가 아니라서, fighting이 한 프레임 꺼지면 mem이 즉시 삭제되고 재교전 시 t0 리셋 → **접촉→후퇴 요요.** 컬링(화면 밖)만 돼도 `t-tLast≥2.5`로 base가 리셋된다 | 8698(유지 조건), 8727(즉시 삭제) |
| R4 | 교전이 끝날 때 멈춘 시간이 walkDelay로 **무한 누적**되고 새 명령으로도 안 지워져, 걸음 시계가 영구히 과거로 밀린다(교전 종료 시 최대 7타일 후퇴 요요 포함) | 8633-8637, 8719-8728 |
| R5 | atkAt 스캔이 "가장 최근 명령 1건"만 보고 break — **어택땅 연타 한 번이 건물 태그 표적을 지운다.** nearestFoe에는 일반 건물이 없어 폴백도 없다 | 8670-8688 |
| R6 | 건물 stopR가 중심 기준 고정 2.0 — 4×3 해처리의 세로변에선 발자국 안으로 파고들고 모서리엔 못 닿는다. 방어건물을 nearestFoe로 잡으면 bld 플래그가 없어 stopR 1.1로 성큰 발자국 안까지 들어간다 | 8711, 6658-6661 |
| R7 | 근접 유닛은 ATTACK_FX에 항목이 없어 전투 연출이 몸 회전+간헐 퍼프뿐("싸우는 척"의 시각적 실체). 교전 개체 2/3는 `ei % 3` 솎기로 fx 자체가 없다 | 4525-4533, 9070, 9101-9123 |

구조 진단(사용자 의심이 맞았다): 한 프레임 안에 **위치 모델이 세 벌**이다 —
표적 지도(entPosByTag)는 지연 없는 원자취, 교전 판정은 walkDelay 걸린 자취,
화면은 홀드+당김+스무딩. 그리고 결과 층(건물 HP·사망)은 이 셋 어디와도 결합이
없다. 걷기 재료 자체는 온전하다: 어택 명령은 클릭 좌표(표적 위치)를 f=7 목적지로
남기고 walkTrack이 실속도·길찾기로 걷는다 — **문제는 걷기가 아니라 홀드·표적
지도·철거 판정의 상호작용이다.**

---

## 1. 설계 원칙

1. **명령이 이동을 만든다** — 시야는 전투 연출 트리거일 뿐, 접근을 막지 않는다.
2. **전진은 지속 상태다** — 파고든 거리는 개체별 ref에 적분하고, 깜빡임·컬링으로
   증발하지 않는다. 홀드는 "후퇴 방지"로만 쓴다(원자취가 전진하면 통과시킨다).
3. **순간이동 무조건 금지** — 표시층 EMA(6/s)+활강 상한 9타일/s는 그대로 둔다.
4. 원거리는 멀리서 쏘는 게 제 모습(당김 상한 2.5 유지). 건물이 보이기만 해서
   싸움이 나면 안 된다(engageFoes에 일반 건물 불가 원칙 유지).
5. 1단계(렌더러)는 재분석 없이 기존 게임에 즉효, 2단계(파서)는 **재분석 필요**.

---

## 2. 1단계 — 렌더러 수리 (재분석 불필요) `ReplayMotionPlayer.tsx`

각 항목은 독립 커밋. 순서대로 하라.

### 1-A. 무명 개체도 근접으로 (R1)

앵커: `const melee9 = MELEE_UNITS.has(drawUnit);`
치환:

```tsx
            /* 무명 개체(k="")는 질럿 모형으로 그려지므로 근접으로 취급(수리:
               MELEE_UNITS.has("")가 실패해 원거리 주차됐다). */
            const melee9 = drawUnit === "" || MELEE_UNITS.has(drawUnit);
```

### 1-B. atkAt 스캔 — 어택땅은 건너뛰고 창 안의 태그 명령을 찾는다 (R5)

앵커: `for (let ai = e.atkAt.length - 1; ai >= 0; ai -= 1) {` (교전 블록 쪽,
8670 근처 — 같은 패턴이 7210 근처에도 있으니 **교전 블록 것만** 바꾼다).
현행 루프 전체를 치환:

```tsx
          /* 표적 우선(재수리): 최신 1건만 보던 규칙은 어택땅 연타 한 번에 건물
             표적을 지웠다 — 창(건물 45초/유닛 12초) 안에서 역순으로 훑되, 태그
             없는 명령(어택땅)은 건너뛰고 태그 있는 가장 최근 명령을 채택한다. */
          for (let ai = e.atkAt.length - 1; ai >= 0; ai -= 1) {
            const [as2, atg] = e.atkAt[ai];
            if (as2 > t) continue;
            if (t - as2 > 45) break;
            if (atg <= 0) continue;
            const tp = entPosByTag.get(atg);
            if (tp && tp.team > 0 && (team ?? 0) > 0 && tp.team !== team
              && t - as2 <= (tp.bld ? 45 : 12)) {
              const td = Math.hypot(tp.x - rawPos.x, tp.y - rawPos.y);
              if (td <= ENGAGE_SIGHT_TILES * 1.6) {
                foe = { bx: tp.x, by: tp.y, bd: td, air: tp.air, ...(tp.bld ? { bld: true } : {}) };
                break;
              }
            }
          }
```

### 1-C. 홀드·파고들기를 지속 전진 상태로 (R2·R3 — 핵심)

**ref 형태 변경**: engageHoldRef 값에 `adv`(파고든 거리, 타일)를 추가한다.
선언부 앵커(5933 근처): `engageHoldRef` — 타입에 `adv: number` 추가.

교전 블록의 `if (fighting && !uAir) { … }` 본문 전체를 치환:

```tsx
          if (fighting && !uAir) {
            const mem = engageHoldRef.current.get(holdKey);
            /* 되감기만 리셋 — 깜빡임·컬링 공백은 아래에서 시계로 흡수한다(수리:
               2.5초 유실 조건이 파고든 진행을 통째로 날려 요요를 만들었다). */
            let base = mem && t >= mem.t0 ? mem : null;
            if (!base) {
              base = { x: rawPos.x, y: rawPos.y, t0: t, tLast: t, adv: 0 };
              engageHoldRef.current.set(holdKey, base);
            }
            const dt9 = Math.max(0, Math.min(1.5, t - base.tLast));
            base.tLast = t;
            /* 홀드는 후퇴만 막는다(수리: 교전 시작 자리에 박제되던 것) — 원자취가
               표적에 더 가깝게 전진해 있으면 기준점을 따라 옮긴다. */
            const gNow = Math.hypot(foe.bx - rawPos.x, foe.by - rawPos.y);
            const gBase = Math.hypot(foe.bx - base.x, foe.by - base.y);
            if (gNow < gBase) {
              base.adv = Math.max(0, base.adv - (gBase - gNow));
              base.x = rawPos.x;
              base.y = rawPos.y;
            }
            const gap = Math.hypot(foe.bx - base.x, foe.by - base.y);
            const melee9 = drawUnit === "" || MELEE_UNITS.has(drawUnit);
            /* 정지 거리 — 건물은 발자국 사각형 가장자리 + 0.3타일(수리: 중심 고정
               2.0은 세로변을 파고들고 모서리에 못 닿았다). foe.k는 1-D에서 싣는다. */
            const maxAdv = ((): number => {
              if (foe.bld) {
                const fp = FOOTPRINT[foe.k ?? ""] ?? [3, 2];
                const ddx = Math.max(0, Math.abs(foe.bx - base.x) - fp[0] / 2);
                const ddy = Math.max(0, Math.abs(foe.by - base.y) - fp[1] / 2);
                return Math.max(0, Math.hypot(ddx, ddy) - 0.3);
              }
              return Math.max(0, gap - (melee9 ? 1.1 : 2.2));
            })();
            if (melee9) {
              /* 걸음 속도로 적분(수리: 2.6 고정 리터럴 → 유닛 실속도·속업 반영.
                 speedOf의 셋째 인자는 walkTrack 호출부(6307 근처)와 같은 것을 쓴다). */
              const spd9 = Math.max(0.5, speedOf(drawUnit || "Marine", t, upsSrc));
              base.adv = Math.min(Math.max(base.adv, 2.5), base.adv + dt9 * spd9);
            } else {
              base.adv = 2.5;
            }
            const pull = Math.min(base.adv, maxAdv);
            pos = gap > 0.01
              ? { ...rawPos, x: base.x + ((foe.bx - base.x) / gap) * pull, y: base.y + ((foe.by - base.y) / gap) * pull }
              : { ...rawPos, x: base.x, y: base.y };
          } else {
```

주의: `upsSrc`는 이 컴포넌트에서 speedOf/walkTrack이 쓰는 업그레이드 목록
변수명으로 맞춰라(grep `speedOf(` 호출부). `FOOTPRINT`·`speedOf`는 같은 파일
상단(383-411, 489-500)에 이미 있다. `Math.max(base.adv, 2.5)`는 기존의 "교전
진입 즉시 2.5타일 당김" 체감을 유지하는 초기값이다.

**else 분기(교전 종료)의 즉시 삭제도 완화**: 앵커 `engageHoldRef.current.delete(holdKey);`
(8727 근처) — 삭제 전에 유예를 둔다:

```tsx
            const mem = engageHoldRef.current.get(holdKey);
            if (mem && t >= mem.t0) {
              /* 깜빡임 유예(수리): 1.2초 안에 다시 붙으면 진행(adv)을 보존한다. */
              if (t - mem.tLast < 1.2) { /* 유지 — 적립도 삭제도 안 한다 */ }
              else {
                if (mem.tLast - mem.t0 > 0.4) {
                  engageDelayRef.current.set(holdKey, { delay: walkDelay + (mem.tLast - mem.t0), since: t });
                }
                engageHoldRef.current.delete(holdKey);
              }
            }
```

### 1-D. 표적에 종류(k) 싣기 + 방어건물 bld 플래그 (R6)

- bldTagSpots(5848 근처) rows에 `k: e.k`(건물 종류 문자열)를 추가하고,
  entPosByTag 주입부(6667-6674)에서 `{ …, bld: true, k: bt.k }`로 싣는다.
- entPosByTag 타입(6626 근처)에 `k?: string` 추가.
- 방어건물을 engageFoes/entPosByTag에 넣는 행(6654-6661)에도 `bld: true, k: bu`
  를 붙인다(성큰 발자국 침투 방지 — 1-C의 maxAdv가 그대로 처리한다).

### 1-E. 태그 건물 표적은 시야 밖에서도 접근 시작 (R5 보강)

앵커: `const fighting = canFight && !frzSt && Number.isFinite(foe.bd)` —
조건에 건물 태그 표적 예외를 더한다:

```tsx
          const fighting = canFight && !frzSt && Number.isFinite(foe.bd)
            && (foe.bd <= ENGAGE_SIGHT_TILES * (engagedBefore ? 1.3 : 1)
              /* 어택이 찍은 건물은 14.4타일부터 접근 시작(수리: 시야 게이트가
                 철거 행군을 9타일 밖에서 세워 뒀다). */
              || (foe.bld === true && foe.bd <= ENGAGE_SIGHT_TILES * 1.6));
```

### 1-F. walkDelay — 새 명령이 나오면 재동기화 (R4)

앵커(8633-8637 근처): walkDelay 계산부. `e.orders`(명령 시각 배열, entWalks에
이미 있음)로 적립 이후의 실제 새 명령을 감지해 지연을 걷는다:

```tsx
          const dmem = engageDelayRef.current.get(holdKey0);
          let walkDelay = dmem && t >= dmem.since ? dmem.delay : 0;
          if (dmem && t < dmem.since) { engageDelayRef.current.delete(holdKey0); walkDelay = 0; }
          /* 새 명령 재동기화(수리: 지연이 무한 누적돼 걸음 시계가 영구히 뒤처짐) —
             적립 이후 실제 명령이 나오면 그 명령 좌표가 현실이므로 지연을 걷는다. */
          if (dmem && walkDelay > 0 && e.orders.some((os0) => os0 > dmem.since && os0 <= t)) {
            engageDelayRef.current.delete(holdKey0);
            walkDelay = 0;
          }
```

(`const` → `let` 변경에 주의. 이후 `rawPos = posAt(rp, Math.max(rp[0][0], t - walkDelay), null)`은 그대로.)

### 1-G. 근접 전투 연출 (R7, 선택·다듬기)

ATTACK_FX(4525-4533)에 근접 유닛용 항목을 추가하거나, 근접+교전 중일 때 표적
방향으로 짧은 흰 호(슬래시) 이펙트를 추가한다. `ei % 3` 솎기(9070)는 근접 접촉
(pull이 maxAdv에 도달) 중에는 건너뛰지 않는다. 시각 사양은 자유 — "붙어서
때리는 게 보인다"가 목표.

### 1단계 검증

- `npm run build` 통과 후, dev로 실제 게임의 "질럿-해처리" 장면:
  ① 질럿(무명 포함)이 걸음 속도로 해처리 가장자리+0.3타일까지 파고들어 서는가
  ② 어택땅을 섞어 연타해도 표적을 놓지 않는가 ③ 줌아웃/줌인(컬링)·배속 변경
  후에도 후퇴 요요가 없는가 ④ 성큰에 붙는 근접이 발자국 안으로 파고들지 않는가
  ⑤ 교전이 끝나고 새 이동 명령을 받으면 지체 없이 그 길을 걷는가.

---

## 3. 2단계 — 파서 수리 (⚠ ents 산출이 바뀌므로 **재분석 필요**) `replayUnits.ts`

기존 게임에 반영하려면 제어판 재분석이 필요하다는 사실을 커밋 메시지와 사용자
보고에 반드시 명시하라.

### 2-A. atg는 어택류 오더면 무조건 싣는다 (P1)

앵커: `life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 7, hostileClick ? tgtTag0 : 0]);`
치환:

```ts
          /* 표적 태그는 명시적 어택류 오더면 무조건 싣는다(수리: 표적에 Life가
             없으면 atg=0이 돼 시작 홀 등은 원천적으로 못 겨눴다). hostileClick은
             우클릭을 어택으로 격상하는 판정에만 쓴다. */
          life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 7,
            ATTACK_ORDERS.has(orderName) || hostileClick ? tgtTag0 : 0]);
```

(같은 원리로 f=10 수리·힐의 tgtTag0은 이미 무조건이다 — 손대지 않는다.)

### 2-B. ATTACK_ORDERS 보강 (P6)

앵커: `const ATTACK_ORDERS = new Set<string>([` — `"AttackFixedRange"` 추가.
추가로 안전망: `isAtkOrder` 계산(782)에 `|| orderName.startsWith("Attack")`을
붙여 v1 파서(replayParser.ts)와 규칙을 맞춘다.

### 2-C. 태그 필터 `< 60000` → `!== 65535` (P5)

앵커 4곳(778, 863, 880, 894 근처)의 `tgtTag0 < 60000`류를 유효성 검사
`tgtTag0 !== 65535`(+ 기존 `> 0`)로 바꾼다. BW 태그는 16비트(11비트 인덱스 +
5비트 재활용 카운터)라 59392~65534도 정상이다.

### 2-D. 시작 홀·테란/프로토스 건물의 태그↔자리 연결 (P2 — 효과 최대)

직렬화 직전 후처리(2140-2180 근처, ents로 내보내는 단계)에 추가:

1. **f=1 앵커 승격**: 태그 건물 생애(`life.bld && site 없음`)에 f=1 앵커가 2개
   이상이면, 그 좌표들의 **중앙값**(median)을 자리로 보고 합성 f=2 이벤트
   `[첫 앵커 초, medX, medY, 2]`를 ev 맨 앞에 넣는다. (어택으로 찍힌 건물은
   클릭 좌표가 곧 그 건물 위치다 — 이미 쌓이고 있는 미사용 데이터.)
2. **built[] 결합**: 위에서 자리를 얻은 태그 생애를, 같은 종류(kinds)·시간
   겹침·중심 거리 3타일 이내의 built[] 행과 짝지어 (a) built 행의 born/gone과
   생애의 b/d를 서로 보정하고 (b) 짝지어진 built 행에 `pairTag: life.tag`를
   실어 렌더러가 이중 표시(저그 이중 개체 포함)를 걸러낼 수 있게 한다.
3. 시작 홀(L413-421에서 born:0으로 심는 built 행)은 태그 생애가 아예 없을 수
   있다 — 이 경우는 렌더러 쪽 보완: bldTagSpots를 만들 때 `t=-1`이라도
   **f=2 이벤트가 있는 건물 물리 행**은 "태그 없는 자리 행"으로 함께 색인하고,
   atg가 해석 안 되는 어택(태그는 있는데 지도에 없음)은 **클릭 좌표에서 3타일
   이내의 자리 행**으로 폴백 매칭한다(렌더러 변경이므로 1단계에 넣어도 된다 —
   1-B 루프의 `entPosByTag.get(atg)` 실패 시 폴백 분기).

### 2-E. 건물 조기 사망 가드 (P3·P10)

앵커: `} else if (life.lastAtk !== null && !life.evAfterAtk) { d = life.lastAtk + 4;`
— 조건에 `!life.bld &&`를 추가한다. 건물의 사망은 HP 시뮬(bldHpSimOf)이 0에
닿는 시각 또는 물리 행 gone 판정으로만 정한다. 물리 행의 `gone = lastAtk + 8`
(2158-2163)은 HP 시뮬과 묶는다: **HP가 30% 이상 남아 있으면 붕괴를 유예**하고,
붕괴가 확정되면 붕괴 8초 전부터 HP를 0으로 선형 수렴시켜 "만피 돌연 붕괴"를
없앤다(체력바와 결과의 결합 — bldHpSimOf 반환 자취의 마지막 구간 보정).

### 2-F. 발치 증거 박스를 발자국 기준으로 (P7)

앵커(898 근처): 클릭-건물 근접 판정 `±2.5` 고정 박스를 발자국 기반으로:
`x ∈ [b.x - 0.5, b.x + w + 0.5]`, `y ∈ [b.y - 0.5, b.y + h + 0.5]`
(w,h는 건물 종류의 발자국 — FOOTPRINT 표를 replayUnits로 옮기거나 복제).

### 2-G. (선택) stale Life 완화 (P8) · 우클릭 랠리 (P9) · 분리 태그 매칭 (P4)

- P8: 표적 조회(778, 880)에서 `tgtLife.lastAtk !== null && sec > tgtLife.lastAtk + 6
  && !tgtLife.evAfterAtk`인 생애는 죽은 것으로 보고 무시(적아 판정 오염 방지).
- P9: v1 방식(replayParser.ts 1086-1098)을 이식 — 건물만 선택된 채의 좌표 있는
  우클릭을 life.rallies에 수집.
- P4: 분리 생애를 만들 때(938, 1931) `srcTag: 원태그`를 실어 직렬화하고,
  렌더러 entPosByTag를 원태그로도 색인한다(같은 원태그가 여럿이면 최신 생애 우선).

### 2단계 검증

재분석 후: ① 시작 해처리를 어택 → 표적 지도에 오르고 질럿이 붙는가 ② 프로토스
게이트웨이 철거 장면에서도 동일한가 ③ 건물이 공격을 버텨낸 경우(체력 50% 이상
잔존) 조기 소멸하지 않는가 ④ 체력바가 붕괴 시각에 0으로 수렴하는가.

---

## 4. 3단계 — (선택) 위치 모델 통일

한 프레임에 세 벌인 위치(표적 지도=무지연 원자취 / 교전 판정=지연 자취 / 화면=
홀드+당김+EMA)를 "표시 위치" 한 벌로 통일한다. 구현: 렌더 루프가 매 프레임
개체별 최종 표시 위치를 `lastDrawPosRef`(신규 Map, holdKey → {x,y,at})에
기록하고, **다음 프레임**의 entPosByTag·engageFoes 구축(6626-6698)이 원자취
대신 이 캐시(1.5초 이내 신선한 것만)를 쓴다. 1프레임 지연은 허용 오차다.
이 단계는 1·2단계 검증이 끝난 뒤에만 하라 — 판정 연쇄(교전이 교전을 낳는
피드백)가 생길 수 있으니, 적용 후 대규모 난전 장면에서 진동이 없는지 반드시
확인한다.

---

## 5. 엣지케이스 표

| 상황 | 요구 동작 | 관련 코드 |
|---|---|---|
| 되감기(t 역행) | 모든 ref(hold·delay·drawPos·신규 adv) 스냅 리셋 — 기존 항목별 `t < mem.t0`/`t < since` 패턴 유지 | 8636, 8698, 8830 |
| 배속 ×10~20 | dt9 상한 1.5로 폭주 방지(1-C에 포함). EMA는 기존대로 사실상 스냅 | 8828-8846 |
| 일시정지 | t가 안 흐르므로 dt9=0 — 전진 없음(정상) | — |
| 컬링 복귀 | mem 보존 + dt9로 공백 시간만큼 따라잡기(상한 1.5초/프레임이므로 여러 프레임에 걸쳐 자연 추격 — 활강 상한이 순간이동을 막는다) | 1-C |
| 표적 사망/소멸 | entPosByTag에서 빠짐 → 1-B 루프가 더 옛 태그 명령 또는 nearestFoe로 폴백. hold는 1.2초 유예 후 적립·해제 | 1-B·1-C |
| 표적이 이동 중인 유닛 | foe 좌표가 프레임마다 갱신 — gap 재계산으로 자연 추격. maxAdv가 줄면 pull이 clamp돼 살짝 물러난다(EMA가 부드럽게) | 1-C |
| 탑승(rides)·건설 흡수(buildHides)·빙결(FREEZE) | 기존 게이트가 교전 블록보다 앞에서 return/고정 — 손대지 않는다 | 8641-8647, 8820-8823 |
| 죽음(dieAt) | 기존 로직 그대로. hold/adv는 다음 되감기·유예로 자연 소멸 | 8626-8630 |
| 어택땅(태그 0) | 접근은 원자취(f=7 좌표) 몫, 교전은 적 유닛이 있을 때만 — 1-B가 옛 태그 명령을 찾아주는 것은 "창 45초 안"일 때만 | 1-B |
| 가스/미네랄 왕복 일꾼 | `if (isWorker && !fighting)` 분기라 충돌 없음 — 일꾼은 canFight=false | 8734-8801 |
| 지형·건물 관통(직선 당김) | 1단계에서는 허용(기존과 동일). 원하면 후속: pull 경로를 gridAt(t) 보행 판정으로 샘플링해 벽 앞에서 멈춤 | 1-C 주석 |
| 저그 이중 개체(태그 생애+물리 행) | 2-D-2의 pairTag로 렌더러가 물리 행 하나만 그리게 걸러낸다 | 2-D |

## 6. 성능 주의

- 교전 블록은 개체 수백 × 매 프레임이다. 1-C의 maxAdv IIFE·hypot 추가는 소량이나,
  **새 객체 할당을 늘리지 마라**(base는 기존 객체를 제자리 수정).
- 1-B 루프는 최악 atkAt 전체 스캔 — `t - as2 > 45`에서 break하므로 유계다.
- 3단계의 lastDrawPosRef는 Map 재사용(프레임마다 new 금지).

## 7. 최종 인수 기준 (사용자 시나리오)

"질럿 부대가 12타일 밖에서 본진 해처리에 어택" 장면에서:
1. 질럿들이 걸어가(자취) 시야권부터는 파고들기(적분)로 해처리 가장자리에 붙는다.
2. 붙은 채 전투 연출이 보이고, 후퇴·요요·순간이동이 없다.
3. 해처리 체력바는 붕괴 시각을 향해 감소하고, 붕괴 시점에 유닛들이 그 곁에 있다.
4. 어택땅 연타·줌 조작·배속 변경·되감기를 섞어도 1~3이 유지된다.
5. (2단계 후) 시작 홀·프로토스/테란 건물 표적도 동일하게 동작한다.

---

## 8. 구현 현황 (2026-08-16)

| 항목 | 상태 | 커밋 |
|---|---|---|
| 1-B 어택 표적 스캔(어택땅 건너뛰기) | 완료 | 09b132f1 |
| 1-D 표적 k·bld 배관(nearestFoe 포함) | 완료 | 2f606c66 |
| 1-C·1-A 지속 적분(adv)·후퇴 방지 홀드·발자국 정지·무명 근접 | 완료 | b5162dac |
| 1-E 건물 표적 시야 밖 접근 시작 | 완료 | 6fe5519e |
| 1-F walkDelay 새 명령 재동기화 | 완료 | fef1a8f9 |
| 1-G 근접 베기 연출 + 솎기 완화 | 완료 | 495b636c |
| 2-A·B·C·D1·E·F 파서 수리 | 완료 (**⚠ 재분석 필요**) | 8bea77fc |
| 2-D3 렌더러 자리 폴백·허수아비 방지 | 완료(재분석 불필요) | 85555e2f |
| 2-D2 built[]↔태그 생애 pairTag 결합(이중 개체 정리) | 보류 — 소비자(렌더러 중복 제거)와 함께 후속 | — |
| 2-E의 "HP 30% 이상 붕괴 유예" | 보류 — 휴리스틱 위험, 0 수렴만 구현 | 8bea77fc |
| 2-G stale Life·우클릭 랠리·분리 태그 srcTag | 보류(선택) | — |
| 3단계 위치 모델 통일 | 보류 — 1·2단계 화면 검증 후 | — |

구현 편차: 1-C의 파고들기 속도는 speedOf(속업 반영) 대신 UNIT_SPEED 기본표를
쓴다 — 렌더 루프에 플레이어별 ups가 없어서이며, 속업 반영은 원자취(walkTrack)
몫이라 시각 차는 미미하다.
