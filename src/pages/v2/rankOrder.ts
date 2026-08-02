import type { MemberStatsEntry } from "../../types";

/** 그 조건(기간·분류·종족)에서 몇 위인가 — 서버가 매긴 자리번호(sortOrder)로 줄을 세우고
 *  완전 동률(tieGroup)은 공동순위(1,1,3)로 묶는다.
 *
 *  백엔드가 랭크 변동 스냅샷의 순위표를 만들 때 쓰는 규칙(feed/service.py의
 *  _compute_standings)과 같은 계산이다 — 그래서 통계표의 순위와 피드 카드의 순위가
 *  어긋나지 않는다.
 *
 *  통계 화면과 순위변동 모달이 함께 쓴다. 예전에는 화면 안에 이 함수가 있었는데, 모달이
 *  달마다 같은 계산을 다시 해야 해서 밖으로 뺐다 — 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 *
 *  한 판도 안 뛴 사람은 순위에서 빠진다(0경기와 0점은 다른 말이다). */
export function rankOf(
  byMember: Record<string, MemberStatsEntry>,
  memberIds: string[],
): Map<string, number> {
  const ranked = memberIds
    .map((id) => byMember[id])
    .filter((e): e is MemberStatsEntry => !!e && e.sortOrder != null && e.tieGroup != null)
    .filter((e) => e.overall.plays > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out = new Map<string, number>();
  let rank = 0;
  ranked.forEach((e, i) => {
    if (i === 0 || e.tieGroup !== ranked[i - 1].tieGroup) rank = i + 1;
    out.set(e.memberId, rank);
  });
  return out;
}
