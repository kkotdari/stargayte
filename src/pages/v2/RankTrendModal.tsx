import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import { api } from "../../api/client";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { monthInputToRange, monthLabel, shiftMonthValue } from "../../utils/date";
import { rankOf } from "./rankOrder";
import type { GameType, Member, Race } from "../../types";

/** 그래프에 늘어놓을 달 수 — 지금 보고 있는 달을 포함해 최근 다섯 달(요청). */
const MONTHS = 5;

const W = 300;
const H = 140;
/* 그래프 안쪽 여백 — 선/점/라벨이 박스 가장자리에 붙지 않게 넉넉히 준다. 순위 값 라벨은
   점보다 8px 위에 그려지므로(아래 yFor(...) - 8), 위쪽을 아래쪽보다 그만큼 더 준다.
   viewBox 안쪽 값이라 박스 aspect-ratio는 그대로다 — 로딩→그래프 전환 때 높이가 안 흔들린다. */
const PAD_X = 32;
const PAD_TOP = 38;
const PAD_BOTTOM = 30;

interface RankTrendPoint { label: string; rank: number | null }

/** 월간 랭크를 눌렀을 때 뜨는 최근 5개월 순위변동 그래프(요청).
 *
 *  달마다 그 조건(분류·종족)의 통계를 따로 받아 순위를 다시 매긴다 — 순위는 그 달 표
 *  전체에서 나오는 값이라, 한 사람 것만 받아서는 몇 위인지 알 수 없다. 그래서 회원
 *  전체를 넘겨 받고(memberIds) 화면과 똑같은 규칙(rankOf)으로 줄을 세운다.
 *
 *  달을 한 번에 받는 엔드포인트는 없다 — 예전 랭킹 화면이 쓰던 /stats/monthly는 그 화면과
 *  함께 사라졌다. 클럽 규모라 다섯 번을 나란히 부르는 편이 서버에 배치 API를 새로 들이는
 *  것보다 싸고, 무엇보다 통계표와 정확히 같은 계산을 쓰게 된다. */
export default function RankTrendModal({
  member, memberIds, month, matchType, race, onClose,
}: {
  member: Member;
  /** 순위를 매길 모수 — 그 조건의 회원 전체. */
  memberIds: string[];
  /** 지금 보고 있는 달("YYYY-MM") — 그래프의 오른쪽 끝이다. */
  month: string;
  matchType: GameType;
  race: Race | "all";
  onClose: () => void;
}) {
  useLockBodyScroll();

  const [points, setPoints] = useState<RankTrendPoint[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setErr("");
    const months = Array.from({ length: MONTHS }, (_, i) => shiftMonthValue(month, i - (MONTHS - 1)));
    Promise.all(months.map(async (m) => {
      const { from, to } = monthInputToRange(m);
      const res = await api.getGameResultStats({
        memberIds, dateFrom: from, dateTo: to, matchType,
        race: race === "all" ? undefined : race,
      });
      const byId = Object.fromEntries(res.members.map((e) => [e.memberId, e]));
      return { label: monthLabel(m), rank: rankOf(byId, memberIds).get(member.id) ?? null };
    }))
      .then((rows) => { if (!cancelled) setPoints(rows); })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "순위를 불러오지 못했어요.");
      });
    return () => { cancelled = true; };
    // memberIds는 배열이라 매 렌더 새 참조가 될 수 있어 문자열로 묶어 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id, memberIds.join(","), month, matchType, race]);

  const known = (points ?? []).filter((p): p is { label: string; rank: number } => p.rank !== null);
  const minRank = known.length ? Math.min(...known.map((p) => p.rank)) : 1;
  const maxRank = known.length ? Math.max(...known.map((p) => p.rank)) : 1;
  const span = Math.max(1, maxRank - minRank);
  const xFor = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / Math.max(1, MONTHS - 1);
  // 순위는 숫자가 작을수록 좋은 성적이라, 위로 갈수록(y가 작을수록) 좋은 순위가 되게 뒤집는다.
  const yFor = (rank: number) => PAD_TOP + ((rank - minRank) / span) * (H - PAD_TOP - PAD_BOTTOM);

  /* 결측(그 달 순위 없음)이 있어도 선은 알고 있는 지점끼리만 잇는다 — 없는 달을 억지로
     보간하면 실제로 없던 순위가 있던 것처럼 보인다. */
  const segments: { rank: number; i: number }[][] = [];
  (points ?? []).forEach((p, i) => {
    if (p.rank === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ rank: p.rank, i });
    else segments.push([{ rank: p.rank, i }]);
  });

  return createPortal(
    // 바깥(딤) 클릭으로는 안 닫는다 — 닫기는 헤더 X 버튼으로만(포인트 상세와 같은 규칙).
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-modal-rank-trend">
        <div className="scr-modal-head">
          <span>순위변동</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <div className="scr-rank-detail-who">
            <Avatar member={member} size={40} />
            <div className="scr-rank-detail-who-text">
              <span className="scr-rank-detail-name">{member.nickname}</span>
            </div>
          </div>
          <div className="scr-rank-detail-chart-area">
            {err ? (
              <div className="scr-err">{err}</div>
            ) : points === null ? (
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
                  <text key={`label-${i}`} className="scr-rank-detail-axis-label" x={xFor(i)} y={H - 14}>
                    {p.label}
                  </text>
                ))}
                {points.map((p, i) => (p.rank === null ? null : (
                  <g key={`point-${i}`}>
                    <circle className="scr-rank-detail-dot" cx={xFor(i)} cy={yFor(p.rank)} r={3} />
                    <text className="scr-rank-detail-value" x={xFor(i)} y={yFor(p.rank) - 8}>
                      {p.rank}위
                    </text>
                  </g>
                )))}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
