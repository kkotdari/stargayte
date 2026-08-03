import { useState } from "react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import StatBar from "../../components/common/StatBar";
import ValueBar from "../../components/common/ValueBar";
import DonutChart from "../../components/common/DonutChart";
import { useAppStore } from "../../store/appStore";
import type { Member, MemberStats } from "../../types";

/** 이미 끝난 기간에서 각 칸의 1·2·3위에 붙는 메달(요청) — 칸 이름 → 이모지. 값이 없는
 *  칸(표본 미달로 "-"인 곳)은 애초에 순위에서 빠지므로 키 자체가 없다. */
export type StatColumnMedals = Partial<Record<
  "points" | "plays" | "rate" | "build" | "apm" | "cmd", string
>>;

interface MemberStatRowProps {
  member: Member;
  stats: MemberStats;
  // 게임수 칸(ValueBar)의 기준값(이 목록에서 가장 많이 뛴 사람 = 100%).
  maxOverallPlays: number;
  // 생산/APM/커맨드 막대의 기준값(이 목록에서 가장 높은 값) — 게임수 막대와 같은 원칙.
  maxBuild: number;
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
  member, stats, maxOverallPlays, maxBuild, maxApm, maxCmd, avatar = true, compact = false,
  points, rank, rankDelta, onPointsClick, onRankClick, medals,
}: MemberStatRowProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const [photoOpen, setPhotoOpen] = useState(false);

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
      {/* 랭크와 포인트는 각자의 컬럼이다(요청: 분리) — 예전엔 "1,234 (3위▲2)"처럼 한 칸에
          담았는데, 무엇으로 정렬해 보고 있는지가 안 읽히고 둘 중 하나만 눌러야 하는 자리
          (랭크=순위변동, 포인트=경기 이력)를 한 칸에 겹쳐 두게 됐다. */}
      {points !== undefined && (
        <>
          <div className="scr-stat-rank-cell">
            {rank == null ? (
              <span className="scr-stat-points-empty">-</span>
            ) : (
              <>
                {onRankClick ? (
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
              </>
            )}
          </div>
          <div className="scr-stat-points-cell">
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
      <div className="scr-stat-plays-cell">
        <ValueBar value={stats.plays > 0 ? stats.plays : null} maxValue={maxOverallPlays} medal={medals?.plays} />
      </div>
      <div className="scr-stat-bar-cell">
        <StatBar plays={stats.plays} wins={stats.wins} draws={stats.draws} losses={stats.losses} winRate={stats.winRate} compact={compact} medal={medals?.rate} />
      </div>
      <div className="scr-stat-build-cell">
        <ValueBar value={stats.avgBuild} maxValue={maxBuild} medal={medals?.build} />
        {/* 총량 옆에 '무엇으로 그 총량이 됐나'를 함께 놓는다(요청: 도넛 셋 + 초반 일꾼).
            구성이 실린 경기가 하나도 없거나 표본이 모자라면 이 아래는 통째로 안 그린다 —
            빈 도넛 셋이 서 있는 것보다 총량만 있는 편이 정직하다. */}
        {stats.buildMix && (
          <div className="scr-stat-mix">
            <DonutChart
              title="건물"
              slices={[
                { label: "생산", value: stats.buildMix.bProd },
                { label: "방어", value: stats.buildMix.bDef },
              ]}
            />
            <DonutChart
              title="병력"
              slices={[
                { label: "기본", value: stats.buildMix.uBasic },
                { label: "고급", value: stats.buildMix.uAdv },
                { label: "마법", value: stats.buildMix.uCaster },
              ]}
            />
            <DonutChart
              title="지형"
              slices={[
                { label: "지상", value: stats.buildMix.uGround },
                { label: "공중", value: stats.buildMix.uAir },
              ]}
            />
          </div>
        )}
        {stats.avgWorker5 !== null && (
          <span className="scr-stat-worker5">초반 일꾼 {stats.avgWorker5}</span>
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
