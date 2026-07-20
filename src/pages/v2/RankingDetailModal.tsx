import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import RankMatchHistory from "./RankMatchHistory";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { Match, MatchType, Member, Race } from "../../types";
import type { RankTrendPoint } from "./rank";

interface RankingDetailModalProps {
  members: Member[];
  // members가 여럿(팀)이면 이름을 이어붙여 보여준다.
  points: RankTrendPoint[] | null; // null이면 아직 불러오는 중.
  // 그래프 아래 경기 이력을 어떤 종류로 거를지 — 개인전이면 "0101"(그 회원의 1:1 경기),
  // 팀전이면 "0102"(팀경기).
  matchType: MatchType;
  // 지금 보고 있는 기간(월/연) — 경기 이력을 이 기간으로 좁혀, 어느 경기들에서 레이팅이
  // 움직였는지 그대로 훑을 수 있게 한다.
  period: { from: string; to: string };
  // 목록에 걸린 종족 필터 — "all"이 아니면 그 종족 레이팅 기준의 경기당 Δ만 병기한다.
  race: Race | "all";
  onClose: () => void;
}

const W = 300;
const H = 140;
// 그래프 안쪽 여백 — 선/점/라벨이 박스 가장자리에 붙지 않게 넉넉히 준다(요청: "그래프
// 내부 패딩 좀 주기"). viewBox 안쪽 값이라 박스 aspect-ratio는 그대로라 로딩→그래프 전환
// 때 높이가 안 흔들린다.
const PAD_X = 32;
// 순위 값 라벨(점 위 "N위" 텍스트)이 점보다 8px 위에 그려져서(아래 y={yFor(p.rank) - 8}),
// 위쪽 PAD_TOP을 아래 PAD_BOTTOM과 같은 숫자로 둬도 실제 눈에 보이는 여백은 그 8px만큼
// 아래쪽보다 좁아 보였다(요청: "윗쪽 패딩 아래랑 동일하게") — 그만큼 더 얹어 보정한다.
const PAD_TOP = 38;
const PAD_BOTTOM = 30;
// 그래프 아래 경기 이력 — "최근 한 경기"가 아니라 (일대일) 전체를 보여준다(요청: "최근 경기
// 이력말고 일대일 이력 다"). 그래도 아주 많은 경우를 위해 최근 100건까지만.
const HISTORY_LIMIT = 100;

