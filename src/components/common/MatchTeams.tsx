import { Monitor, UserPlus } from "lucide-react";
import Avatar from "./Avatar";
import RaceBadge from "./RaceBadge";
import { cx } from "../../utils/format";
import { useAppStore } from "../../store/appStore";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import type { Member, MatchSlot, MatchResult } from "../../types";

interface MatchTeamsProps {
  team1: MatchSlot[];
  team2: MatchSlot[];
  memberOf: (id: string) => Member | undefined;
  result: MatchResult;
  // 유저 검색 중이면 그 회원(들)을 로스터에서 하이라이트 표시한다
  highlightMemberIds?: Set<string>;
  // 경기결과 "목록" 카드에서는 닉네임을 눌러도 프로필 팝업이 뜨지 않게 한다(카드 자체를
  // 눌러 상세를 이미 열 수 있어 중복 진입점이라 혼란스러움) — 상세 팝업에서는 그대로 둔다.
  disableProfileLink?: boolean;
  // v2 결과 카드 전용 — 승/무/패 표시를 로스터 바깥쪽(VS와 먼 쪽)이 아니라 VS 옆에
  // 가로로 붙여 보여준다(팀1 결과 - VS - 팀2 결과 한 줄). 기본(false)은 예전 그대로 로스터 바깥쪽.
  stackedOutcome?: boolean;
  // v2 결과 카드 전용 — 프사/종족 아이콘을 더 작게(카드가 컴팩트해서). 기본(false)은 기존 크기.
  compact?: boolean;
}

type Outcome = "win" | "loss" | "draw" | "notHeld";

function outcomeFor(side: "team1" | "team2", result: MatchResult): Outcome {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}

const OUTCOME_LABEL: Record<Outcome, string> = { win: "승", loss: "패", draw: "무", notHeld: "미실시" };
const OUTCOME_CLASS: Record<Outcome, string> = { win: "scr-win", loss: "scr-loss", draw: "scr-draw", notHeld: "scr-draw" };

interface TeamRosterProps {
  side: "team1" | "team2";
  players: MatchSlot[];
  memberOf: (id: string) => Member | undefined;
  outcome: Outcome;
  highlightMemberIds?: Set<string>;
  disableProfileLink?: boolean;
  // true면 이 컴포넌트는 승/무/패 표시를 그리지 않는다 — MatchTeams가 VS 옆에 따로 그린다.
  stackedOutcome?: boolean;
  compact?: boolean;
}

