import { Fragment, useState } from "react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import StatBar from "../../components/common/StatBar";
import ValueBar from "../../components/common/ValueBar";
import DonutChart from "../../components/common/DonutChart";
import RaceBadge from "../../components/common/RaceBadge";
import { useAppStore } from "../../store/appStore";
import { cx } from "../../utils/format";
import { PER_WINDOW_SECONDS, topEntries, topRanks, type BuildMix, type TopEntry } from "../../utils/replayBuildMix";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "../../utils/replaySummaryText";
import type { BaseRace, Member, MemberStats } from "../../types";

/** 유닛·스킬 칸에 적는 줄 수(요청: Top5). */
const TOP_N = 5;

/* 도넛 지름 — svg 좌표계 자체의 크기라 CSS로는 못 줄인다(viewBox를 늘리면 글자까지 같이
   줄어들어 읽을 수 없게 된다). 모바일에서도 같은 크기를 쓴다: 한 칸에 도넛이 하나나 둘뿐이라
   좁은 화면에서도 자리가 나고, 이보다 작으면 3시·9시 언저리 조각의 이름이 그림 밖으로
   나가 띠에서 아래 줄로 밀려난다(실측 56px에서 세 조각 모두 밀렸다).
   값은 global.css의 --scr-donut-size와 짝이다 — 한쪽만 고치면 칸 폭이 어긋난다. */
const DONUT = 72;

/** 합계를 주요시간대 1분당 값으로(요청) — 원장은 기간 안의 경기를 통째로 더한 값이라
 *  그대로 적으면 "오래 뛴 사람일수록 큰 수"가 된다. 분모는 경기 전체가 아니라 초반·막판을
 *  뺀 주요시간대의 합이고(replayBuildMix의 coreWindowOf), 분자도 같은 구간 것만 세어
 *  저장돼 있다. 그 구간을 못 잡는 짧은 경기는 분모가 아예 안 쌓여 여기가 undefined가
 *  되고, 화면은 그 자리를 비운다. */
function perMin(total: number, seconds: number | null | undefined): string | undefined {
  return seconds && seconds > 0
    ? (total / seconds * PER_WINDOW_SECONDS).toFixed(1)
    : undefined;
}

/* ── 전달 대비 변동 ────────────────────────────────────────────────────────────
   요청: 통계의 모든 수치에 전월 대비 변동을 화살표 말고 +/-로, 연하고 작은 글씨로.

   순위(랭크)만은 예전처럼 ▲▼를 그대로 쓴다 — 순위는 '작을수록 좋다'라 +3이 오른 것인지
   내린 것인지가 읽는 사람마다 갈리지만, 나머지 수치는 큰 쪽이 큰 값이라 부호가 곧 방향이다.

   견줄 값이 없으면(전체 기간을 보는 중이거나, 지난달에 한 판도 안 뛰었거나) 아무것도 안
   적는다. 0도 안 적는다 — 줄마다 "+0"이 늘어서면 정작 움직인 값이 묻힌다. */
function Delta({ now, prev, digits = 0, unit = "" }: {
  now: number | null | undefined;
  prev: number | null | undefined;
  /** 소수 몇 자리까지 — 승률·업그레이드처럼 정수로 반올림하면 뜻이 사라지는 값에 쓴다. */
  digits?: number;
  unit?: string;
}) {
  const d = typeof now === "number" && typeof prev === "number" ? now - prev : null;
  // 표시할 자릿수에서 0이면 안 움직인 것으로 본다 — 반올림해 0이 되는 값에 "+0"을
  // 다는 것은 거짓말에 가깝다.
  const text = d === null ? null : d.toFixed(digits);
  /* 움직이지 않았거나 견줄 값이 없으면 "-"다(요청: 아예 비우지 말고 - 표시) — 자리를
     늘 채워야 값이 있는 줄과 없는 줄의 높이가 같고, 빈칸이 '아직 안 그려진 것'으로
     읽히지도 않는다. 다만 읽을 값이 아니므로 더 눌러 둔다. */
  if (text === null || Number(text) === 0) {
    return <span className="scr-stat-delta scr-stat-delta-none">-</span>;
  }
  return (
    <span className="scr-stat-delta">{d! > 0 ? `+${text}` : text}{unit}</span>
  );
}

/** 도넛 위에 얹는 주요시간대 1분당 값(요청) — 건설은 "채/분", 유닛은 "기/분".
 *
 *  단위를 붙이는 건 이 수가 총합이 아니라 환산값이기 때문이다: 단위 없이 "24.0"만 있으면
 *  그 기간에 24채를 지었다는 말로 읽힌다. 값이 없는 경우(총 시간을 모르는 옛 응답)엔
 *  자리째 비운다 — "-"를 세워 두면 0으로 읽힌다. */
function PerMin({ value, prev, unit }: { value: string | undefined; prev?: string | undefined; unit: string }) {
  if (!value) return null;
  return (
    <div className="scr-stat-per10">
      {/* 단위는 수의 오른쪽에 매달되 자리는 안 차지한다(요청: 단위를 뺀 숫자와 변동이 줄을
          맞추고 가운데에) — 흐름에 두면 [수+단위]가 한 덩어리로 가운데에 서서, 정작 수는
          단위 폭의 절반만큼 왼쪽으로 밀려 아래 변동과 어긋난다. */}
      <span className="scr-stat-per10-val">
        {value}
        <span className="scr-stat-per10-unit">{unit}/분</span>
      </span>
      {/* 전달 대비 변동은 수 아래 한 줄로(요청) — 옆에 붙이면 단위와 뒤엉켜 "24.0채/분+1.2"가
          한 덩어리로 읽힌다. */}
      <span className="scr-stat-per10-delta">
        <Delta now={value === undefined ? null : Number(value)}
          prev={prev === undefined ? null : Number(prev)} digits={1} />
      </span>
    </div>
  );
}

