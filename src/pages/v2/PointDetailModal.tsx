import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import PointDetailHistory from "./PointDetailHistory";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { GameResult, GameType, Member, Race } from "../../types";

// 이력은 최근 100건까지만(아주 많은 경우 대비).
const HISTORY_LIMIT = 100;

interface PointDetailModalProps {
  member: Member;
  // 개인전이면 "0101"(1:1 경기), 팀전이면 "0102"(팀경기) 이력을 보여준다.
  matchType: GameType;
  // 통계 화면에서 보고 있던 기간 — 이력과 경기당 포인트(Δ)를 같은 기준으로 좁힌다.
  // 전체 기간이면 빈 문자열.
  period: { from: string; to: string };
  // 목록에 걸린 종족 필터 — "all"이 아니면 그 종족 레이팅 기준의 경기당 Δ만 병기한다.
  race: Race | "all";
  onClose: () => void;
}

// 포인트 상세 — 통계의 포인트를 눌렀을 때 뜨는 모달(예전 "랭킹 상세"를 대체, 요청).
// 순위변동 그래프와 소제목 없이, 그 회원의 경기 이력(경기당 포인트 변화 병기)만 보여준다.
export default function PointDetailModal({
  member, matchType, period, race, onClose,
}: PointDetailModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);

  const [gameResults, setGameResults] = useState<GameResult[]>([]);
  const [gameResultsLoading, setGameResultsLoading] = useState(true);
  const [gameResultsErr, setGameResultsErr] = useState("");

  const reload = useCallback(() => {
    let cancelled = false;
    setGameResultsLoading(true);
    setGameResultsErr("");
    api.getGameResultsPage({
      teamMemberIds: [member.id], matchType, sort: "latest",
      dateFrom: period.from, dateTo: period.to, limit: HISTORY_LIMIT,
    })
      .then((page) => { if (!cancelled) setGameResults(page.items); })
      .catch((e) => { if (!cancelled) setGameResultsErr(e instanceof Error ? e.message : "경기를 불러오지 못했어요."); })
      .finally(() => { if (!cancelled) setGameResultsLoading(false); });
    return () => { cancelled = true; };
  }, [member.id, matchType, period.from, period.to]);

  useEffect(() => reload(), [reload]);

  // 경기당 포인트 변화(Δ) — 레이팅은 시간순 누적이라 클라이언트가 재구성할 수 없어 서버가
  // 계산해 준다. 목록과 같은 기간/종족 기준으로 받아야 같은 경기에 같은 값이 붙는다.
  const [deltaByMatchNo, setDeltaByMatchNo] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    setDeltaByMatchNo(new Map());
    api.getRatingHistory(member.id, matchType, period.from, period.to, race === "all" ? undefined : race)
      .then((res) => { if (!cancelled) setDeltaByMatchNo(new Map(Object.entries(res.deltas))); })
      .catch(() => { if (!cancelled) setDeltaByMatchNo(new Map()); });
    return () => { cancelled = true; };
  }, [member.id, matchType, period.from, period.to, race]);

  return createPortal(
    // 바깥(딤) 클릭으로는 안 닫는다 — 닫기는 헤더 X 버튼으로만(기존 랭킹 상세와 동일).
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-modal-rank-detail">
        <div className="scr-modal-head">
          <span>포인트 상세</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <div className="scr-rank-detail-who">
            <Avatar member={member} size={40} />
            <div className="scr-rank-detail-who-text">
              <span className="scr-rank-detail-name">{member.nickname}</span>
            </div>
          </div>

          {/* 소제목 없이 이력만 바로 보여준다(요청). */}
          <div className="scr-rank-detail-history">
            {gameResultsErr && <div className="scr-err">{gameResultsErr}</div>}
            <PointDetailHistory
              gameResults={gameResults} members={[member]} memberOf={memberOf} loading={gameResultsLoading}
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
