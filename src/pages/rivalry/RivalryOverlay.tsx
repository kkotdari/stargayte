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
    <div className="scr-rivalry-overlay" onClick={onClose}>
      {/* 맵 영역 탭은 오버레이 닫힘으로 새지 않게 막는다 — 칩 선택/해제는 맵 자신의 몫. */}
      <div className="scr-rivalry-overlay-body" onClick={(e) => e.stopPropagation()}>
        <div className="scr-rivalry-overlay-head">
          <span className="scr-rivalry-overlay-title">상성맵</span>
          <button type="button" className="scr-rivalry-overlay-close" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {error && <div className="scr-err">{error}</div>}
        {pairs === undefined && !error
          ? <div className="scr-empty"><Spinner size={18} /></div>
          : pairs !== undefined && <RivalryMap pairs={pairs} memberOf={memberOf} />}
      </div>
    </div>,
    document.body,
  );
}
