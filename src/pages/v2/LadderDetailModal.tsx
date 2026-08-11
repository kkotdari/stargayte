import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import Select from "../../components/common/Select";
import { Spinner } from "../../components/common/Feedback";
import PointDetailHistory from "./PointDetailHistory";
import { api } from "../../api/client";
import { rankOf } from "./rankOrder";
import { useAppStore } from "../../store/appStore";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { currentMonthValue, monthInputToRange, shiftMonthValue } from "../../utils/date";
import type { GameResult, GameType, Member } from "../../types";

/* 래더 한 줄을 눌렀을 때 뜨는 상세(요청: 프로필이 아니라 예전 랭킹 상세처럼) —
   위엔 "래더 순위 변동"(최근 몇 달의 순위 그래프), 아래엔 "래더 이력"(그 회원의 개인전
   목록, 결과만 — 레이팅은 안 적는다, 요청).

   그래프·이력의 뼈대와 CSS(.scr-rank-detail-*)는 폐기된 랭킹 상세(RankingDetailModal,
   ce8b3f4에서 삭제)에서 가져왔다 — 그 화면이 하던 일이 정확히 이것이었고, 스타일도
   global.css에 그대로 남아 있었다. */

const LADDER_TYPE: GameType = "0101";
/** 그래프에 세울 달 수 — 옛 랭킹 상세와 같은 다섯 칸. 더 늘리면 달마다 전체 통계를 한 번씩
 *  받는 자리라 여는 값이 그대로 늘어난다. */
const TREND_MONTHS = 5;
const HISTORY_LIMIT = 100;
/** 레이팅을 안 적는 이력이라 Δ는 늘 빈 지도다 — 렌더마다 새로 만들지 않게 밖에 둔다. */
const EMPTY_DELTAS = new Map<string, number>();

// 그래프 좌표계 — 옛 랭킹 상세의 값 그대로다(주석까지 그쪽 참고).
const W = 300;
const H = 140;
const PAD_X = 32;
const PAD_TOP = 38;
const PAD_BOTTOM = 30;

interface TrendPoint {
  label: string;
  rank: number | null;
}

/** 그 달 말일 기준의 순위 — 래더는 '그 시점까지의 누적'이라(화면과 같은 잣대) 시작일을
 *  안 주고 끝나는 날만 그 달의 마지막 날로 자른다. */
async function rankAt(month: string, poolIds: string[], memberId: string): Promise<number | null> {
  const { to } = monthInputToRange(month);
  const res = await api.getGameResultStats({
    memberIds: poolIds, dateFrom: "", dateTo: to, matchType: LADDER_TYPE, race: "all",
  });
  const byId: Record<string, (typeof res.members)[number]> = {};
  res.members.forEach((e) => { byId[e.memberId] = e; });
  return rankOf(byId, poolIds).get(memberId) ?? null;
}

/* 정규화(주인공을 team1로)와 날짜 묶기는 PointDetailHistory가 한다 — 포인트 상세와 같은
   부품이라야 두 상세가 같은 꼴로 보인다(처음에 손으로 그렸다가 클래스가 옛 이름이라 통째로
   깨졌다 — 지적: 하나도 안 맞고 안 이쁘다). */

