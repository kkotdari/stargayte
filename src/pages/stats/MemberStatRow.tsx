import { useState } from "react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import StatBar from "../../components/common/StatBar";
import ValueBar from "../../components/common/ValueBar";
import DonutChart from "../../components/common/DonutChart";
import { useAppStore } from "../../store/appStore";
import { topEntries, type BuildMix } from "../../utils/replayBuildMix";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "../../utils/replaySummaryText";
import type { Member, MemberStats } from "../../types";

/** 유닛·스킬 칸에 적는 줄 수(요청: Top5). */
const TOP_N = 5;

/* 도넛 지름 — svg 좌표계 자체의 크기라 CSS로는 못 줄인다(viewBox를 늘리면 글자까지 같이
   줄어들어 읽을 수 없게 된다). 모바일에서도 같은 크기를 쓴다: 한 칸에 도넛이 하나나 둘뿐이라
   좁은 화면에서도 자리가 나고, 이보다 작으면 3시·9시 언저리 조각의 이름이 그림 밖으로
   나가 띠에서 아래 줄로 밀려난다(실측 56px에서 세 조각 모두 밀렸다).
   값은 global.css의 --scr-donut-size와 짝이다 — 한쪽만 고치면 칸 폭이 어긋난다. */
const DONUT = 72;

/** 합계를 경기당 값으로 — 원장은 기간 안의 경기를 통째로 더한 값이라 그대로 적으면
 *  "많이 뛴 사람일수록 큰 수"가 된다. 경기 수를 모르면(옛 응답) 아무것도 안 적는다. */
function perGame(total: number, plays: number | null | undefined): string | undefined {
  return plays && plays > 0 ? `${Math.round(total / plays)}` : undefined;
}

/** 공/방/실드 단계 — 지상·공중 두 줄, 공·방·실드 세 칸(요청). 소수 첫째 자리까지 적는다:
 *  경기마다 0~3인 값을 평균 낸 것이라 정수로 반올림하면 "2.4와 2.6이 똑같이 2"가 된다. */
function UpgradeGrid({ mix, plays }: { mix: BuildMix; plays: number | null | undefined }) {
  if (!plays || plays <= 0) return null;
  const avg = (n: number) => (n / plays).toFixed(1);
  return (
    <div className="scr-stat-upgrades" title="공/방/실드 업그레이드 — 경기당 평균 단계(0~3)">
      <span />
      <span className="scr-stat-up-head">공</span>
      <span className="scr-stat-up-head">방</span>
      <span className="scr-stat-up-head">실드</span>
      <span className="scr-stat-up-row">지상</span>
      <span>{avg(mix.upGw)}</span>
      <span>{avg(mix.upGa)}</span>
      {/* 실드는 프로토스 하나뿐이고 지상·공중 모두에 걸리는 값이라 두 줄에 같은 수가 선다. */}
      <span>{avg(mix.upSh)}</span>
      <span className="scr-stat-up-row">공중</span>
      <span>{avg(mix.upAw)}</span>
      <span>{avg(mix.upAa)}</span>
      <span>{avg(mix.upSh)}</span>
    </div>
  );
}

