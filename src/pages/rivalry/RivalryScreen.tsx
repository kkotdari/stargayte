import { useEffect, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import RivalryMap from "../v2/RivalryMap";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import type { RivalryPair } from "../../types";

// 유저 상성 맵 — 운영 메뉴 전용 화면(요청). 전체 기간의 1:1 상대전적으로 누가 누구에게
// 강하고/약하고/대등한지를 원형 그래프(글라스 칩 + 화살표)로 보여준다.
export default function RivalryScreen() {
  const memberOf = useAppStore((s) => s.memberOf);
  const [pairs, setPairs] = useState<RivalryPair[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getRivalries()
      .then((res) => { if (!cancelled) setPairs(res.pairs); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "상성 데이터를 불러오지 못했어요."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="scr-screen scr-rivalry-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">상성맵</h1>
      </div>
      {error && <div className="scr-err">{error}</div>}
      {pairs === null && !error
        ? <div className="scr-empty"><Spinner size={18} /></div>
        : pairs !== null && <RivalryMap pairs={pairs} memberOf={memberOf} />}
    </div>
  );
}
