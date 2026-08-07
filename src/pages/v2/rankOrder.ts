import type { MemberStatsEntry } from "../../types";

/** 그 조건(기간·분류·종족)에서 몇 위인가 — 서버가 매긴 자리번호(sortOrder)로 줄을 세우고
 *  완전 동률(tieGroup)은 공동순위(1,1,3)로 묶는다.
 *
 *  백엔드가 랭크 변동 스냅샷의 순위표를 만들 때 쓰는 규칙(feed/service.py의
 *  _compute_standings)과 같은 계산이다 — 그래서 통계표의 순위와 활동 카드의 순위가
 *  어긋나지 않는다.
 *
 *  통계 화면과 순위변동 모달이 함께 쓴다. 예전에는 화면 안에 이 함수가 있었는데, 모달이
 *  달마다 같은 계산을 다시 해야 해서 밖으로 뺐다 — 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 *
 *  레이팅이 있는 사람만 줄을 선다 — '그 기간에 뛰었나'가 아니라 '그때까지 한 판이라도
 *  뛰었나'다(요청: 월을 골라도 레이팅과 랭킹은 그 월 당시의 값이 나와야 한다). 그 판정은
 *  서버가 이미 rankScore로 내려준다: 한 판도 안 뛴 사람만 null이다. 예전에는 여기서
 *  '고른 기간의 경기 수'로 다시 걸렀는데, 그러면 그 달에 쉰 사람이 순위표에서 통째로
 *  빠져 남은 사람끼리 다시 매긴 다른 표가 됐다. */
export function rankOf(
  byMember: Record<string, MemberStatsEntry>,
  memberIds: string[],
): Map<string, number> {
  const ranked = memberIds
    .map((id) => byMember[id])
    .filter((e): e is MemberStatsEntry => !!e && e.sortOrder != null && e.tieGroup != null)
    .filter((e) => e.rankScore != null)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out = new Map<string, number>();
  let rank = 0;
  ranked.forEach((e, i) => {
    if (i === 0 || e.tieGroup !== ranked[i - 1].tieGroup) rank = i + 1;
    out.set(e.memberId, rank);
  });
  return out;
}