/** 많이 나온 순 목록 한 칸. 값이 없으면 다른 칸과 같은 "-" 하나로 둔다. */
function TopList({ items, unit }: { items: { name: string; count: number }[]; unit: string }) {
  if (items.length === 0) return <span className="scr-stat-points-empty">-</span>;
  return (
    <ul className="scr-stat-toplist">
      {items.map((it) => (
        <li key={it.name}>
          <span className="scr-stat-toplist-name">{it.name}</span>
          <span className="scr-stat-toplist-n">{it.count.toLocaleString()}{unit}</span>
        </li>
      ))}
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
  // 랭크 포인트(TrueSkill 보수추정, 표시 스케일) — undefined면 랭크·포인트 두 컬럼을
  // 통째로 안 그린다(통계 화면 전용). null이면 이 기간 순위 대상이 아니라 "-".
  points?: number | null;
  // 지금 몇 위인가(공동순위 포함) — 포인트와 나란한 제 컬럼이다(요청: 랭크·포인트 분리).
  rank?: number | null;
  // 전달 대비 몇 계단 움직였나(+면 상승). "new"면 전달엔 순위가 없던 신규(요청: "신규면
  // 신규 표시") — null이면 변동 없음이거나 애초에 견줄 전달이 없는 경우(전체 기간 등)라
  // 아무것도 안 보여준다.
  rankDelta?: number | "new" | null;
  // 포인트를 누르면 포인트 상세(경기 이력)를 연다.
  onPointsClick?: () => void;
  // 랭크를 누르면 최근 5개월 순위변동 그래프를 연다(요청) — 월을 보고 있을 때만 넘어온다.
  // 안 넘기면 랭크는 그냥 글자로만 그려진다.
  onRankClick?: () => void;
  // 지난 기간을 볼 때만 온다 — 아직 안 끝난 달에는 메달을 안 단다(StatsScreen 참고).
  medals?: StatColumnMedals;
}

// 전적통계 목록의 테이블 한 행.
export default function MemberStatRow({
  member, stats, maxOverallPlays, maxApm, maxCmd, avatar = true, compact = false,
  points, rank, rankDelta, onPointsClick, onRankClick, medals,
}: MemberStatRowProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const [photoOpen, setPhotoOpen] = useState(false);
  const mix = stats.buildMix;

  return (
    <div className="scr-stat-row">
      <div className="scr-stat-name-cell">
        {avatar && (
          <button type="button" className="scr-stat-avatar-btn" onClick={() => setPhotoOpen(true)} aria-label={`${member.nickname} 사진 보기`}>
            <Avatar member={member} size={32} />
          </button>
        )}
        <div className="scr-stat-name-stack">
          {/* 배틀태그는 표시하지 않는다(요청) — 닉네임만. */}
          <button type="button" className="scr-stat-name-btn" onClick={() => openMemberProfile(member.id)}>
            {member.nickname}
          </button>
        </div>
      </div>
      {/* 랭크와 포인트는 한 칸이다(요청: 통합) — 위에 랭크, 아래에 포인트 두 줄. 한때
          두 컬럼으로 갈라 뒀는데, 둘은 사실 같은 값의 두 얼굴이라(포인트로 매긴 것이 랭크다)
          칸을 둘 쓰면서 표만 넓어졌다. 누르는 자리는 여전히 둘이다 — 랭크는 순위변동
          그래프, 포인트는 경기 이력. */}
      {points !== undefined && (
        <div className="scr-stat-rank-cell">
          {rank == null && points === null ? (
            <span className="scr-stat-points-empty">-</span>
          ) : (
            <>
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
                {/* 변동은 방향이 곧 의미라 색과 화살표로만 짧게. 신규는 화살표 대신
                    "신규" 글자로(요청). */}
                {rankDelta === "new" ? (
                  // 기존 피드 랭크변동 카드의 "신규" 배지와 같은 톤을 그대로 쓴다.
                  <span className="scr-feed-shift-new">신규</span>
                ) : rankDelta != null && rankDelta !== 0 && (
                  <span className={rankDelta > 0 ? "scr-feed-shift-up" : "scr-feed-shift-down"}>
                    {rankDelta > 0 ? `▲${rankDelta}` : `▼${-rankDelta}`}
                  </span>
                )}
              </div>
              <div className="scr-stat-rank-line scr-stat-rank-points">
                {points === null ? (
                  <span className="scr-stat-points-empty">-</span>
                ) : (
                  <>
                    <button
                      type="button" className="scr-stat-points-btn"
                      onClick={onPointsClick} aria-label={`${member.nickname} 포인트 상세`}
                    >
                      {points.toLocaleString()}
                    </button>
                    {medals?.points && <span className="scr-stat-medal">{medals.points}</span>}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <div className="scr-stat-plays-cell">
        <ValueBar value={stats.plays > 0 ? stats.plays : null} maxValue={maxOverallPlays} medal={medals?.plays} />
      </div>
      <div className="scr-stat-bar-cell">
        <StatBar plays={stats.plays} wins={stats.wins} draws={stats.draws} losses={stats.losses} winRate={stats.winRate} compact={compact} medal={medals?.rate} />
      </div>
      {/* 건설 — 그래프 하나(생산/방어), 경기당 평균 건설 수, 많이 지은 건물 다섯(요청).
          구성이 실린 경기가 하나도 없거나 표본이 모자라면 통째로 "-" — 빈 도넛이 서 있는
          것보다 정직하다. */}
      <div className="scr-stat-build-cell">
        {mix ? (
          <>
            <div className="scr-stat-mix">
              <DonutChart
                title="건물"
                size={DONUT}
                note={perGame(mix.bProd + mix.bDef, stats.mixPlays)}
                slices={[
                  { label: "생산", value: mix.bProd },
                  { label: "방어", value: mix.bDef },
                ]}
              />
            </div>
            <TopList items={topEntries(mix.buildings, BUILDING_KO, TOP_N)} unit="개" />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      {/* 유닛 — 그래프 둘(기본/고급/마법, 지상/공중), 초반 5분 일꾼 수, 많이 뽑은 유닛 다섯. */}
      <div className="scr-stat-units-cell">
        {mix ? (
          <>
            <div className="scr-stat-mix">
              <DonutChart
                title="병력"
                size={DONUT}
                slices={[
                  { label: "기본", value: mix.uBasic },
                  { label: "고급", value: mix.uAdv },
                  { label: "마법", value: mix.uCaster },
                ]}
              />
              <DonutChart
                title="지형"
                size={DONUT}
                slices={[
                  { label: "지상", value: mix.uGround },
                  { label: "공중", value: mix.uAir },
                ]}
              />
            </div>
            {/* 일꾼은 비율이 아니라 그냥 수다(요청) — 5분 동안 몇 기 뽑았나. 도넛과 나란히
                가로로 서므로(요청) 이름과 수를 위아래로 포개 도넛 한 칸만큼의 폭만 쓴다. */}
            <div className="scr-stat-worker5">
              <span className="scr-stat-worker5-label">5분 일꾼</span>
              <span className="scr-stat-worker5-n">{stats.avgWorker5 ?? "-"}</span>
            </div>
            <TopList items={topEntries(mix.units, UNIT_KO, TOP_N)} unit="기" />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      {/* 스킬 — 공/방/실드 단계와 많이 쓴 마법 다섯. */}
      <div className="scr-stat-skills-cell">
        {mix ? (
          <>
            <UpgradeGrid mix={mix} plays={stats.mixPlays} />
            <TopList items={topEntries(mix.skills, TECH_KO, TOP_N)} unit="회" />
          </>
        ) : (
          <span className="scr-stat-points-empty">-</span>
        )}
      </div>
      <div className="scr-stat-apm-cell">
        <ValueBar value={stats.avgApm} maxValue={maxApm} medal={medals?.apm} />
      </div>
      <div className="scr-stat-cmd-cell">
        <ValueBar value={stats.avgCmd} maxValue={maxCmd} medal={medals?.cmd} />
      </div>
      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}
