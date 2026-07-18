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
  // 랭킹 상세 이력 전용 — 홈팀(team1=주인공, 호출부에서 항상 team1로 정렬해 넘긴다)은 아예
  // 빼고 "VS 상대 팀구성 + 승/패"만 한 줄로 보여준다(요청: "아예 홈팀을 빼고 vs 팀구성 승패
  // ... 진짜 결과만 나오는 느낌"). 승/패는 주인공(team1) 기준.
  opponentOnly?: boolean;
  // opponentOnly 이력에서 승/패 라벨 옆에 덧붙이는 문구 — 랭킹 상세의 "이 경기에서 얻은
  // 점수"(요청: "승무패 옆에 각 경기당 획득 점수 표시")를 담는다.
  outcomeNote?: string;
  // 회원 id → 이름 옆 작은 라벨(팀전 이력의 "이 상대에게 얻은 점수" — 요청). 맵에 든 회원만.
  pointsByMember?: Map<string, string>;
  // 랭킹 상세 경기 이력 전용 — 프사 없이 "닉네임 + 종족(텍스트)"만, 양 팀 모두 같은 순서로
  // 보여준다(요청: "프사 제거, 닉네임과 종족배지(텍스트)만, 팀전은 좌우 팀 모두 닉네임 종족 순").
  textRoster?: boolean;
  // 랭킹 상세 팀전 이력 전용 — 개인전 카드처럼 "로스터 VS 로스터 → 결과(승/패) → 점수" 순으로
  // 한 줄에 흘려 보여준다(요청). 승/패를 가운데 VS 칸에 쌓지 않고 오른쪽 끝(결과+점수)에 둔다.
  bothTeamsTail?: boolean;
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
  // 회원 id → 그 회원 옆에 붙일 작은 라벨(랭킹 상세 팀전 이력의 "이 상대에게 얻은 점수").
  // 맵에 든 회원(=상대팀 각 구성원)만 이름 옆에 라벨이 붙는다.
  pointsByMember?: Map<string, string>;
  // 프사 없이 "닉네임 + 종족(텍스트)"만 보여주는 랭킹 상세 이력 전용 모드.
  textRoster?: boolean;
}

