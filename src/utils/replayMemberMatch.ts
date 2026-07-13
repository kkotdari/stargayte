// 리플레이에서 뽑아낸 플레이어 원본 이름을 회원과 매칭한다. 실제로 배포해서 확인해보니
// SC:Remastered 리플레이엔 배틀태그 전체("닉네임#1234")가 아니라 게임 내 표시 이름(예전
// Battle.net 계정명 등, battletag와 전혀 무관할 수 있음)이 저장돼 있었다. 그래서 회원이
// 직접 등록해둔 replayAliases(최대 3개)를 최우선으로 보고, 혹시 몰라 battletag(전체/"#"
// 앞부분)와 닉네임도 보조로 시도한다. 그래도 못 찾으면 매칭 실패로 두고 화면에서 직접
// 골라 배정한다.
import type { Member } from "../types";

function battletagName(battletag: string): string {
  const hashIdx = battletag.indexOf("#");
  return (hashIdx === -1 ? battletag : battletag.slice(0, hashIdx)).trim().toLowerCase();
}

export function matchReplayPlayerToMember(rawName: string, members: Member[]): Member | undefined {
  const q = rawName.trim().toLowerCase();
  if (!q) return undefined;
  return (
    members.find((m) => m.replayAliases.some((a) => a.trim().toLowerCase() === q)) ??
    members.find((m) => battletagName(m.battletag) === q) ??
    members.find((m) => m.battletag.trim().toLowerCase() === q) ??
    members.find((m) => m.nickname.trim().toLowerCase() === q)
  );
}
