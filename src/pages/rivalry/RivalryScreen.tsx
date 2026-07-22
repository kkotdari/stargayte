import { useEffect, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import RivalryMap from "../v2/RivalryMap";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { RivalryPair } from "../../types";

type RivalryMode = "solo" | "team";
// 팀전 모드는 잠시 내려둔다(요청: "프론트에서 잠시 삭제(백엔드는 유지)") — 탭을
// 되살리려면 여기 "team" 항목을 복구하면 된다(mode=team API/캐시 구조는 그대로 동작).
const MODES: { key: RivalryMode; label: string }[] = [
  { key: "solo", label: "개인전" },
];

// 유저 상성 맵 — 운영 메뉴 전용 화면(요청). 전체 기간의 상대전적으로 누가 누구에게
// 강하고/약하고/대등한지를 원형 그래프(글라스 칩 + 화살표)로 보여준다.
// 개인전(1:1) / 팀전(개인 환산 — 반대 팀이었던 회원 조합 전부에 승패를 1씩) 탭으로 나뉜다.
export default function RivalryScreen() {
  const memberOf = useAppStore((s) => s.memberOf);
  const [mode, setMode] = useState<RivalryMode>("solo");
  // 모드별로 따로 캐시 — 탭을 오갈 때마다 다시 안 불러온다.
  const [pairsByMode, setPairsByMode] = useState<Partial<Record<RivalryMode, RivalryPair[]>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (pairsByMode[mode]) return;
    let cancelled = false;
    setError("");
    api.getRivalries({ mode })
      .then((res) => { if (!cancelled) setPairsByMode((p) => ({ ...p, [mode]: res.pairs })); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "상성 데이터를 불러오지 못했어요."); });
    return () => { cancelled = true; };
  }, [mode, pairsByMode]);

  const pairs = pairsByMode[mode];

  return (
    <div className="scr-screen scr-rivalry-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">상성맵</h1>
      </div>
      {/* 개인전/팀전 탭 — 하단 탭바와 같은 루페 물방울이 활성 탭 위에 얹힌다(요청).
          두 탭이 같은 폭이라 물방울은 CSS transform만으로 좌우 슬라이드한다.
          모드가 하나뿐인 동안(팀전 임시 제거)은 탭줄 자체를 숨긴다. */}
      {MODES.length > 1 && <div className="scr-rivalry-tabs" role="tablist">
        <div
          className={cx("scr-mobile-tab-indicator", "scr-rivalry-tab-indicator")}
          style={{ transform: `translateX(${MODES.findIndex((m) => m.key === mode) * 100}%)` }}
        />
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={cx("scr-rivalry-tab", mode === m.key && "scr-rivalry-tab-active")}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>}
      {error && <div className="scr-err">{error}</div>}
      {pairs === undefined && !error
        ? <div className="scr-empty"><Spinner size={18} /></div>
        : pairs !== undefined && <RivalryMap pairs={pairs} memberOf={memberOf} team={mode === "team"} />}
    </div>
  );
}
