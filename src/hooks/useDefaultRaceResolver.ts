import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Member, Race } from "../types";

// 팀에 회원을 추가할 때 종족 셀렉트의 기본값 — 프로필에 자기신고 "주종족" 필드가 있던
// 시절엔 그 값을 우선 썼지만, 필드 자체가 없어진 뒤로는 항상 실제 최다 플레이 종족(서버가
// 경기 기록에서 계산)만 쓴다. 매번 서버를 왕복하지 않도록, 모달이 열릴 때 후보 전체를
// 한 번에 조회해 캐시해둔다.
export function useDefaultRaceResolver(members: Member[]): (memberId: string) => Race | "" {
  const [byMember, setByMember] = useState<Record<string, Race>>({});

  useEffect(() => {
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return;
    let cancelled = false;
    api.getMatchStats({ memberIds: ids }).then((res) => {
      if (cancelled) return;
      const map: Record<string, Race> = {};
      res.members.forEach((entry) => {
        if (entry.mostPlayedRace) map[entry.memberId] = entry.mostPlayedRace;
      });
      setByMember(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (memberId: string) => byMember[memberId] ?? "";
}