// 랭킹 카드를 눌렀을 때 뜨는 상세 — 위엔 최근 5개 기간 순위변동 그래프, 아래엔 그 회원의
// 그 기간 경기 이력(경기마다 획득 점수 병기). 그 기간에 순위 대상이 아니었으면(한 판도 안
// 뛰었으면) rank가 null이라 그 지점은 선을 잇지 않고 건너뛴다.
export default function RankingDetailModal({
  members, points, matchType, period, race, onClose,
}: RankingDetailModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);
  const title = members.map((m) => m.nickname).join(", ");

  const known = (points ?? []).filter((p): p is { label: string; rank: number } => p.rank !== null);
  const minRank = known.length ? Math.min(...known.map((p) => p.rank)) : 1;
  const maxRank = known.length ? Math.max(...known.map((p) => p.rank)) : 1;
  const span = Math.max(1, maxRank - minRank);
  const xFor = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / Math.max(1, (points?.length ?? 1) - 1);
  // 순위는 숫자가 작을수록 좋은 성적이라, 위로 갈수록(y가 작을수록) 좋은 순위가 되도록 뒤집는다.
  const yFor = (rank: number) => PAD_TOP + ((rank - minRank) / span) * (H - PAD_TOP - PAD_BOTTOM);

  // 결측(그 기간 순위 없음)이 있어도 선은 알고 있는 지점끼리만 잇는다 — 없는 기간을 억지로
  // 보간하면 실제로 없던 순위가 있던 것처럼 보인다.
  const segments: { rank: number; i: number }[][] = [];
  (points ?? []).forEach((p, i) => {
    if (p.rank === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ rank: p.rank, i });
    else segments.push([{ rank: p.rank, i }]);
  });

  // 그래프 아래 경기 이력 — 이 회원(팀)이 뛴 경기를 서버에서 받아온다(teamMemberIds로 "그
  // 구성이 같은 편으로 뛴 경기"만 거른다). 일대일이면 matchType="0101".
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesErr, setMatchesErr] = useState("");
  const memberIdsKey = members.map((m) => m.id).join(",");

  const reload = useCallback(() => {
    let cancelled = false;
    setMatchesLoading(true);
    setMatchesErr("");
    // 이력을 지금 보고 있는 기간으로 좁힌다 — 아래에 병기하는 경기당 레이팅 변화(Δ)를 이
    // 기간의 경기들에 대해 보여준다. 정렬은 오래된 순(요청: "경기이력을 역순이 아닌
    // 정순으로") — 기본값(latest, 최신순)이 아니라 명시적으로 oldest를 지정한다.
    api.getMatchesPage({
      teamMemberIds: memberIdsKey.split(","), matchType, sort: "oldest",
      dateFrom: period.from, dateTo: period.to, limit: HISTORY_LIMIT,
    })
      .then((page) => { if (!cancelled) setMatches(page.items); })
      .catch((e) => { if (!cancelled) setMatchesErr(e instanceof Error ? e.message : "경기를 불러오지 못했어요."); })
      .finally(() => { if (!cancelled) setMatchesLoading(false); });
    return () => { cancelled = true; };
  }, [memberIdsKey, matchType, period.from, period.to]);

  useEffect(() => reload(), [reload]);

  // 경기당 레이팅 변화(Δμ) — 이 회원(상세 주인공)의 이 기간 경기에 대한 μ 증감을 matchNo로
  // 받아둔다. 목록이 조회 기간만으로 리셋해 매겨지므로 여기도 같은 period(from/to)로 좁혀
  // 받아야 위 목록의 μ/σ와 어긋나지 않는다. 팀 상세도 흐름상 주인공은 한 명(members[0])이다.
  const focalId = members[0]?.id;
  const [deltaByMatchNo, setDeltaByMatchNo] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    setDeltaByMatchNo(new Map());
    if (!focalId) return;
    api.getRatingHistory(focalId, matchType, period.from, period.to, race === "all" ? undefined : race)
      .then((res) => { if (!cancelled) setDeltaByMatchNo(new Map(Object.entries(res.deltas))); })
      .catch(() => { if (!cancelled) setDeltaByMatchNo(new Map()); });
    return () => { cancelled = true; };
  }, [focalId, matchType, period.from, period.to, race]);

  return createPortal(
    // 바깥(딤) 클릭으로는 안 닫는다 — 닫기는 헤더 X 버튼으로만(요청: "외부 영역 클릭시
    // 닫힘이 아니라 무반응"). 실수로 바깥을 눌러 그래프/이력을 다시 열어야 하는 번거로움 방지.
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-modal-rank-detail">
        <div className="scr-modal-head">
          <span>랭킹 상세</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          {/* 닉네임 옆에 프사 — 20px에서 1.5배(30px)로 키웠다가 더 키워 달라는 요청으로 40px. */}
          <div className="scr-rank-detail-who">
            <Avatar member={members[0]} size={40} />
            <div className="scr-rank-detail-who-text">
              <span className="scr-rank-detail-name">{title}</span>
            </div>
          </div>

          {/* 타이틀 "랭킹 상세" → 닉네임 → 소제목 "순위변동" → 그래프 → 소제목 "경기 이력" →
              목록 순서로 구성한다(요청). */}
          <div className="scr-rank-detail-section-head">순위변동</div>
          <div className="scr-rank-detail-chart-area">
            {points === null ? (
              <Spinner size={18} />
            ) : known.length === 0 ? (
              <div className="scr-empty">순위 기록이 없어요</div>
            ) : (
              <svg className="scr-rank-detail-chart" viewBox={`0 0 ${W} ${H}`}>
                {segments.map((seg, si) => (
                  <polyline
                    key={si}
                    className="scr-rank-detail-line"
                    points={seg.map((p) => `${xFor(p.i)},${yFor(p.rank)}`).join(" ")}
                  />
                ))}
                {points.map((p, i) => (
                  // 기간 라벨을 박스 바닥에서 살짝 띄운다(요청: "그래프 하단 패딩") — viewBox
                  // 안쪽 값이라 박스 aspect-ratio는 그대로라 로딩→그래프 전환 때 높이가 안 흔들린다.
                  <text key={`label-${i}`} className="scr-rank-detail-axis-label" x={xFor(i)} y={H - 14}>
                    {p.label}
                  </text>
                ))}
                {points.map((p, i) => (
                  p.rank === null ? null : (
                    <g key={`point-${i}`}>
                      <circle className="scr-rank-detail-dot" cx={xFor(i)} cy={yFor(p.rank)} r={3} />
                      <text className="scr-rank-detail-value" x={xFor(i)} y={yFor(p.rank) - 8}>
                        {p.rank}위
                      </text>
                    </g>
                  )
                ))}
              </svg>
            )}
          </div>

          {/* 그래프 아래 경기 이력(요청) — 일대일이면 그 회원의 일대일 경기 전체를 보여준다. */}
          <div className="scr-rank-detail-history">
            <div className="scr-rank-detail-section-head">경기 이력{matches.length > 0 && ` (${matches.length})`}</div>
            {matchesErr && <div className="scr-err">{matchesErr}</div>}
            <RankMatchHistory
              matches={matches} members={members} memberOf={memberOf} loading={matchesLoading}
              deltaByMatchNo={deltaByMatchNo}
              bothTeams={matchType === "0102"}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