/** 공/방/실드 단계 — 지상·공중 두 줄, 공·방·실드 세 칸(요청). 소수 첫째 자리까지 적는다:
 *  경기마다 0~3인 값을 평균 낸 것이라 정수로 반올림하면 "2.4와 2.6이 똑같이 2"가 된다. */
/* 분모는 mixPlays가 아니라 upPlays다 — 3단계까지 올리려면 일정 시간이 필요해서, 짧은 판은
   구조적으로 3이 될 수 없다. 그런 판까지 세면 평균이 실제보다 낮게 나온다(지적: 공방업이
   너무 낮게 나온다). 서버가 그 조건을 넘긴 판만 세어 이 분모로 내려 준다. */
/** 공/방/실드 평균을 낼 때 세는 경기의 최소 길이(분) — 서버의 _MIN_UPGRADE_SECONDS와 같은
 *  값이다. 화면은 이 값을 표시하기만 하고 거르는 일은 서버가 한다. */
const UPGRADE_MIN_MIN = 20;

/* 종족마다 업그레이드 줄이 다르다(지적: 각 종족의 업그레이드가 달라 저 표는 의미가 없다).
   테란은 지상이 보병·메카닉으로 갈리고 함선 줄이 따로 있으며 실드가 없다. 저그는 지상
   공격이 근접·원거리로 갈리지만 방어(갑각)는 하나다. 프로토스는 실드가 지상·공중 공통이다.
   예전 표는 이 셋을 '지상/공중 × 공/방 + 실드' 하나로 뭉갰고, 그래서 보병 3업 + 메카닉
   0업이 "지상 3"으로 보였다.

   그래서 종족을 고른 경우에만(또는 주종족으로 볼 때) 그 종족의 줄로 그린다 — 전체종족은
   서로 다른 것을 한 표에 겹쳐 놓는 일이라 아예 안 그린다.

   공유되는 줄(저그 갑각, 프로토스 실드)은 공/방 격자에 끼우지 않고 따로 한 줄로
   뗀다 — 같은 값을 두 줄에 적으면 줄마다 따로 있는 것으로 오해한다.

   이름은 게임에 있는 그대로 쓴다(요청: "지상방어 말고 갑각") — 뜻이 비슷하다고 내가 지어
   붙이면(내가 "지상 방어"라 적었던 자리가 그랬다) 정작 게임에서 그 이름을 찾을 수가 없다.
   그래서 줄 이름은 업그레이드 이름의 앞머리를 그대로 두고, 전체 이름은 그 줄에 title로
   달아 둔다 — 칸이 좁아 다 적을 수는 없지만 확인할 길은 남겨 둔다.

   테란만은 열 이름과 실제 이름이 어긋난다: 보병은 '방어구'인데 차량·함선은 '장갑'이다.
   한 표에 두 낱말을 나란히 둘 수가 없어 열은 공/방으로 두고, 정확한 이름은 title에 있다. */
type UpRow = { label: string; title: string; atk?: string; def?: string };
const UP_TABLE: Record<BaseRace, { rows: UpRow[]; solo?: { label: string; title: string; key: string } }> = {
  테란: {
    rows: [
      { label: "보병", title: "보병 공격력 / 보병 방어구", atk: "tInfW", def: "tInfA" },
      { label: "차량", title: "차량 공격력 / 차량 장갑", atk: "tVehW", def: "tVehP" },
      { label: "함선", title: "함선 공격력 / 함선 장갑", atk: "tShipW", def: "tShipP" },
    ],
  },
  저그: {
    rows: [
      { label: "근접", title: "근접 공격력", atk: "zMelee" },
      { label: "원거리", title: "원거리 공격력", atk: "zMissile" },
      { label: "비행", title: "비행 공격력 / 비행 갑각", atk: "zFlyW", def: "zFlyA" },
    ],
    // 갑각은 지상 전부가 나눠 쓴다 — 근접·원거리 줄에 같은 수를 두 번 적지 않는다.
    solo: { label: "갑각", title: "갑각(지상 유닛 공통 방어)", key: "zCara" },
  },
  프로토스: {
    rows: [
      { label: "지상", title: "지상 무기 / 지상 방어구", atk: "pGrdW", def: "pGrdA" },
      { label: "공중", title: "공중 무기 / 공중 방어구", atk: "pAirW", def: "pAirA" },
    ],
    solo: { label: "실드", title: "플라즈마 실드(지상·공중 공통)", key: "pShield" },
  },
};

