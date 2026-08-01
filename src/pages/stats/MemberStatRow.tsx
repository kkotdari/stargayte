import { useState } from "react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import StatBar from "../../components/common/StatBar";
import ValueBar from "../../components/common/ValueBar";
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
  // 표본이 너무 적어(최소 게임수 미달) 승률/APM 등이 왜곡될 수 있는 회원은 게임수 칸만
  // 실제 값을 보여주고 나머지(전적/승률/APM/커맨드/포인트/순위)는 "-"로 가린다(지적:
  // 미충족 시 경기수 제외한 필드는 모두 null 처리).
  belowMinPlays?: boolean;
  // 랭크 포인트(TrueSkill 보수추정, 표시 스케일) — undefined면 포인트 컬럼 자체를 안 그린다
  // (통계 화면 전용, 요청: 랭킹을 통계에 통합). null이면 이 기간 순위 대상이 아니라 "-".
  points?: number | null;
  // 지금 몇 위인가(공동순위 포함) — 포인트 옆에 함께 보여준다(요청). 순위 대상이 아니면 null.
  rank?: number | null;
  // 직전 순위표 대비 몇 계단 움직였나(+면 상승) — 최근 순위 변동 스냅샷에서 온다.
  // 그 스냅샷은 '이번 달' 기준으로만 계산되므로, 다른 기간을 보고 있으면 호출부가 안 넘긴다.
  rankDelta?: number | null;
  // 포인트를 누르면 포인트 상세(경기 이력)를 연다.
  onPointsClick?: () => void;
  // 지난 기간을 볼 때만 온다 — 아직 안 끝난 달에는 메달을 안 단다(StatsScreen 참고).
  medals?: StatColumnMedals;
}

// 전적통계 목록의 테이블 한 행.
export default function MemberStatRow({
  member, stats, maxOverallPlays, maxBuild, maxApm, maxCmd, avatar = true, compact = false, belowMinPlays = false,
  points, rank, rankDelta, onPointsClick, medals,
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
      {points !== undefined && (() => {
        // 최소 판수 미달이면 게임수를 뺀 나머지는 전부 가린다(지적: 미충족 시 경기수 제외한
        // 필드는 모두 null 처리) — 포인트·순위는 백엔드가 내려주는 값인데, 백엔드의 최소
        // 판수 기준이 이 프론트와 어긋나 있을 수 있어(StatsScreen의 MIN_PLAYS_BY_TYPE
        // 주석) 여기서 한 번 더 가린다. 그래야 백엔드가 아직 옛 기준을 쓰고 있어도 화면은
        // 항상 지금 기준을 따른다.
        // points가 여기서 number | null로 좁혀지므로(위 가드), shownPoints도 undefined
        // 없이 number | null로 잡힌다 — 가드 밖에서 미리 계산하면 그 좁힘이 안 먹는다.
        const shownPoints = belowMinPlays ? null : points;
        const shownRank = belowMinPlays ? null : rank;
        const shownRankDelta = belowMinPlays ? null : rankDelta;
        return (
        <div className="scr-stat-points-cell">
          {shownPoints === null ? (
            <span className="scr-stat-points-empty">-</span>
          ) : (
            <>
              <button
                type="button" className="scr-stat-points-btn"
                onClick={onPointsClick} aria-label={`${member.nickname} 포인트 상세`}
              >
                {shownPoints.toLocaleString()}
              </button>
              {medals?.points && <span className="scr-stat-medal">{medals.points}</span>}
              {/* 포인트 옆에 지금 순위와 그 변동(요청) — 포인트만으로는 그게 몇 등짜리
                  점수인지 감이 안 온다. 변동은 방향이 곧 의미라 색과 화살표로만 짧게. */}
              {shownRank != null && (
                <span className="scr-stat-points-rank">
                  ({shownRank}위
                  {shownRankDelta != null && shownRankDelta !== 0 && (
                    <span className={shownRankDelta > 0 ? "scr-feed-shift-up" : "scr-feed-shift-down"}>
                      {shownRankDelta > 0 ? `▲${shownRankDelta}` : `▼${-shownRankDelta}`}
                    </span>
                  )}
                  )
                </span>
              )}
            </>
          )}
        </div>
        );
      })()}
      <div className="scr-stat-plays-cell">
        <ValueBar value={stats.plays > 0 ? stats.plays : null} maxValue={maxOverallPlays} medal={medals?.plays} />
      </div>
      <div className="scr-stat-bar-cell">
        <StatBar plays={belowMinPlays ? 0 : stats.plays} wins={stats.wins} draws={stats.draws} losses={stats.losses} winRate={stats.winRate} compact={compact} medal={medals?.rate} />
      </div>
      <div className="scr-stat-build-cell">
        <ValueBar value={belowMinPlays ? null : stats.avgBuild} maxValue={maxBuild} medal={medals?.build} />
      </div>
      <div className="scr-stat-apm-cell">
        <ValueBar value={belowMinPlays ? null : stats.avgApm} maxValue={maxApm} medal={medals?.apm} />
      </div>
      <div className="scr-stat-cmd-cell">
        <ValueBar value={belowMinPlays ? null : stats.avgCmd} maxValue={maxCmd} medal={medals?.cmd} />
      </div>
      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}