export default function LadderDetailModal({
  member, poolIds, period, firstMonth, onClose,
}: {
  member: Member;
  /** 순위를 셀 무리 — 화면과 같은 목록이라야 여기 순위와 표의 순위가 같다. */
  poolIds: string[];
  /** 화면이 보고 있던 달(YYYY-MM) — 그래프의 오른쪽 끝이자 이력 필터의 시작값. */
  period: string;
  /** 첫 경기가 있는 달 — 그보다 과거는 그래프도 필터도 안 만든다(어차피 빈 값이다). */
  firstMonth: string | null;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);

  /* ── 래더 순위 변동 — 최근 다섯 달, 달마다 그 말일 기준의 누적 순위다. ─────────── */
  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
      const m = shiftMonthValue(period, -i);
      if (firstMonth && m < firstMonth) continue;
      out.push(m);
    }
    return out;
  }, [period, firstMonth]);

  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    Promise.all(months.map(async (m) => ({
      label: `${Number(m.slice(5))}월`,
      rank: await rankAt(m, poolIds, member.id).catch(() => null),
    })))
      .then((ps) => { if (!cancelled) setPoints(ps); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
    // poolIds는 화면이 만든 고정 목록이라 문자열로 접어 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, member.id, poolIds.join(",")]);

  const known = (points ?? []).filter((p): p is { label: string; rank: number } => p.rank !== null);
  const minRank = known.length ? Math.min(...known.map((p) => p.rank)) : 1;
  const maxRank = known.length ? Math.max(...known.map((p) => p.rank)) : 1;
  const span = Math.max(1, maxRank - minRank);
  const xFor = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / Math.max(1, (points?.length ?? 1) - 1);
  // 순위는 작을수록 좋은 성적 — 위로 갈수록(y가 작을수록) 좋은 순위가 되게 뒤집는다.
  const yFor = (rank: number) => PAD_TOP + ((rank - minRank) / span) * (H - PAD_TOP - PAD_BOTTOM);
  // 결측(그 달 순위 없음)이 있어도 선은 아는 지점끼리만 잇는다 — 보간하면 없던 순위가 생긴다.
  const segments: { rank: number; i: number }[][] = [];
  (points ?? []).forEach((p, i) => {
    if (p.rank === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ rank: p.rank, i });
    else segments.push([{ rank: p.rank, i }]);
  });

  /* ── 래더 이력 — 월 필터(요청)가 있는 개인전 목록. 결과만, 레이팅은 안 적는다(요청). ── */
  const [historyMonth, setHistoryMonth] = useState(period);
  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: "all", label: "전체" }];
    const start = firstMonth ?? shiftMonthValue(currentMonthValue(), -11);
    for (let m = currentMonthValue(); m >= start; m = shiftMonthValue(m, -1)) {
      out.push({ value: m, label: `${m.slice(0, 4)}.${m.slice(5)}` });
    }
    return out;
  }, [firstMonth]);

  const [history, setHistory] = useState<GameResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyErr, setHistoryErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryErr("");
    const range = historyMonth === "all" ? { from: "", to: "" } : monthInputToRange(historyMonth);
    api.getGameResultsPage({
      teamMemberIds: [member.id], matchType: LADDER_TYPE, sort: "latest",
      dateFrom: range.from, dateTo: range.to, limit: HISTORY_LIMIT,
    })
      .then((page) => { if (!cancelled) setHistory(page.items); })
      .catch((e) => {
        if (!cancelled) setHistoryErr(e instanceof Error ? e.message : "경기를 불러오지 못했어요.");
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [member.id, historyMonth]);

  return createPortal(
    // 바깥(딤) 클릭으로는 안 닫는다 — 옛 랭킹 상세와 같은 규칙(닫기는 X로만).
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-modal-rank-detail">
        <div className="scr-modal-head">
          <span>래더 상세</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <div className="scr-rank-detail-who">
            <Avatar member={member} size={40} />
            <div className="scr-rank-detail-who-text">
              <span className="scr-rank-detail-name">{member.nickname}</span>
            </div>
          </div>

          <div className="scr-rank-detail-section-head">래더 순위 변동</div>
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

          <div className="scr-rank-detail-history">
            <div className="scr-rank-detail-section-head scr-ladder-history-head">
              <span>래더 이력{history.length > 0 && ` (${history.length})`}</span>
              {/* 월 필터(요청) — 그래프는 늘 최근 다섯 달이고, 이 필터는 아래 목록만 거른다. */}
              <Select
                className="scr-ladder-history-month" size="sm"
                value={historyMonth}
                options={monthOptions}
                onChange={setHistoryMonth}
                minDropWidth={104}
              />
            </div>
            {historyErr && <div className="scr-err">{historyErr}</div>}
            {/* 결과만 적는다(요청: 레이팅 X) — noRating이 Δ와 "레이팅 제외"를 함께 끈다. */}
            <PointDetailHistory
              gameResults={history} members={[member]} memberOf={memberOf}
              loading={historyLoading} deltaByMatchNo={EMPTY_DELTAS} noRating
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