function UpgradeGrid({ mix, prev, race }: {
  mix: BuildMix; prev?: BuildMix | null; race: BaseRace | null | undefined;
}) {
  /* 전체종족으로 볼 때도 자리는 남기고 왜 안 그리는지만 적는다(요청). 종족마다 업그레이드
     줄이 아예 달라(저그는 근접·원거리가 갈리고 테란은 보병·차량·함선이 갈린다) 한 표에
     겹쳐 놓을 수가 없다 — 그냥 빼 버리면 옆 스킬 목록이 당겨지고, 없는 값처럼 읽힌다. */
  if (!race) {
    return (
      <div className="scr-stat-upgrades scr-stat-upgrades-empty">
        <span className="scr-stat-up-note">※ 종족을 골라야 표시</span>
      </div>
    );
  }
  const table = UP_TABLE[race];
  /* 분모는 줄마다 따로다 — 종족이 섞인 기간에 하나로 세면 한 줄의 평균이 다른 종족 경기
     수만큼 눌린다. 서버가 줄별로 '그 줄이 실린 경기 수'를 세어 내려 준다. */
  const avgOf = (m: BuildMix | null | undefined, key?: string): number | null => {
    if (!key || !m) return null;
    const n = m.upCounts?.[key] ?? 0;
    if (n <= 0) return null;
    return (m.ups?.[key] ?? 0) / n;
  };
  const avg = (key?: string) => {
    const v = avgOf(mix, key);
    return v === null ? null : v.toFixed(1);
  };
  /** 값 한 칸 — 평균과 그 밑의 전달 대비 변동. 0~3짜리 값이라 소수 첫째 자리까지 본다. */
  const cell = (key?: string) => (
    <span className="scr-stat-up-cell">
      {avg(key) ?? "-"}
      <Delta now={avgOf(mix, key)} prev={avgOf(prev, key)} digits={1} />
    </span>
  );
  const rows = table.rows.filter((r) => avg(r.atk) !== null || avg(r.def) !== null);
  const solo = table.solo ? avg(table.solo.key) : null;
  /* 잴 만한 경기가 없으면 표는 안 그리되 자리는 남기고 왜 비었는지만 적는다(요청) —
     통째로 빼 버리면 옆의 스킬 목록이 그 줄에서만 왼쪽으로 당겨져 열이 어긋나고, 무엇보다
     "이 사람은 업글을 안 한다"로 읽힌다. 잰 적이 없다는 것과는 다른 말이다. */
  if (rows.length === 0 && solo === null) {
    return (
      <div className="scr-stat-upgrades scr-stat-upgrades-empty">
        <span className="scr-stat-up-note">※ {UPGRADE_MIN_MIN}분 이상 경기 없음</span>
      </div>
    );
  }
  return (
    <div className="scr-stat-upgrades" title={`${race} 업그레이드 — 경기당 평균 단계(0~3)`}>
      <span />
      <span className="scr-stat-up-head">공</span>
      <span className="scr-stat-up-head">방</span>
      {rows.map((r) => (
        <Fragment key={r.label}>
          <span className="scr-stat-up-row" title={r.title}>{r.label}</span>
          {cell(r.atk)}
          {cell(r.def)}
        </Fragment>
      ))}
      {table.solo && solo !== null && (
        <>
          <span className="scr-stat-up-row scr-stat-up-solo-label" title={table.solo.title}>
            {table.solo.label}
          </span>
          <span className="scr-stat-up-solo">{cell(table.solo.key)}</span>
        </>
      )}
    </div>
  );
}

/* 목록에 수를 적을지 — 지금은 이름만 보여준다(요청: 값이 정확한지 확인이 필요해 잠시 숨김).
   계산과 배관은 그대로 살아 있어서 이 상수만 true로 되돌리면 다시 나온다. 되돌릴 때
   global.css의 --scr-toplist-w도 90px → 186px으로 함께 올려야 자리가 맞는다. */
const SHOW_TOP_VALUES = false;

/** 많이 나온 순 목록 한 칸. 값이 없으면 다른 칸과 같은 "-" 하나로 둔다.
 *
 *  적는 수는 총합이 아니라 주요시간대 1분당 값이다(요청) — 총합은 오래 뛴 사람이 늘 크다.
 *  분모를 전체 경기시간으로 두지 않는 것도 같은 이유다: 안 쓴 판의 시간까지 세면 프로토스만
 *  쓰는 기술의 값이 종족 비율만큼 깎인다. 다만 목록의 '순서'는 총합으로 매긴다. */
