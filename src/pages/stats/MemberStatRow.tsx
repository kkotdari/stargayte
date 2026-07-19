import { useState } from "react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import StatBar from "../../components/common/StatBar";
import ValueBar from "../../components/common/ValueBar";
import { useAppStore } from "../../store/appStore";
import type { Member, MemberStats } from "../../types";

interface MemberStatRowProps {
  member: Member;
  stats: MemberStats;
  // 게임수 칸(ValueBar)의 기준값(이 목록에서 가장 많이 뛴 사람 = 100%).
  maxOverallPlays: number;
  // 유효APM/유효커맨드 막대의 기준값(이 목록에서 가장 높은 값) — 게임수 막대와 같은 원칙.
  maxEapm: number;
  maxEcmd: number;
  // false면 프사를 아예 그리지 않는다 — 닉네임 버튼을 눌러도 프로필은 그대로 열린다.
  avatar?: boolean;
  // 전적 막대 캡션을 "승/전" 짧은 표기로 줄인다(StatBar의 compact 참고).
  compact?: boolean;
  // 표본이 너무 적어(최소 게임수 미달) 승률/APM 등이 왜곡될 수 있는 회원은 게임수 칸만
  // 실제 값을 보여주고 나머지(전적/승률/APM/커맨드)는 "-"로 가린다.
  belowMinPlays?: boolean;
}

// 전적통계 목록의 테이블 한 행.
export default function MemberStatRow({
  member, stats, maxOverallPlays, maxEapm, maxEcmd, avatar = true, compact = false, belowMinPlays = false,
}: MemberStatRowProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const [photoOpen, setPhotoOpen] = useState(false);

  return (
    <div className="scr-stat-row">
      <div className="scr-stat-name-cell">
        {avatar && (
          <button type="button" className="scr-stat-avatar-btn" onClick={() => setPhotoOpen(true)} aria-label={`${member.nickname} 사진 보기`}>
            <Avatar member={member} size={40} />
          </button>
        )}
        <div className="scr-stat-name-stack">
          <button type="button" className="scr-stat-name-btn" onClick={() => openMemberProfile(member.id)}>
            {member.nickname}
          </button>
          <span className="scr-stat-tag-pill">{member.battletag}</span>
        </div>
      </div>
      <div className="scr-stat-plays-cell">
        <ValueBar value={stats.plays > 0 ? stats.plays : null} maxValue={maxOverallPlays} />
      </div>
      <div className="scr-stat-bar-cell">
        <StatBar plays={belowMinPlays ? 0 : stats.plays} wins={stats.wins} draws={stats.draws} losses={stats.losses} winRate={stats.winRate} compact={compact} />
      </div>
      <div className="scr-stat-eapm-cell">
        <ValueBar value={belowMinPlays ? null : stats.avgEapm} maxValue={maxEapm} />
      </div>
      <div className="scr-stat-ecmd-cell">
        <ValueBar value={belowMinPlays ? null : stats.avgEcmd} maxValue={maxEcmd} />
      </div>
      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}
