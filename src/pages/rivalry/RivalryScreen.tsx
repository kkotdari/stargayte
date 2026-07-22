import { useEffect, useMemo, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import PillTabs from "../../components/common/PillTabs";
import RivalryMap from "../v2/RivalryMap";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { currentMonthValue, monthInputToRange, MONTH_INPUT_MIN, MONTH_INPUT_MAX } from "../../utils/date";
import type { RivalryPair } from "../../types";

type RivalryMode = "solo" | "team";
// 팀전 모드는 잠시 내려둔다(요청: "프론트에서 잠시 삭제(백엔드는 유지)") — 탭을
// 되살리려면 여기 "team" 항목을 복구하면 된다(mode=team API/캐시 구조는 그대로 동작).
const MODES: { key: RivalryMode; label: string }[] = [
  { key: "solo", label: "개인전" },
];

// 기간 필터(요청) — 통계 화면과 같은 전체/월 구성. 기본은 전체(상성은 누적 데이터가
// 의미의 중심이라 통계의 "이번 달" 기본과 달리 전 기간으로 시작한다).
const PERIOD_OPTS: { value: "all" | "month"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];

// 유저 상성 맵 — 운영 메뉴 전용 화면(요청). 상대전적으로 누가 누구에게 강하고/약하고/
// 대등한지를 원형 그래프(글라스 칩 + 화살표)로 보여준다.
export default function RivalryScreen() {
  const memberOf = useAppStore((s) => s.memberOf);
  const [mode, setMode] = useState<RivalryMode>("solo");
  const [periodUnit, setPeriodUnit] = useState<"all" | "month">("all");
  const [periodMonth, setPeriodMonth] = useState(currentMonthValue);

  const { from, to } = useMemo(
    () => (periodUnit === "month" ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodUnit, periodMonth],
  );

  // (모드, 기간) 조합별 캐시 — 탭/기간을 오갈 때 이미 본 조합은 다시 안 불러온다.
  const cacheKey = `${mode}|${from}|${to}`;
  const [pairsByKey, setPairsByKey] = useState<Record<string, RivalryPair[]>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (pairsByKey[cacheKey]) return;
    let cancelled = false;
    setError("");
    api.getRivalries({ mode, dateFrom: from || undefined, dateTo: to || undefined })
      .then((res) => { if (!cancelled) setPairsByKey((p) => ({ ...p, [cacheKey]: res.pairs })); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "상성 데이터를 불러오지 못했어요."); });
    return () => { cancelled = true; };
  }, [cacheKey, mode, from, to, pairsByKey]);

  const pairs = pairsByKey[cacheKey];

  return (
    <div className="scr-screen scr-rivalry-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">상성맵</h1>
      </div>
      {/* 개인전/팀전 탭 — 하단 탭바와 같은 루페 물방울이 활성 탭 위에 얹힌다(요청).
          두 탭이 같은 폭이라 물방울은 CSS transform만으로 좌우 슬라이드한다.
          모드가 하나뿐인 동안(팀전 임시 제거)은 탭줄 자체를 숨긴다. */}
      {MODES.length > 1 && (
        <div className="scr-rivalry-tabs" role="tablist">
          <div
            className={cx("scr-mobile-tab-glow", "scr-rivalry-tab-indicator")}
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
        </div>
      )}
      {/* 기간 필터(요청) — 통계 화면과 같은 전체/월 알약탭 + 달력. */}
      <div className="scr-rivalry-period">
        <PillTabs options={PERIOD_OPTS} value={periodUnit} onChange={setPeriodUnit} aria-label="기간" />
        {periodUnit === "month" && (
          <input
            type="month" className="scr-filter-month-input"
            min={MONTH_INPUT_MIN} max={MONTH_INPUT_MAX}
            value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)}
            aria-label="조회할 월"
          />
        )}
      </div>
      {error && <div className="scr-err">{error}</div>}
      {pairs === undefined && !error
        ? <div className="scr-empty"><Spinner size={18} /></div>
        : pairs !== undefined && <RivalryMap pairs={pairs} memberOf={memberOf} team={mode === "team"} />}
    </div>
  );
}
