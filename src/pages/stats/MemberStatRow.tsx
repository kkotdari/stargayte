import { Fragment, useState } from "react";
import Avatar from "../../components/common/Avatar";
import InfoTip from "../../components/common/InfoTip";
import PhotoViewer from "../../components/common/PhotoViewer";
import DonutChart from "../../components/common/DonutChart";
import { useAppStore } from "../../store/appStore";
import { cx } from "../../utils/format";
import { PER_WINDOW_SECONDS, topEntries, type BuildMix, type TopEntry } from "../../utils/replayBuildMix";
// 건물 이름표(BUILDING_KO)는 더 안 쓴다 — 건물 Top5를 걷었다(요청).
import { TECH_KO, UNIT_KO } from "../../utils/replaySummaryText";
import type { BaseRace, Member, MemberStats } from "../../types";

/** 유닛·스킬 칸에 적는 줄 수(요청: Top5). */
const TOP_N = 5;

/** 스킬 Top5에서 뺀다(요청: "시즈모드 스팀팩같은건 빼기") — 사실상 거의 매 판 켜는
 *  반사적인 토글(시즈모드·스팀팩·버로우)이라, 다섯 자리 중 절반이 늘 같은 이름으로
 *  채워져 정작 그 사람이 골라 쓴 스킬(스톰·EMP·플레이그 …)이 밀려났다. */
/* 스킬 Top5에서 뺄 것들 — 그 종족이면 누구나 늘 누르는 조작이라 목록에 서면 다섯 자리 중
   하나를 늘 같은 이름이 먹는다. 고스트 클로킹(Personnel Cloaking)도 같은 이유로 뺀다(요청):
   고스트를 뽑으면 따라오는 버튼이라 "무엇을 골라 썼나"를 말하지 못한다. */
const SKILL_LIST_EXCLUDE = new Set([
  "Tank Siege Mode", "Stim Packs", "Burrowing", "Personnel Cloaking",
]);

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

/** 도넛 위에 얹는 주요시간대 1분당 값(요청) — 건설은 "채/분", 유닛은 "기/분".
 *
 *  단위를 붙이는 건 이 수가 총합이 아니라 환산값이기 때문이다: 단위 없이 "24.0"만 있으면
 *  그 기간에 24채를 지었다는 말로 읽힌다. 값이 없는 경우(총 시간을 모르는 옛 응답)엔
 *  자리째 비운다 — "-"를 세워 두면 0으로 읽힌다. */
