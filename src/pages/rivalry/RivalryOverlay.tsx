import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import RivalryMap, { RivalryLegend } from "../v2/RivalryMap";
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
          <span className="scr-rivalry-overlay-title">상성 관계</span>
          <button type="button" className="scr-rivalry-overlay-close" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {error && <div className="scr-err">{error}</div>}
        {/* 로딩 화면을 로드된 화면과 "구조적으로 동일"하게 만든다 — 같은 .scr-rivalry
            컬럼에 같은 정사각(맵 자리) + 같은 범례. 그래야 본체 높이가 정확히 일치해서,
            세로 가운데 정렬인 이 오버레이에서 로드 순간 타이틀이 위/아래로 안 튄다
            (지적: 내용 로드되니 타이틀이 조금 내려감). 예전처럼 범례 높이를 px로 어림해
            예약하면 화면 폭에 따라 범례 줄바꿈이 달라져 늘 조금씩 어긋난다. */}
        {pairs === undefined && !error
          ? (
            <div className="scr-rivalry">
              <div className="scr-rivalry-overlay-loading"><Spinner size={18} /></div>
              <RivalryLegend />
            </div>
          )
          : pairs !== undefined && <RivalryMap pairs={pairs} memberOf={memberOf} />}
      </div>
    </div>,
    document.body,
  );
}
