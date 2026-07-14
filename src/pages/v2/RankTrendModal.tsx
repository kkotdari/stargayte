import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { MONTHS_KR } from "../../utils/date";
import type { Member } from "../../types";
import type { RankTrendPoint } from "./rank";

interface RankTrendModalProps {
  members: Member[];
  // members가 여럿(팀)이면 이름을 이어붙여 보여준다.
  points: RankTrendPoint[] | null; // null이면 아직 불러오는 중.
  onClose: () => void;
}

const W = 300;
const H = 140;
const PAD_X = 22;
const PAD_TOP = 20;
const PAD_BOTTOM = 24;

function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS_KR[m - 1];
}

// 랭킹 카드를 눌렀을 때 뜨는 최근 5개월 순위변동(요청: "랭킹 카드 클릭시 최근 5개월
// 순위변동 모달창 노출") — v1 랭킹 화면이 쓰던 순위변동 모달의 CSS(scr-rank-detail-*)를
// 그대로 재활용한다(v1은 없어졌지만 스타일만 남겨뒀던 것). 그 달에 순위 대상이 아니었으면
// (한 판도 안 뛰었거나, 팀 인원수 필터에 안 맞았거나) rank가 null이라 그 지점은 선을
// 잇지 않고 건너뛴다.
export default function RankTrendModal({ members, points, onClose }: RankTrendModalProps) {
  useLockBodyScroll();
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

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-modal-rank-detail" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>최근 5개월 순위변동</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <div className="scr-rank-detail-who">
            {members.slice(0, 1).map((m) => <Avatar key={m.id} member={m} size={40} />)}
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
