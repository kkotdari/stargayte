import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import MatchList, { type SearchListRow } from "./MatchList";
import MatchMemoModal from "../../modals/MatchMemoModal";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { MONTHS_KR } from "../../utils/date";
import type { Match, MatchType, Member } from "../../types";
import type { RankTrendPoint } from "./rank";

interface RankingDetailModalProps {
  members: Member[];
  // members가 여럿(팀)이면 이름을 이어붙여 보여준다.
  points: RankTrendPoint[] | null; // null이면 아직 불러오는 중.
  // 그래프 아래 경기 이력을 어떤 종류로 거를지 — 일대일 랭킹이면 "0101"(그 회원의 일대일
  // 경기만), 팀 랭킹이면 undefined(그 팀 구성이 함께 뛴 경기 전부). 없으면 이력을 안 그린다.
  matchType?: MatchType;
  onClose: () => void;
}

const W = 300;
const H = 140;
const PAD_X = 22;
const PAD_TOP = 20;
const PAD_BOTTOM = 24;
// 그래프 아래 경기 이력 — "최근 한 경기"가 아니라 (일대일) 전체를 보여준다(요청: "최근 경기
// 이력말고 일대일 이력 다"). 그래도 아주 많은 경우를 위해 최근 100건까지만.
const HISTORY_LIMIT = 100;

function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS_KR[m - 1];
}

// 랭킹 카드를 눌렀을 때 뜨는 상세 — 위엔 최근 5개월 순위변동 그래프, 아래엔 그 회원(팀)의
// 경기 이력 전체(요청: "랭킹 상세에 그래프 아래에 경기 이력 보여주기"). 그 달에 순위 대상이
// 아니었으면(한 판도 안 뛰었거나 인원수 필터에 안 맞았거나) rank가 null이라 그 지점은 선을
// 잇지 않고 건너뛴다.
export default function RankingDetailModal({ members, points, matchType, onClose }: RankingDetailModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);
  const title = members.map((m) => m.nickname).join(", ");

  const known = (points ?? []).filter((p): p is { month: string; rank: number } => p.rank !== null);
  const minRank = known.length ? Math.min(...known.map((p) => p.rank)) : 1;
  const maxRank = known.length ? Math.max(...known.map((p) => p.rank)) : 1;
  const span = Math.max(1, maxRank - minRank);
  const xFor = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / Math.max(1, (points?.length ?? 1) - 1);
  // 순위는 숫자가 작을수록 좋은 성적이라, 위로 갈수록(y가 작을수록) 좋은 순위가 되도록 뒤집는다.
  const yFor = (rank: number) => PAD_TOP + ((rank - minRank) / span) * (H - PAD_TOP - PAD_BOTTOM);

  // 결측(그 달 순위 없음)이 있어도 선은 알고 있는 지점끼리만 잇는다 — 없는 달을 억지로
  // 보간하면 실제로 없던 순위가 있던 것처럼 보인다.
  const segments: { month: string; rank: number; i: number }[][] = [];
  (points ?? []).forEach((p, i) => {
    if (p.rank === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ ...p, rank: p.rank, i });
    else segments.push([{ month: p.month, rank: p.rank, i }]);
  });

  // 그래프 아래 경기 이력 — 이 회원(팀)이 뛴 경기를 서버에서 받아온다(teamMemberIds로 "그
  // 구성이 같은 편으로 뛴 경기"만 거른다). 일대일이면 matchType="0101".
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesErr, setMatchesErr] = useState("");
  const [memoMatch, setMemoMatch] = useState<Match | null>(null);
  const memberIdsKey = members.map((m) => m.id).join(",");

  const reload = useCallback(() => {
    let cancelled = false;
    setMatchesLoading(true);
    setMatchesErr("");
    api.getMatchesPage({ teamMemberIds: memberIdsKey.split(","), matchType, limit: HISTORY_LIMIT })
      .then((page) => { if (!cancelled) setMatches(page.items); })
      .catch((e) => { if (!cancelled) setMatchesErr(e instanceof Error ? e.message : "경기를 불러오지 못했어요."); })
      .finally(() => { if (!cancelled) setMatchesLoading(false); });
    return () => { cancelled = true; };
  }, [memberIdsKey, matchType]);

  useEffect(() => reload(), [reload]);

  const rows: SearchListRow[] = matches.map((m) => (
    { id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }
  ));

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-modal-rank-detail" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>순위 변동 · 경기 이력</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          {/* 아바타 없이 이름만 — 요청: "랭킹 상세 모달 아바타 없애기". */}
          <div className="scr-rank-detail-who">
            <div className="scr-rank-detail-who-text">
              <span className="scr-rank-detail-name">{title}</span>
            </div>
          </div>

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
                  <text key={`label-${p.month}`} className="scr-rank-detail-axis-label" x={xFor(i)} y={H - 6}>
                    {monthLabel(p.month)}
                  </text>
                ))}
                {points.map((p, i) => (
                  p.rank === null ? null : (
                    <g key={`point-${p.month}`}>
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
            <div className="scr-rank-detail-history-head">경기 이력{matches.length > 0 && ` (${matches.length})`}</div>
            {matchesErr && <div className="scr-err">{matchesErr}</div>}
            <MatchList
              rows={rows}
              memberOf={memberOf}
              onMemo={setMemoMatch}
              onDeleted={reload}
              loading={matchesLoading}
              highlightMemberIds={new Set(members.map((m) => m.id))}
            />
          </div>
        </div>
      </div>

      {memoMatch && (
        <MatchMemoModal
          match={memoMatch}
          onClose={() => setMemoMatch(null)}
          onSaved={() => { setMemoMatch(null); reload(); }}
        />
      )}
    </div>,
    document.body,
  );
}