// 팀 명단 — 한 행에 [프로필(사진+아이디)] · [종족]을 나란히 붙여서 표시한다(별도 컬럼으로
// 줄 맞추지 않음). 승/무/패 표시는 로스터 바깥쪽(VS와 먼 쪽)에 나란히 붙어서, 세로로는
// 로스터 전체 높이의 중앙(인원이 1명이면 그 프로필 사진과 같은 줄)에 오도록 정렬한다.
function TeamRoster({ side, players, memberOf, outcome, highlightMemberIds, disableProfileLink, stackedOutcome, compact }: TeamRosterProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  // v2 결과 카드(compact)의 프사도 20% 키워서(18px -> 22px, 소수점 반올림) 기본 크기와
  // 같아졌다 — 종족은 이제 프사 옆 별도 칸이 아니라 프사 아래쪽에 작게 걸치는 배지로 표시한다.
  const avatarSize = 22;
  const raceSize = compact ? 12 : 15;

  return (
    <div className={cx("scr-team-block", `scr-team-block-${side}`)}>
      <div className={cx("scr-team-roster", `scr-team-roster-${side}`)}>
        {players.map((p) => {
          const isComputer = isComputerSlot(p.memberId);
          const isUnregistered = isUnregisteredSlot(p.memberId);
          const m = isComputer || isUnregistered ? undefined : memberOf(p.memberId);
          const highlighted = highlightMemberIds?.has(p.memberId);
          // 리플레이 원본 이름(rawName)이 저장돼 있으면 "컴퓨터 N"/"비회원 N" 같은 순번
          // 라벨 대신 그대로 보여준다 — 수동 등록 등으로 rawName이 없는 경우에만 순번으로 대체.
          const name = isComputer
            ? (p.rawName || computerSlotLabel(players, p.memberId))
            : isUnregistered
              ? (p.rawName || unregisteredSlotLabel(players, p.memberId))
              : (m?.nickname ?? p.memberId);
          // 종족 배지를 이름 옆 별도 칸이 아니라 프사 아래쪽에 걸쳐서 보여준다(팀1/팀2가
          // 서로 대칭되도록, VS와 가까운 안쪽 모서리에 걸친다 — 두 팀 아바타가 서로 마주보듯).
          const profileContent = (
            <>
              <span className="scr-team-avatar-wrap">
                {isComputer
                  ? <Avatar icon={<Monitor size={16} className="scr-chip-computer-icon" />} size={avatarSize} />
                  : isUnregistered
                    ? <Avatar icon={<UserPlus size={16} className="scr-chip-computer-icon" />} size={avatarSize} />
                    : <Avatar member={m} size={avatarSize} />}
                <RaceBadge
                  race={p.race} size={raceSize} circleLetter
                  className={cx("scr-team-avatar-race", `scr-team-avatar-race-${side}`)}
                />
              </span>
              <span className="scr-team-name">{name}</span>
            </>
          );
          return (
            <div key={p.memberId} className={cx("scr-team-player", highlighted && "scr-team-player-highlight")}>
              {disableProfileLink || isComputer || isUnregistered ? (
                <span className="scr-team-profile">{profileContent}</span>
              ) : (
                <button
                  type="button"
                  className="scr-team-profile scr-team-profile-btn"
                  // 이 컴포넌트가 카드 전체를 감싸는 클릭 영역 안에 놓일 수 있어, 카드 자체의
                  // 클릭(예: 상세보기 열기)으로 이벤트가 번지지 않게 막는다.
                  onClick={(e) => { e.stopPropagation(); openMemberProfile(p.memberId); }}
                >
                  {profileContent}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!stackedOutcome && (
        <div className={cx("scr-team-outcome", `scr-team-outcome-${side}`, OUTCOME_CLASS[outcome])}>{OUTCOME_LABEL[outcome]}</div>
      )}
    </div>
  );
}

// 경기 하나의 팀1 vs 팀2 표시. 검색 기준(누구를 찾았는지)과 무관하게 팀1은 항상 왼쪽,
// 팀2는 항상 오른쪽에 고정된다. VS는 승/무/패 표시를 제외한 명단 영역만의 수직 중앙에 온다
// (stackedOutcome이면 대신 VS 위아래에 승/무/패가 붙는다).
export default function MatchTeams({
  team1, team2, memberOf, result, highlightMemberIds, disableProfileLink, stackedOutcome, compact,
}: MatchTeamsProps) {
  const outcome1 = outcomeFor("team1", result);
  const outcome2 = outcomeFor("team2", result);
  return (
    <div className="scr-match-row">
      <TeamRoster side="team1" players={team1} memberOf={memberOf} outcome={outcome1} highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink} stackedOutcome={stackedOutcome} compact={compact} />
      {stackedOutcome ? (
        <div className="scr-match-vs-col">
          <span className={cx("scr-team-outcome", "scr-team-outcome-stacked", OUTCOME_CLASS[outcome1])}>{OUTCOME_LABEL[outcome1]}</span>
          <span className="scr-list-vs">VS</span>
          <span className={cx("scr-team-outcome", "scr-team-outcome-stacked", OUTCOME_CLASS[outcome2])}>{OUTCOME_LABEL[outcome2]}</span>
        </div>
      ) : (
        <span className="scr-list-vs">VS</span>
      )}
      <TeamRoster side="team2" players={team2} memberOf={memberOf} outcome={outcome2} highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink} stackedOutcome={stackedOutcome} compact={compact} />
    </div>
  );
}
