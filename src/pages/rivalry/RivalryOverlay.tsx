import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import RivalryMap from "../v2/RivalryMap";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { RivalryPair } from "../../types";

// 랭킹 화면의 "상성맵" 버튼으로 여는 반투명 오버레이(요청) — 별도 화면 대신 랭킹 위에
// 겹쳐 띄우고, 기간은 랭킹의 현재 필터(월/연 기준점)를 그대로 따르므로 자체 필터가 없다.
// 개인전 전용이라 mode는 solo 고정(버튼 자체가 개인전에서만 보인다).
export default function RivalryOverlay({ from, to, onClose }: {
  from: string; to: string; onClose: () => void;
}) {
  const memberOf = useAppStore((s) => s.memberOf);
  const [pairs, setPairs] = useState<RivalryPair[] | undefined>(undefined);
  const [error, setError] = useState("");
  useLockBodyScroll();

  useEffect(() => {
    let cancelled = false;
    setPairs(undefined);
    setError("");
    api.getRivalries({ mode: "solo", dateFrom: from || undefined, dateTo: to || undefined })
      .then((res) => { if (!cancelled) setPairs(res.pairs); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "상성 데이터를 불러오지 못했어요."); });
    return () => { cancelled = true; };
  }, [from, to]);

  return createPortal(
    // 빈 공간(딤) 탭으로는 닫지 않는다(지적: "빈공간 클릭시 닫히는 문제") — 칩을 이리저리
    // 탭하다 배경을 스치면 통째로 닫혀버려서, 닫기는 우상단 X로만 한다.
    <div className="scr-rivalry-overlay">
      <div className="scr-rivalry-overlay-body">
        <div className="scr-rivalry-overlay-head">
          <span className="scr-rivalry-overlay-title">상성맵</span>
          <button type="button" className="scr-rivalry-overlay-close" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {error && <div className="scr-err">{error}</div>}
        {/* 로딩 자리도 맵과 같은 정사각으로 잡아둔다 — 스피너만 있는 낮은 높이로 세로
            가운데 정렬됐다가 데이터가 오면 본체가 커지며 타이틀/닫기가 위로 튀어 오르던
            부자연스러움(지적) 방지. */}
        {pairs === undefined && !error
          ? <div className="scr-rivalry-overlay-loading"><Spinner size={18} /></div>
          : pairs !== undefined && <RivalryMap pairs={pairs} memberOf={memberOf} />}
      </div>
    </div>,
    document.body,
  );
}
