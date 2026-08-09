import { Monitor, User } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import RaceBadge from "../../components/common/RaceBadge";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import type { Member, GameResultSlot, GameOutcome } from "../../types";

// 경기 한 판의 '양 편'을 읽고 그리는 것들 — 참가자 이름 규칙, 승패를 편 기준으로 뒤집는 것,
// 그리고 팀 로스터. 카드 본문(GameResultCardBody)과 미니맵 이야기(GameResultStory)가
// 함께 쓴다.

export type Outcome = "win" | "loss" | "draw" | "notHeld";

/** 그 편에서 본 승패 — 저장된 값은 "team1이 이겼다"는 절대 표현이라, 편을 주어로 말하려면
 *  뒤집어야 한다. */
export function outcomeFor(side: "team1" | "team2", result: GameOutcome): Outcome {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}

/** 접힌 상태 요약 줄과 카톡 공유에 쓰는 "누구 외 N명" — 팀원이 하나뿐이면 그 이름만. */
export function teamSummaryName(team: GameResultSlot[], memberOf: (id: string) => Member | undefined): string {
  if (team.length === 0) return "";
  const first = resolveSlotName(team[0], team, memberOf);
  return team.length > 1 ? `${first} 외 ${team.length - 1}명` : first;
}

// 게임결과 카드의 팀 로스터.
//
// 지금은 미니맵이 이 역할을 대신하므로 기본으로는 안 보인다(GameResultStory의 SHOW_ROSTER
// 참고) — 카드가 너무 길어졌고, 누가 어느 편인지는 미니맵의 색이 말해 준다(요청). 지우지
// 않고 그대로 둔 이유는 다시 필요할 수 있어서고(요청), 미니맵을 못 그리는 경기(옛 경기,
// 맵 정보를 못 읽은 리플레이)에서는 지금도 이쪽이 유일한 로스터다.

// 컴퓨터/비회원 여부에 따라 표시 이름을 정한다 — 로스터와 접힌 상태의 팀 요약("누구 외
// N명"), 미니맵의 본진 표시가 같은 이름 규칙을 쓰도록 공용으로 뺐다.
export function resolveSlotName(slot: GameResultSlot, players: GameResultSlot[], memberOf: (id: string) => Member | undefined): string {
  const isComputer = isComputerSlot(slot.memberId);
  const isUnreg = isUnregisteredSlot(slot.memberId);
  const m = isComputer || isUnreg ? undefined : memberOf(slot.memberId);
  return isComputer
    ? (slot.rawName || computerSlotLabel(players, slot.memberId))
    : isUnreg
      ? (slot.rawName || unregisteredSlotLabel(players, slot.memberId))
      : (m?.nickname ?? slot.memberId);
}

// 매치업 한 편(활동 전용) — 공용 로스터 CSS(scr-roster-*)로
// 세로 나열한다(요청: "게임결과의 팀로스터와 너 나와의 팀로스터를 맞출거야"). 프사를
// 더하고, 종족 배지는 닉네임 오른쪽(기존 규칙 유지). 컴퓨터/비회원은 작은 아이콘으로 구분.
export default function RosterSide({
  team, memberOf, highlightMemberIds, highlightTerms, mvpRaw,
}: {
  team: GameResultSlot[]; memberOf: (id: string) => Member | undefined;
  highlightMemberIds?: Set<string>; highlightTerms?: string[];
  /** 그 판 MVP의 원본 게임 아이디(요약의 mvp) — 그 사람 닉네임 뒤에 작은 배지를
   *  붙인다(요청). 닉네임이 아니라 원본 아이디로 가르는 이유는 같은 닉네임이 둘일 수
   *  있어서다. 팀전이 아니거나 옛 요약이면 안 넘어온다. */
  mvpRaw?: string;
}) {
  return (
    <div className="scr-roster-side">
      {team.map((s, i) => {
        const name = resolveSlotName(s, team, memberOf);
        const m = memberOf(s.memberId);
        const nameLc = normalizeSearchText(name);
        const hl = highlightMemberIds?.has(s.memberId) || !!highlightTerms?.some((t) => nameLc.includes(t));
        const isComputer = isComputerSlot(s.memberId);
        const isUnreg = isUnregisteredSlot(s.memberId);
        return (
          <div key={`${s.memberId}-${i}`} className="scr-roster-block">
            <div className="scr-roster-row">
              <span className={cx("scr-roster-person", hl && "scr-roster-hit")}>
                {/* 컴퓨터/비회원은 프사 자리에 아이콘 — 팀과 무관하게 항상 닉네임 왼쪽
                    (요청). 비회원은 사람 아이콘. */}
                {isComputer || isUnreg ? (
                  <span className="scr-matchup-slot-icon" aria-hidden>
                    {isComputer ? <Monitor size={14} /> : <User size={14} />}
                  </span>
                ) : (
                  <Avatar member={{ id: s.memberId, nickname: name, avatar: m?.avatar ?? null }} size={20} />
                )}
                <span className="scr-roster-name">{name}</span>
                {!!mvpRaw && s.rawName === mvpRaw && <span className="scr-mvp-mini">MVP</span>}
                <RaceBadge race={s.race} size={13} circleLetter className="scr-team-name-race" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