function PerMin({ value, unit }: { value: string | undefined; unit: string }) {
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

function UpgradeGrid({ mix, race }: { mix: BuildMix; race: BaseRace | null | undefined }) {
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
  /** 값 한 칸 — 경기당 평균 단계. 0~3짜리 값이라 소수 첫째 자리까지 본다. */
  const cell = (key?: string) => (
    <span className="scr-stat-up-cell">{avg(key) ?? "-"}</span>
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
function TopList({ items, unit }: { items: TopEntry[]; unit: string }) {
  void unit; // 수를 숨긴 동안에는 안 쓰인다(SHOW_TOP_VALUES 참고).
  /* (삭제) 전달 대비 순위 변동(▲2·신규) — 이 표는 전체 누적 하나라 견줄 달이 없다(요청).
     달을 안 고르는 목록에서 "지난달보다 두 계단"은 어느 달을 말하는지가 없는 수다. */

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
      {items.map((it, i) => (
          <li key={it.name}>
            <span className="scr-stat-toplist-rank">{i + 1}.</span>
            <span className="scr-stat-toplist-name">{it.name}</span>
            {SHOW_TOP_VALUES && (
              <span className="scr-stat-toplist-n">
                {it.perMin === null ? "-" : `${it.perMin.toFixed(1)}${unit}`}
              </span>
            )}
          </li>
      ))}
    </ul>
  );
}

/* (삭제) StatColumnMedals — 메달은 이 표에서 걷었다(요청: 내전 통계에서는 델타랑 메달은
   이제 쓰이지 않아). 순위를 매기는 화면이 아니게 되면서 "이 칸의 1등"이라는 말도 함께
   자리를 잃었다 — 줄 세우는 일은 래더가 한다. */

/* 주요지표는 막대가 아니라 수다(요청) — 게임수·승률·APM·커맨드 넷 다 막대로 그리던 것을
   걷었다. 막대는 '남과 견주는 그림'인데, 이 표는 한 사람의 줄을 읽는 자리라 견줄 상대가
   같은 화면에 세로로 멀리 떨어져 있다. 그 자리에서 막대는 길이를 견주게 해 주는 대신 수를
   작게 만들고 칸을 넓힌다. BEST 줄이 이미 수만 적고 있어(막대 없는 값) 다섯 줄의 꼴도
   이제야 같아진다.
   값이 없으면 "-"다 — 0과 '잰 적 없음'은 다른 말이라(리플레이가 없는 옛 경기) 0으로
   적으면 안 된다. */
function RecordNum({ value, unit }: { value: number | null; unit?: string }) {
  return (
    <div className="scr-stat-record-num">
      <span className="scr-stat-record-num-v">
        {value ?? "-"}
        {/* 단위는 수의 오른쪽에 매달되 자리는 안 차지한다 — BEST의 "회", 일꾼의 "기"와
            같은 규칙이라 수 자체가 다섯 줄에서 같은 x에 선다. */}
        {value !== null && unit && <span className="scr-stat-record-num-unit">{unit}</span>}
      </span>
    </div>
  );
}

/** 종족 칸의 순서 — 표의 열 순서가 곧 이것이다. */
const RACES: BaseRace[] = ["테란", "프로토스", "저그"];

/* 한 종족의 생산 한 칸(요청: 건물·유닛·스킬을 한 칸으로 합치고 종족별로 반복).
   담기는 것은 넷이다 — 분당 채수·기수와 그 구성 도넛 둘, 5분 일꾼, 업그레이드 표,
   그리고 유닛·스킬 Top5. 예전 세 칸에서 둘이 빠졌다(요청):
     건물 Top5 — 지은 건물의 순위는 종족이 정해지면 거의 같은 줄이 선다(본진·서플·배럭…).
       읽을 것이 없는 다섯 줄이 칸 높이의 3분의 1을 먹고 있었다.
     지상/공중 도넛 — 기본·고급·마법 도넛과 같은 유닛 무리를 다른 자로 잰 값이라, 둘을
       나란히 두면 어느 쪽이 '그 사람의 병력'인지가 흐려진다.
   그 사람이 이 종족으로 잰 판이 하나도 없으면 칸째 "-"다 — 빈 도넛이 서 있는 것보다
   정직하다. */
function RaceMixCell({ race, stats }: { race: BaseRace; stats?: MemberStats }) {
  const mix = stats?.buildMix;
  if (!stats || !mix) {
    return <div className="scr-stat-mix-cell"><span className="scr-stat-points-empty">-</span></div>;
  }
  return (
    <div className="scr-stat-mix-cell">
      {/* 윗줄 [일꾼] [건물 그래프] [유닛 그래프](요청) — 셋 다 "그 판에서 얼마나 뽑았나"라
          한 줄로 읽힌다. 일꾼이 맨 앞인 것은 그것이 다른 둘의 밑절미라서다: 일꾼 수가
          곧 분당 채수·기수를 만든다. */}
      <div className="scr-stat-mix-row">
        {/* 일꾼은 비율이 아니라 그냥 수다(요청) — 5분 동안 몇 기 뽑았나. */}
        <div className="scr-stat-worker5">
          {/* 여섯 캡션이 같은 클래스를 쓴다(요청: 라벨 위치·아랫줄과의 간격 통일) —
              한때 이 하나만 제 클래스를 갖고 있어 크기도 간격도 따로 놀았다. */}
          <span className="scr-stat-mix-list-cap">일꾼(5분)</span>
          {/* 단위를 붙인다(요청) — 수만 있으면 옆 도넛의 퍼센트와 같은 자로 잰 값처럼
              읽힌다. 값이 없을 때(-)는 붙일 단위가 없다. */}
          <span className="scr-stat-worker5-n">
            {stats.avgWorker5 ?? "-"}
            {stats.avgWorker5 !== null && <span className="scr-stat-worker5-unit">기</span>}
          </span>
        </div>
        <div className="scr-stat-mix-block">
          {/* 도넛 가운데 구멍이 아니라 위 캡션으로(요청) — 나머지 다섯 내용요소(일꾼·유닛·
              스킬·공방업)와 같은 자리에 같은 방식으로 이름을 단다. */}
          <span className="scr-stat-mix-list-cap">건물</span>
          {/* 분당 몇 채를 지었나 — 이 수만은 주요시간대 것으로 센다(요청). 도넛의 구성비와
              아래 Top5는 경기 전체다: 마법처럼 드문 사건까지 담아야 목록이 서고, 구성은
              초·후반까지 넣어야 그 판의 그림이 된다. */}
          <PerMin value={perMin(mix.coreBuild, stats.mixSeconds)} unit="채" />
          <div className="scr-stat-mix">
            <DonutChart
              title="건물"
              size={DONUT}
              /* 색은 이름에 고정이다(요청: 고유색) — 값이 커서 먼저 그려지느냐와 무관하게
                 생산은 늘 초록, 방어는 늘 파랑이다. */
              slices={[
                { label: "생산", value: mix.bProd, tone: 1 },
                { label: "방어", value: mix.bDef, tone: 2 },
              ]}
            />
          </div>
        </div>
        <div className="scr-stat-mix-block">
          <span className="scr-stat-mix-list-cap">병력</span>
          <PerMin value={perMin(mix.coreUnit, stats.mixSeconds)} unit="기" />
          <div className="scr-stat-mix">
            <DonutChart
              title="병력"
              size={DONUT}
              /* 마법은 늘 보라다(요청) — 마법 유닛은 어느 종족이든 드물어 조각이 작고,
                 그래서 값 순서로 색을 주면 이 조각만 판마다 색이 바뀌었다. */
              slices={[
                { label: "기본", value: mix.uBasic, tone: 1 },
                { label: "고급", value: mix.uAdv, tone: 2 },
                { label: "마법", value: mix.uCaster, tone: 3 },
              ]}
            />
          </div>
        </div>
      </div>
      {/* 아랫줄 [유닛 Top5] [스킬 Top5] [업그레이드](요청) — 셋 다 "무엇을 골라 썼나"라
          한 줄로 읽힌다. 업그레이드가 끝에 선 것은 그것만 이름이 아니라 수의 표라서다. */}
      <div className="scr-stat-mix-row">
        <div className="scr-stat-mix-list">
          <span className="scr-stat-mix-list-cap">유닛</span>
          <TopList items={topEntries(mix.units, UNIT_KO, TOP_N, mix.unitSecs)} unit="기" />
        </div>
        <div className="scr-stat-mix-list">
          <span className="scr-stat-mix-list-cap">스킬</span>
          <TopList items={topEntries(mix.skills, TECH_KO, TOP_N, mix.skillSecs, SKILL_LIST_EXCLUDE)} unit="회" />
        </div>
        <div className="scr-stat-mix-list">
          <span className="scr-stat-mix-list-cap">공방업</span>
          <UpgradeGrid mix={mix} race={race} />
        </div>
      </div>
    </div>
  );
}

interface MemberStatRowProps {
  member: Member;
  /** 전체 종족 합계 — 주요 지표(게임수·승률·APM·커맨드·BEST)가 쓰는 값. */
  stats: MemberStats;
  /** 종족별 통계 — 종족 칸 셋이 각자 제 것을 집는다(요청: 종족별로 반복). */
  byRace?: Partial<Record<BaseRace, MemberStats>>;
  /** 이 줄이 지금 로그인한 사람인가 — 배경을 살짝 깔아 제 줄을 바로 찾게 한다(요청). */
  me?: boolean;
  /** BEST PLAYER 횟수를 적을까 — 내전 화면만 넘긴다(요청). 팀전에만 붙는 값이라 래더에서는
   *  어느 줄이나 0이고, 그 0이 "한 번도 못 받았다"로 잘못 읽힌다. */
  showBest?: boolean;
  /* (삭제) maxOverallPlays·maxApm·maxCmd — 막대의 기준값(이 목록의 1등 = 100%)이었다.
     주요지표를 수로 바꾸면서(요청) 견줄 잣대가 필요 없어졌다. */
  // false면 프사를 아예 그리지 않는다 — 닉네임 버튼을 눌러도 프로필은 그대로 열린다.
  avatar?: boolean;
  /* (삭제) compact — 전적 막대의 짧은 표기(StatBar) 스위치였다. 막대가 없어졌다. */
  /** 닉네임 아래 한 줄로 붙는 별명(요청, statEpithet.ts) — "물량 끝판왕", "공포의 럴커
   *  부대"처럼 그 사람의 기록에서 뽑은 말이다. 기준은 내전 전체 누적이라 화면을 바꿔도
   *  안 흔들린다(useEpithets). 한 판도 안 뛴 사람에게는 안 온다. */
  epithet?: { label: string; why: string };
  /** 칭호 한 벌을 이미 받아 왔나 — 아직 받는 중이면 "칭호 없음"을 적으면 안 된다(없는 것과
   *  아직 모르는 것은 다른 말이다). */
  epithetReady?: boolean;
}

// 전적통계 목록의 테이블 한 행.
/* (삭제) 칭호 등급 색 — 전설(보라)·에픽(파랑)으로 칭호 글자에 색을 입혔다가 걷었다(요청).
   등급은 이름이 이미 말한다(3점대 이상만 여왕·퀸·여제를 쓴다) — 색까지 얹으면 표에서
   한 줄에 두 번 같은 말을 하는 셈이었다. */

export default function MemberStatRow({
  member, stats, byRace, me = false, showBest = false,
  avatar = true,
  epithet, epithetReady = false,
}: MemberStatRowProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const [photoOpen, setPhotoOpen] = useState(false);

  return (
    <div className={cx("scr-stat-row", me && "scr-stat-row-me")}>
      <div className="scr-stat-name-cell">
        {/* 칭호를 프사+닉네임 위로(요청: "칭호를 닉네임아바타 위로 이탤릭") — 부르는 말이
            먼저 눈에 들어오고 그 아래 누구인지가 확인되는 순서다. 이탤릭으로 닉네임과
            자체를 더 뚜렷이 가른다(요청) — 크기·색만으로 가르던 것에 글꼴 기울기까지 더한다.
            왜 그 칭호인가는 눌렀을 때만 띄운다(요청) — 늘 적어 두면 줄마다 두 줄이 되어
            표가 길어지고, 마우스를 얹어야 뜨는 방식은 손가락으로는 아예 안 뜬다.

            말풍선은 표 컬럼 헤더의 ⓘ와 같은 부품(InfoTip)을 그대로 쓴다 — 그쪽이 이미 같은
            문제를 풀어 놨기 때문이다(지적: 툴팁이 유저 컬럼 안으로 제한돼). 칭호가 앉은
            유저 칸은 조상마다 잘라 낸다: .scr-stat-table-clip이 overflow:hidden(둥근 모서리),
            .scr-stat-table이 가로 스크롤용 overflow-x:auto, 칸 자신은 position:sticky. CSS
            ::after로 그리면 무엇을 해도 그 셋 중 하나에 잘린다. InfoTip은 말풍선만 body로
            포털해 화면 좌표(fixed)로 띄우므로 자르는 조상이 아예 없고, 화면 가장자리 밀어넣기
            ·아래가 좁으면 위로 뒤집기·바깥 탭으로 닫기·한 번에 하나만 열기까지 딸려 온다.
            겉모습만 이 표의 칭호 규칙으로 갈아 끼운다(triggerClassName). */}
        {epithet ? (
          <InfoTip
            text={epithet.why}
            label={epithet.label}
            trigger={epithet.label}
            triggerClassName="scr-stat-name-epithet"
          />
        ) : epithetReady && (
          /* 줄 게 없으면 그렇다고 적는다(요청) — 자리를 통째로 비우면 그 줄만 이름이 아래로
             내려와 표가 들쭉날쭉해지고, 아직 안 받아온 것인지 없는 것인지도 구분이 안 된다. */
          <span className="scr-stat-name-epithet scr-stat-name-epithet-none">칭호 없음</span>
        )}
        {/* 프사와 닉네임을 한 덩어리로 묶는다 — 칭호가 이 둘 '위'에 서야 하기 때문이다(요청).
            묶지 않으면 칭호가 프사 옆(닉네임 위)에 남아, 프사와 이름과 칭호가 ㄱ자로 어긋난다. */}
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
            {/* (삭제) 닉네임 옆 종족 배지 — '주종족' 필터에서만 뜨던 것이라 종족 필터가
                사라지면서(요청) 함께 걷었다. 종족은 이제 칸 이름이 말한다. */}
          </span>
        </div>
        </div>
      </div>
      {/* 게임수·승률·APM·커맨드는 한 칸이다(요청: 통합) — 넷 다 "막대 하나 + 수" 한 줄짜리라
          칸을 넷 쓰면서 표만 넓어졌다. 랭크·레이팅도 같은 칸으로 들어온다(요청: 랭킹과 기록
          통합) — 셋 다 "그 사람이 얼마나 어떻게 뛰었나"라 한 덩어리로 읽는 편이 낫다.
          칸 안은 [랭크·레이팅] [게임수·승률] [APM·커맨드] 세 줄기이고 줄기 안에서만 세로로
          쌓인다. 어느 막대인지는 왼쪽 이름이 말한다. */}
      {/* (삭제) 레이팅·순위 줄기 — 래더로 통째로 옮겼다(요청). 이 칸에는 이제 막대들만 있다. */}
      <div className="scr-stat-record-cell">
        {/* 막대 넷이 세로로 한 줄기(요청) — 줄기를 둘로 나누지 않으므로 넷이 같은 폭을
            나눠 갖고, 이름은 왼쪽 한 열에 모여 막대 시작점이 넷 다 같은 x에 선다. */}
        <div className="scr-stat-record-col">
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">게임수</span>
            <RecordNum value={stats.plays > 0 ? stats.plays : null} unit="판" />
          </div>
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">승률</span>
            <RecordNum value={stats.plays > 0 ? stats.winRate : null} unit="%" />
          </div>
          <div className="scr-stat-record-item">
            <span className="scr-stat-record-label">APM</span>
            <RecordNum value={stats.avgApm} />
          </div>
          <div className="scr-stat-record-item">
            {/* 분당임을 라벨에 적는다(요청) — APM은 원래 분당이라 라벨 그대로. */}
            <span className="scr-stat-record-label">커맨드<span className="scr-stat-record-per">/분</span></span>
            <RecordNum value={stats.avgCmd} />
          </div>
          {/* BEST PLAYER 횟수(요청) — 막대 넷과 같은 격자의 한 줄이다. 한때 레이팅·순위
              줄기에 따로 세워 뒀는데, 그 줄기가 래더로 통째로 옮겨 가면서(요청) 여기 말고는
              앉을 자리가 없어졌다. 오히려 이 편이 맞다: 넷과 같은 이름표 열을 쓰므로 "무엇의
              수인가"를 같은 방식으로 읽고, 값과 변동도 다른 줄들과 세로로 맞는다.
              막대는 안 그린다 — 이 수는 남과 견주는 값이 아니라 그 사람이 받은 횟수다.
              0도 적는다(요청) — 감추면 줄마다 이 자리가 있었다 없었다 해서 표가 들쭉날쭉해지고,
              무엇보다 '0회'와 '이 표에 없는 값'이 같아 보인다. */}
          {showBest && (
            <div className="scr-stat-record-item">
              <span className="scr-stat-record-label">BEST</span>
              <div className="scr-stat-best-cell">
                <span className="scr-stat-best-n">
                  {stats.bests}
                  {/* 단위는 수의 오른쪽에 매달되 자리는 안 차지한다 — 레이팅의 "R", 일꾼의
                      "기"와 같은 규칙이라 수 자체가 아래 변동과 세로로 맞는다. */}
                  <span className="scr-stat-best-unit">회</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 종족마다 한 칸씩 — 건설·유닛·스킬을 한 칸으로 합치고 그 칸을 종족별로 되풀이한다
          (요청). 예전에는 칸 셋(건설/유닛/스킬)을 두고 종족 필터로 '어느 종족의 것을 볼까'를
          골랐는데, 그러면 전체종족을 보는 동안에는 세 칸이 통째로 사라졌다 — 종족이 안 정해진
          도넛은 무엇의 비율인지가 없는 그림이라 그럴 수밖에 없었다. 종족을 칸으로 세우면 그
          문제가 사라지고, 한 사람의 세 종족을 나란히 견줄 수도 있다(종족 필터가 없어진 이유). */}
      {RACES.map((r) => (
        <RaceMixCell key={r} race={r} stats={byRace?.[r]} />
      ))}
      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}