function TopList({ items, unit, prevRanks }: {
  items: TopEntry[]; unit: string;
  /** 전달 같은 목록의 이름 → 순위(replayBuildMix의 topRanks) — 줄 옆 화살표의 기준선이다.
   *  '전체 기간'을 보는 중이면 안 넘어온다. */
  prevRanks?: Map<string, number>;
}) {
  void unit; // 수를 숨긴 동안에는 안 쓰인다(SHOW_TOP_VALUES 참고).
  /* 전달 대비 순위 변동(요청: Top5 옆에는 +- 말고 흰 화살표로, 몇 계단인지 수도 함께) —
     방향은 화살표가, 크기는 그 옆의 수가 말한다. */
  /** 몇 계단 움직였나 — +면 올라온 것. 화살표 옆에 그 수도 적는다(요청): 한 계단과 네
   *  계단이 같은 그림이면 목록에서 실제로 무엇이 뒤집혔는지가 안 보인다.
   *
   *  세 가지가 다른 말이다(요청): 지난달에 아예 없던 이름은 "신규"(견줄 자리가 없어
   *  '올랐다'고 말할 수 없다), 있었는데 제자리면 "-", 견줄 달 자체가 없으면(전체 기간)
   *  아무것도 안 적는다 — 마지막 경우에 "-"를 적으면 '안 움직였다'는 뜻이 되어 버린다. */
  const move = (name: string, i: number): number | "new" | "same" | null => {
    if (!prevRanks) return null;
    const before = prevRanks.get(name);
    if (before === undefined) return "new";
    const d = before - (i + 1);
    return d === 0 ? "same" : d;
  };
  /* 하나도 없어도 껍데기는 그대로 세운다(지적: 스킬이 없을 때 다른 클래스가 들어가서
     생기는 문제) — 예전엔 여기서 <span>만 돌려줬는데, 그러면 목록의 고정폭
     (--scr-toplist-w 90px)이 통째로 사라져 그 줄만 칸 속 묶음이 줄어들고, 묶음이 칸
     가운데에 서므로 가운데 구분선까지 딴 자리로 갔다. 같은 <ul>에 "-" 한 줄이면 폭이
     같아 줄마다 구분선이 한 x에 선다. */
  if (items.length === 0) {
    return (
      <ul className={cx("scr-stat-toplist", !SHOW_TOP_VALUES && "scr-stat-toplist-nameonly")}>
        <li><span className="scr-stat-toplist-name scr-stat-points-empty">-</span></li>
      </ul>
    );
  }
  return (
    <ul className={cx("scr-stat-toplist", !SHOW_TOP_VALUES && "scr-stat-toplist-nameonly")}>
      {items.map((it, i) => {
        const d = move(it.name, i);
        return (
          <li key={it.name}>
            <span className="scr-stat-toplist-name">
              {it.name}
              {/* 오른 줄과 내린 줄을 같은 톤으로 둔다(요청) — 내린 쪽을 눌러 두면 그것만
                  '덜 중요한 사실'이 되는데, 목록에서 빠질 뻔한 쪽이 오히려 눈에 걸려야 한다.
                  새로 든 이름만은 색으로 갈라 둔다(요청): 화살표가 말하는 '몇 계단'과는
                  아예 다른 종류의 사실이라, 같은 톤에 두면 목록에서 섞여 읽힌다. */}
              {d === "new" ? (
                <span className="scr-stat-toplist-move scr-activity-shift-new">신규</span>
              ) : d === "same" ? (
                <span className="scr-stat-toplist-move scr-stat-delta-none">-</span>
              ) : d !== null && (
                <span className="scr-stat-toplist-move">
                  {d > 0 ? `▲${d}` : `▼${-d}`}
                </span>
              )}
            </span>
            {SHOW_TOP_VALUES && (
              <span className="scr-stat-toplist-n">
                {it.perMin === null ? "-" : `${it.perMin.toFixed(1)}${unit}`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 이미 끝난 기간에서 각 칸의 1·2·3위에 붙는 메달(요청) — 칸 이름 → 이모지. 값이 없는
 *  칸(표본 미달로 "-"인 곳)은 애초에 순위에서 빠지므로 키 자체가 없다. */
export type StatColumnMedals = Partial<Record<
  "points" | "plays" | "rate" | "apm" | "cmd", string
>>;

interface MemberStatRowProps {
  member: Member;
  stats: MemberStats;
  /** 전달 같은 조건의 통계 — 이 줄의 모든 수치 옆(또는 아래)에 붙는 변동의 기준선이다(요청).
   *  '전체 기간'을 보고 있으면 견줄 달이 없어 안 넘어온다. */
  prev?: MemberStats;
  /** 이 줄이 지금 로그인한 사람인가 — 배경을 살짝 깔아 제 줄을 바로 찾게 한다(요청). */
  me?: boolean;
  /** BEST PLAYER 줄을 그릴까 — 개인전만 보고 있으면 안 그린다(요청). 팀전에만 붙는 값이라
   *  개인전 표에서는 어느 줄이나 0이고, 그 0이 "한 번도 못 받았다"로 잘못 읽힌다. */
  showBest?: boolean;
  /** 레이팅의 전달 값 — points와 같은 자리에서 온다(entry.rankScore). */
  prevPoints?: number | null;
  // 게임수 칸(ValueBar)의 기준값(이 목록에서 가장 많이 뛴 사람 = 100%).
  maxOverallPlays: number;
  // APM/커맨드 막대의 기준값(이 목록에서 가장 높은 값) — 게임수 막대와 같은 원칙.
  // 생산은 수치를 더 안 보여줘서(요청) 기준값도 필요 없다.
  maxApm: number;
  maxCmd: number;
  // false면 프사를 아예 그리지 않는다 — 닉네임 버튼을 눌러도 프로필은 그대로 열린다.
  avatar?: boolean;
  // 전적 막대 캡션을 "승/전" 짧은 표기로 줄인다(StatBar의 compact 참고).
  compact?: boolean;
  // 레이팅(실력 추정치를 화면용으로 옮긴 값, 새 회원 1000 기준) — undefined면 랭크·레이팅 두
  // 칸을 통째로 안 그린다(통계 화면 전용). null이면 이 기간 순위 대상이 아니라 "-".
  // 기간을 걸면 '그 기간에 번 점수'가 아니라 '그 시점까지의 기록으로 본 값'이다(요청).
  points?: number | null;
  // 지금 몇 위인가(공동순위 포함) — 레이팅과 나란한 제 컬럼이다(요청: 랭크·레이팅 분리).
  rank?: number | null;
  // 전달 대비 몇 계단 움직였나(+면 상승). "new"면 전달엔 순위가 없던 신규(요청: "신규면
  // 신규 표시") — null이면 변동 없음이거나 애초에 견줄 전달이 없는 경우(전체 기간 등)라
  // 아무것도 안 보여준다.
  rankDelta?: number | "new" | null;
  // (삭제) 레이팅 기준일자 — 줄마다 적던 것을 칸 머리 한 곳으로 옮겼다(요청, StatsScreen).
  // 레이팅을 누르면 레이팅 상세(경기 이력)를 연다.
  onPointsClick?: () => void;
  // 랭크를 누르면 최근 5개월 순위변동 그래프를 연다(요청) — 월을 보고 있을 때만 넘어온다.
  // 안 넘기면 랭크는 그냥 글자로만 그려진다.
  onRankClick?: () => void;
  // 지난 기간을 볼 때만 온다 — 아직 안 끝난 달에는 메달을 안 단다(StatsScreen 참고).
  medals?: StatColumnMedals;
  /** 이 줄의 값이 어느 종족 것인가 — 닉네임 옆 배지로 적는다(요청).
   *
   *  '주종족'으로 볼 때만 넘어온다. 다른 필터에서는 표 전체가 한 종족(또는 전체)이라
   *  제목 문장이 이미 말하고 있어, 줄마다 같은 글자를 되풀이할 이유가 없다. 주종족일
   *  때만은 줄마다 잣대가 달라서, 이 배지가 없으면 무엇끼리 견주는 표인지 알 수 없다. */
  race?: BaseRace | null;
  /** 업그레이드 표를 어느 종족 줄로 그릴까 — 종족을 고른 경우 그 종족, '주종족'이면 이
   *  회원의 주종족, '전체종족'이면 null(안 그린다). 위 race와 달리 종족 필터에서도 온다:
   *  이건 배지가 아니라 표의 내용 자체를 가르는 값이다. */
  upRace?: BaseRace | null;
  /** 건설·유닛·스킬 세 칸을 그릴까(요청) — 종족을 안 고르면(전체종족) 세 칸을 통째로
   *  뺀다. 자리를 비워 두는 것과는 다른 말이다: 칸을 남기면 그 안의 "-"가 '이 사람은 안
   *  지었다'로 읽힌다. 왜 없는지는 표 바깥 안내가 말한다(StatsScreen). */
  showMix?: boolean;
  /** 닉네임 아래 한 줄로 붙는 별명(요청, statEpithet.ts) — "물량 끝판왕", "공포의 럴커
   *  부대"처럼 그 사람의 기록에서 뽑은 말이다. 기준은 늘 전체 누적이라 기간을 바꿔도
   *  안 흔들린다(StatsScreen). 한 판도 안 뛴 사람에게는 안 온다. */
  epithet?: { label: string; why: string };
  /** 칭호 한 벌을 이미 받아 왔나 — 아직 받는 중이면 "칭호 없음"을 적으면 안 된다(없는 것과
   *  아직 모르는 것은 다른 말이다). */
  epithetReady?: boolean;
}

// 전적통계 목록의 테이블 한 행.
export default function MemberStatRow({
  member, stats, prev, me = false, showBest = true, prevPoints, maxOverallPlays, maxApm, maxCmd,
  avatar = true, compact = false,
  points, rank, rankDelta, onPointsClick, onRankClick, medals, race, upRace, showMix = true,
  epithet, epithetReady = false,
}: MemberStatRowProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const [photoOpen, setPhotoOpen] = useState(false);
  const mix = stats.buildMix;
  const pmix = prev?.buildMix ?? null;

  return (
    <div className={cx("scr-stat-row", me && "scr-stat-row-me")}>
      <div className="scr-stat-name-cell">
        {/* 프사와 닉네임을 한 덩어리로 묶는다 — 칭호가 그 둘 '밑'에 서야 하기 때문이다(요청).
            묶지 않으면 칭호는 닉네임 밑(프사 옆)에 남아, 프사와 이름과 칭호가 ㄱ자로 어긋난다. */}
        <div className="scr-stat-name-main">
        {avatar && (
          <button type="button" className="scr-stat-avatar-btn" onClick={() => setPhotoOpen(true)} aria-label={`${member.nickname} 사진 보기`}>
            <Avatar member={member} size={32} />
          </button>
        )}
        <div className="scr-stat-name-stack">
          {/* 배틀태그는 표시하지 않는다(요청) — 닉네임만. 주종족으로 볼 때만 그 종족이
              한 글자 배지로 뒤에 붙는다(요청). */}
          <span className="scr-stat-name-line">
            <button type="button" className="scr-stat-name-btn" onClick={() => openMemberProfile(member.id)}>
              {member.nickname}
            </button>
            {race && <RaceBadge race={race} circleLetter size={22} className="scr-stat-name-race" />}
          </span>
        </div>
        </div>
        {/* 별명은 닉네임보다 확실히 작고 옅게 둔다(요청) — 이 줄에서 사람을 가리키는 이름은
            어디까지나 닉네임이고, 이것은 그 옆에 붙는 말이다. 같은 무게로 적으면 표를
            훑을 때 두 이름이 겹쳐 읽혀 정작 누구 줄인지가 늦게 잡힌다.
            자리는 프사+닉네임 덩어리의 아래다(요청) — 칸 폭을 통째로 쓰므로 긴 칭호도
            닉네임 폭에 갇히지 않는다. */}
        {epithet ? (
          <>
            <span className="scr-stat-name-epithet">{epithet.label}</span>
            {/* 왜 그 칭호인가 — 칭호 바로 밑에 흐린 한 줄로 적는다(요청). 툴팁(data-why)만
                두던 자리인데, 툴팁은 마우스를 1초쯤 얹고 있어야 뜨고 손가락으로는 아예 안
                뜬다. 이 줄이 생기면서 회원 팝업 쪽 같은 설명은 걷었다 — 한 사실은 한 자리에서
                만 말한다(MemberProfileModal). */}
            <span className="scr-stat-name-epithet-why">{epithet.why}</span>
          </>
        ) : epithetReady && (
          /* 줄 게 없으면 그렇다고 적는다(요청) — 자리를 통째로 비우면 그 줄만 이름이 아래로
             내려와 표가 들쭉날쭉해지고, 아직 안 받아온 것인지 없는 것인지도 구분이 안 된다. */
          <span className="scr-stat-name-epithet scr-stat-name-epithet-none">칭호 없음</span>
        )}
      </div>
      {/* 게임수·승률·APM·커맨드는 한 칸이다(요청: 통합) — 넷 다 "막대 하나 + 수" 한 줄짜리라
          칸을 넷 쓰면서 표만 넓어졌다. 랭크·레이팅도 같은 칸으로 들어온다(요청: 랭킹과 기록
          통합) — 셋 다 "그 사람이 얼마나 어떻게 뛰었나"라 한 덩어리로 읽는 편이 낫다.
          칸 안은 [랭크·레이팅] [게임수·승률] [APM·커맨드] 세 줄기이고 줄기 안에서만 세로로
          쌓인다. 어느 막대인지는 왼쪽 이름이 말한다. */}
      <div className="scr-stat-record-cell">
        {points !== undefined && (
          <div className="scr-stat-rank-col">
            {rank == null && points === null ? (
              <span className="scr-stat-points-empty">-</span>
            ) : (
              <>
                <div className="scr-stat-rank-line scr-stat-rank-points">
                  {points === null ? (
                    <span className="scr-stat-points-empty">-</span>
                  ) : (
                    /* 값과 메달을 한 껍데기로 묶는다 — 메달이 값 바로 옆에 서려면 기준이
                       값이어야 한다(지적: 레이팅과 메달 사이가 너무 멀다). 줄 전체를 기준으로
                       두면 가운데 정렬 때문에 값 길이만큼 거리가 들쭉날쭉해진다. */
                    <span className="scr-stat-rank-val">
                      <button
                        type="button" className="scr-stat-points-btn"
                        onClick={onPointsClick} aria-label={`${member.nickname} 레이팅 상세`}
                      >
                        {points.toLocaleString()}
                        {/* 단위와 메달은 수의 오른쪽에 매달되 자리는 안 차지한다(요청: 단위를
                            뺀 숫자와 변동이 줄을 맞추고 가운데에) — 흐름에 두면 [수+단위+메달]이
                            한 덩어리로 가운데에 서고, 정작 수는 그 덩어리의 절반만큼 왼쪽으로
                            밀려 아래 변동과 어긋난다. 자리를 안 먹으니 메달이 있는 줄만 수가
                            밀리던 일도 함께 사라져, 자리를 비워 두던 빈 메달(-hole)도 걷었다.
                            그만큼 줄기는 넓어야 한다 — --scr-stat-rank-w 참고. */}
                        {/* 메달만은 수의 왼쪽 바깥이다(요청: 줄기 좌우 여백 축소) — 단위와
                            같은 쪽에 세우면 줄기가 담아야 할 폭이 [수 절반 + 단위 + 메달]의
                            두 배라 그만큼 벌어지고, 그 폭은 왼쪽에서 통째로 빈자리가 된다.
                            좌우로 갈라 매달면 두 쪽이 서로를 채운다. */}
                        <span className="scr-stat-points-side">
                          {/* 단위(요청) — 아랫줄의 "1위"와 달리 이 줄은 맨숫자라 무엇의 수인지가
                              칸 이름에만 기대고 있었다. "레이팅" 세 글자를 R 한 자로 줄였다
                              (요청) — 이 글자는 줄마다 똑같이 되풀이되는 말이라 한 번 읽으면
                              그다음부터는 자리만 먹고, 그 자리가 곧 줄기 폭이었다. */}
                          <span className="scr-stat-points-unit">R</span>
                          {/* 메달은 단위 바로 뒤 — 같은 껍데기(.scr-stat-points-side) 안에
                              들어와야 단위와 세로가 정확히 맞고 사이도 늘 같다. 따로 절대배치
                              하면 기준이 버튼이라 값의 가운데선과 미묘하게 어긋난다(지적:
                              위치가 안 예쁘다). 이 껍데기 자체가 자리를 안 먹으므로 수는
                              여전히 줄기 가운데에 선다. */}
                          {medals?.points && <span className="scr-stat-medal">{medals.points}</span>}
                        </span>
                      </button>
                    </span>
                  )}
                </div>
                {/* 레이팅의 전달 대비 변동 — 값 바로 아래 제 줄에(요청: 변동량은 무조건
                    수치 아래). 레이팅은 '그 날짜까지의 기록으로 본 값'이라, 전달 같은
                    자리의 값과 견주면 그 달에 얼마나 올랐나가 그대로 나온다. */}
                <div className="scr-stat-rank-line scr-stat-rank-delta">
                  <Delta now={points} prev={prevPoints} />
                </div>
                {/* 언제 기준인가는 칸 머리에 한 번만 적는다(요청) — 줄마다 같은 날짜가
                    되풀이되면 그 글자만 표에서 눈에 밟힌다. StatsScreen의 '주요 지표' 머리
                    아랫줄 참고. */}
                <div className="scr-stat-rank-line">
                  {rank == null ? (
                    <span className="scr-stat-points-empty">-</span>
                  ) : onRankClick ? (
                    <button
                      type="button" className="scr-stat-points-btn"
                      onClick={onRankClick} aria-label={`${member.nickname} 순위변동`}
                    >
                      {rank}위
                    </button>
                  ) : (
                    <span className="scr-stat-rank-plain">{rank}위</span>
                  )}
                </div>
                {/* 순위 변동도 수치 아래 제 줄이다(요청: 크기 줄이고 아래에) — 옆에 붙이면
                    [순위+변동]이 한 덩어리로 가운데에 서서 정작 순위가 왼쪽으로 밀리고,
                    이 줄기의 다른 값들(레이팅·BEST)과 규칙도 갈린다. 방향은 색과 화살표가
                    이미 말하므로 글자는 다른 변동들과 같은 크기까지 내린다. */}
                <div className="scr-stat-rank-line scr-stat-rank-move">
                  {rankDelta === "new" ? (
                    // 기존 활동 랭크변동 카드의 "신규" 배지와 같은 톤을 그대로 쓴다.
                    <span className="scr-activity-shift-new">신규</span>
                  ) : rankDelta != null && rankDelta !== 0 ? (
                    <span className={rankDelta > 0 ? "scr-activity-shift-up" : "scr-activity-shift-down"}>
                      {rankDelta > 0 ? `▲${rankDelta}` : `▼${-rankDelta}`}
                    </span>
                  ) : (
                    /* 안 움직였거나 견줄 달이 없으면 다른 변동 자리와 같은 "-" 하나 — 자리를
                       늘 지켜야 줄마다 아래 칸들의 높이가 같다. */
                    <span className="scr-stat-delta scr-stat-delta-none">-</span>
                  )}
                </div>
                {/* BEST PLAYER 횟수(요청: 몇 위 아래에) — 순위·레이팅과 같은 '그 사람이 어디쯤인가'
                    묶음이라 이 줄기에 붙인다. 0도 적는다(요청) — 한때 받은 적 없으면
                    감췄는데, 그러면 줄마다 이 자리가 있었다 없었다 해서 아래 칸들이
                    들쭉날쭉해지고, 무엇보다 '0회'와 '이 표에 없는 값'이 같아 보였다. */}
                {showBest && (
                  <>
                    {/* 배지·수·변동이 한 격자다 — 수와 변동이 같은 열에 서야 세로선이 맞고
                        (요청), 배지는 그 왼쪽 열에 흐름 그대로 놓인다.
                        한때 배지를 절대배치로 띄워 수만 가운데 세웠는데, 그러면 배지가 칸
                        밖으로 삐져나가 왼쪽 구분선을 넘었다(지적: 레이아웃 깨짐) — 줄기 폭
                        (--scr-stat-rank-w)은 [수+단위] 기준이라 배지가 앉을 자리가 없다.
                        격자로 두면 세 덩어리가 제 폭을 갖고 통째로 칸 가운데에 선다. */}
                    <div className="scr-stat-rank-line scr-stat-rank-best">
                      <span className="scr-stat-best-tag">BEST</span>
                      <span className="scr-stat-best-n">
                        {stats.bests}
                        {/* 단위(요청) — 수의 오른쪽에 매달되 자리는 안 차지한다. 레이팅의 "R",
                            일꾼의 "기"와 같은 규칙이라, 수 자체는 아래 변동과 세로로 맞는다. */}
                        <span className="scr-stat-best-unit">회</span>
                      </span>
                      {/* 변동은 여기서도 수치 아래다(요청) — 레이팅이 그렇게 서 있으므로
                          이 줄만 옆에 달면 같은 줄기 안에서 규칙이 갈린다. */}
                      <span className="scr-stat-best-delta">
                        <Delta now={stats.bests} prev={prev?.bests} />
                      </span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {/* 막대 넷이 세로로 한 줄기(요청) — 줄기를 둘로 나누지 않으므로 넷이 같은 폭을
            나눠 갖고, 이름은 왼쪽 한 열에 모여 막대 시작점이 넷 다 같은 x에 선다. */}
        <div className="scr-stat-record-col">
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">게임수</span>
            <ValueBar
              value={stats.plays > 0 ? stats.plays : null} maxValue={maxOverallPlays} medal={medals?.plays}
              delta={<Delta now={stats.plays} prev={prev?.plays} />}
            />
          </div>
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">승률</span>
            <StatBar
              plays={stats.plays} wins={stats.wins} draws={stats.draws} losses={stats.losses}
              winRate={stats.winRate} compact={compact} medal={medals?.rate}
              /* 승률만은 소수 첫째 자리까지 — 정수로 반올림하면 47.6 → 48.1처럼 실제로
                 움직인 값이 "+0"으로 사라진다. 단위(%p)까지는 안 붙인다: 옆의 값이 이미
                 %라 부호와 수만으로 무슨 자인지 읽힌다. */
              delta={<Delta
                now={stats.plays > 0 ? stats.winRate : null}
                prev={prev && prev.plays > 0 ? prev.winRate : null}
                digits={1}
              />}
            />
          </div>
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">APM</span>
            <ValueBar
              value={stats.avgApm} maxValue={maxApm} medal={medals?.apm}
              delta={<Delta now={stats.avgApm} prev={prev?.avgApm} />}
            />
          </div>
          <div className="scr-stat-record-item">
            {/* 분당임을 라벨에 적는다(요청) — APM은 원래 분당이라 라벨 그대로. */}
            <span className="scr-stat-record-label">커맨드<span className="scr-stat-record-per">/분</span></span>
            <ValueBar
              value={stats.avgCmd} maxValue={maxCmd} medal={medals?.cmd}
              delta={<Delta now={stats.avgCmd} prev={prev?.avgCmd} />}
            />
          </div>
        </div>
      </div>
      {/* 종족을 안 골랐으면 세 칸을 통째로 안 그린다(요청) — 여러 종족을 겹쳐 놓은 도넛과
          목록은 무엇의 비율인지가 없는 그림이다. 칸 머리도 함께 빠진다(StatsScreen). */}
      {showMix && <>
      {/* 건설 — 그래프 하나(생산/방어), 경기당 평균 건설 수, 많이 지은 건물 다섯(요청).
          구성이 실린 경기가 하나도 없거나 표본이 모자라면 통째로 "-" — 빈 도넛이 서 있는
          것보다 정직하다. */}
      <div className="scr-stat-build-cell">
        {mix ? (
          <>
            <div className="scr-stat-mix-block">
              {/* 10분당 몇 채를 지었나 — 도넛 가운데 구멍에 적던 것을 그림 위로 뺐다(요청).
                  구멍 안에서는 "건물"이라는 이름과 나란히 놓여 이 수가 무엇의 수인지가
                  섞여 읽혔고, 단위도 못 적었다(구멍이 좁다). 위로 빼면 단위까지 붙는다. */}
              {/* 분당 몇 채를 지었나 — 이 수만은 주요시간대 것으로 센다(요청). 도넛의
                  구성비·아래 Top5는 경기 전체다: 마법처럼 드문 사건까지 담아야 목록이
                  서고, 구성은 초·후반까지 넣어야 그 판의 그림이 된다. */}
              <PerMin
                value={perMin(mix.coreBuild, stats.mixSeconds)}
                prev={pmix ? perMin(pmix.coreBuild, prev?.mixSeconds) : undefined}
                unit="채"
              />
              <div className="scr-stat-mix">
                <DonutChart
                  title="건물"
                  size={DONUT}
                  slices={[
                    { label: "생산", value: mix.bProd, prev: pmix?.bProd },
                    { label: "방어", value: mix.bDef, prev: pmix?.bDef },
                  ]}
                />
              </div>
            </div>
            <TopList
              items={topEntries(mix.buildings, BUILDING_KO, TOP_N, mix.buildingSecs)} unit="개"
              prevRanks={pmix ? topRanks(pmix.buildings, BUILDING_KO) : undefined}
            />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      {/* 유닛 — 그래프 둘(기본/고급/마법, 지상/공중), 초반 5분 일꾼 수, 많이 뽑은 유닛 다섯. */}
      <div className="scr-stat-units-cell">
        {mix ? (
          <>
            <div className="scr-stat-mix-block">
              {/* 건설 칸과 같은 자리·같은 모양으로 10분당 뽑은 유닛 수(요청) — 두 도넛은
                  같은 유닛 무리를 두 가지로 갈라 본 것이라 수는 하나뿐이고, 그래서 둘
                  위쪽 가운데에 한 번만 적는다. */}
              <PerMin
                value={perMin(mix.coreUnit, stats.mixSeconds)}
                prev={pmix ? perMin(pmix.coreUnit, prev?.mixSeconds) : undefined}
                unit="기"
              />
              <div className="scr-stat-mix">
                <DonutChart
                  title="병력"
                  size={DONUT}
                  slices={[
                    { label: "기본", value: mix.uBasic, prev: pmix?.uBasic },
                    { label: "고급", value: mix.uAdv, prev: pmix?.uAdv },
                    { label: "마법", value: mix.uCaster, prev: pmix?.uCaster },
                  ]}
                />
                <DonutChart
                  title="지형"
                  size={DONUT}
                  slices={[
                    { label: "지상", value: mix.uGround, prev: pmix?.uGround },
                    { label: "공중", value: mix.uAir, prev: pmix?.uAir },
                  ]}
                />
              </div>
            </div>
            {/* 일꾼은 비율이 아니라 그냥 수다(요청) — 5분 동안 몇 기 뽑았나. 도넛과 나란히
                가로로 서므로(요청) 이름과 수를 위아래로 포개 도넛 한 칸만큼의 폭만 쓴다. */}
            <div className="scr-stat-worker5">
              <span className="scr-stat-worker5-label">5분 일꾼</span>
              {/* 단위를 붙인다(요청) — 수만 있으면 옆 도넛의 퍼센트와 같은 자로 잰 값처럼
                  읽힌다. 값이 없을 때(-)는 붙일 단위가 없다. 단위는 수의 오른쪽에 매달되
                  자리는 안 차지한다(요청) — 그래야 수 자체가 가운데에 서서 아래 변동과
                  세로로 맞는다. */}
              <span className="scr-stat-worker5-n">
                {stats.avgWorker5 ?? "-"}
                {stats.avgWorker5 !== null && <span className="scr-stat-worker5-unit">기</span>}
              </span>
              {/* 변동은 수치 아래 한 줄로(요청). */}
              <span className="scr-bar-delta">
                <Delta now={stats.avgWorker5} prev={prev?.avgWorker5} digits={1} />
              </span>
            </div>
            <TopList
              items={topEntries(mix.units, UNIT_KO, TOP_N, mix.unitSecs)} unit="기"
              prevRanks={pmix ? topRanks(pmix.units, UNIT_KO) : undefined}
            />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      {/* 스킬 — 공/방/실드 단계와 많이 쓴 마법 다섯. */}
      <div className="scr-stat-skills-cell">
        {mix ? (
          <>
            <UpgradeGrid mix={mix} prev={pmix} race={upRace} />
            <TopList
              items={topEntries(mix.skills, TECH_KO, TOP_N, mix.skillSecs)} unit="회"
              prevRanks={pmix ? topRanks(pmix.skills, TECH_KO) : undefined}
            />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      </>}
      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}