// 팀 명단 — 한 행에 [프로필(사진+아이디)] · [종족]을 나란히 붙여서 표시한다(별도 컬럼으로
// 줄 맞추지 않음). 승/무/패 표시는 로스터 바깥쪽(VS와 먼 쪽)에 나란히 붙어서, 세로로는
// 로스터 전체 높이의 중앙(인원이 1명이면 그 프로필 사진과 같은 줄)에 오도록 정렬한다.
function TeamRoster({ side, players, memberOf, outcome, highlightMemberIds, disableProfileLink, stackedOutcome, compact, pointsByMember, textRoster }: TeamRosterProps) {
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  // v2 결과 카드(compact)의 프사도 20% 키워서(18px -> 22px, 소수점 반올림) 기본 크기와
  // 같아졌다 — 종족은 이제 프사 옆 별도 칸이 아니라 프사 아래쪽에 작게 걸치는 배지로 표시한다.
  const avatarSize = 22;
  const raceSize = compact ? 12 : 15;

  return (
    <div className={cx("scr-team-block", `scr-team-block-${side}`)}>
      <div className={cx("scr-team-roster", `scr-team-roster-${side}`, textRoster && "scr-team-roster-text")}>
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
          // textRoster 모드에선 프사를 아예 빼고 "닉네임 + 종족(텍스트)"만 한 줄로 보여준다.
          const profileContent = textRoster ? (
            <>
              <span className="scr-team-name">{name}</span>
              <RaceBadge race={p.race} asText />
            </>
          ) : (
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
          const pointsLabel = pointsByMember?.get(p.memberId);
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
              {/* 이 상대에게 얻은 점수(팀전 이력) — 이름 옆에 작게. */}
              {pointsLabel && <span className="scr-team-player-points">{pointsLabel}</span>}
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
  team1, team2, memberOf, result, highlightMemberIds, disableProfileLink, stackedOutcome, compact, opponentOnly,
  outcomeNote, pointsByMember, textRoster, bothTeamsTail,
}: MatchTeamsProps) {
  const outcome1 = outcomeFor("team1", result);
  const outcome2 = outcomeFor("team2", result);
  // 팀전 이력 — "우리 로스터 VS 상대 로스터" 뒤 오른쪽에 [승/패] 그리고 그 다음(더 오른쪽)에
  // 상대 각 구성원에게 얻은 개별 원점수 컬럼을 둔다(요청: "승패는 상대팀 우측에 고정", "승패
  // 다음에 오른쪽에 개별 점수"). 개별 점수는 상대(team2) 각 행과 세로로 나란히 맞춘다. 양 팀
  // 모두 아바타→닉네임 순. 최종 합계 계산은 호출부가 카드 아래 로우에 그린다.
  if (bothTeamsTail) {
    // "VS" 대신 "[우리 팀]로 [상대 팀]에 승/패"로 문장처럼 표현한다(요청). 로스터는 고정폭
    // (양 팀 flex 균등)이라 카드마다 '로/에/승패' 세로줄이 일치한다.
    return (
      <div className="scr-match-row scr-match-row-result-only scr-match-row-team-tail">
        <TeamRoster
          side="team1" players={team1} memberOf={memberOf} outcome={outcome1}
          highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink}
          stackedOutcome compact={compact} textRoster={textRoster}
        />
        <span className="scr-match-conn">팀으로</span>
        <TeamRoster
          side="team2" players={team2} memberOf={memberOf} outcome={outcome2}
          highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink}
          stackedOutcome compact={compact} textRoster={textRoster}
        />
        <span className="scr-match-result-tail">
          <span className="scr-match-conn">팀에</span>
          <span className={cx("scr-team-outcome", "scr-team-outcome-result", OUTCOME_CLASS[outcome1])}>{OUTCOME_LABEL[outcome1]}</span>
        </span>
        {pointsByMember && (
          <div className="scr-team-points-col">
            {team2.map((p) => (
              <span key={p.memberId} className="scr-team-points-row">{pointsByMember.get(p.memberId) ?? ""}</span>
            ))}
          </div>
        )}
      </div>
    );
  }
  // 홈팀(주인공) 없이 "[상대]에 승/패 + 점수"만 — 결과 위주로 훑는 랭킹 상세 이력용(요청: VS 제거).
  if (opponentOnly) {
    return (
      <div className="scr-match-row scr-match-row-result-only">
        <TeamRoster
          side="team2" players={team2} memberOf={memberOf} outcome={outcome2}
          highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink}
          stackedOutcome compact={compact} textRoster={textRoster}
        />
        <span className="scr-match-result-tail">
          <span className="scr-match-conn">에</span>
          <span className={cx("scr-team-outcome", "scr-team-outcome-result", OUTCOME_CLASS[outcome1])}>{OUTCOME_LABEL[outcome1]}</span>
          {/* 이 경기에서 얻은 점수(요청) — 승/패 라벨 바로 옆(또는 아래)에 작게 병기한다. */}
          {outcomeNote && <span className="scr-match-result-points">{outcomeNote}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="scr-match-row">
      <TeamRoster side="team1" players={team1} memberOf={memberOf} outcome={outcome1} highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink} stackedOutcome={stackedOutcome} compact={compact} pointsByMember={pointsByMember} textRoster={textRoster} />
      {stackedOutcome ? (
        <div className="scr-match-vs-col">
          <span className={cx("scr-team-outcome", "scr-team-outcome-stacked", OUTCOME_CLASS[outcome1])}>{OUTCOME_LABEL[outcome1]}</span>
          <span className="scr-list-vs">VS</span>
          <span className={cx("scr-team-outcome", "scr-team-outcome-stacked", OUTCOME_CLASS[outcome2])}>{OUTCOME_LABEL[outcome2]}</span>
        </div>
      ) : (
        <span className="scr-list-vs">VS</span>
      )}
      <TeamRoster side="team2" players={team2} memberOf={memberOf} outcome={outcome2} highlightMemberIds={highlightMemberIds} disableProfileLink={disableProfileLink} stackedOutcome={stackedOutcome} compact={compact} pointsByMember={pointsByMember} textRoster={textRoster} />
    </div>
  );
}
