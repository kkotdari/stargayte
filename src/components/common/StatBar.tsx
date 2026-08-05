import type { CSSProperties } from "react";

interface StatBarProps {
  // 없으면(전체 전적처럼 칸 제목이 이미 있는 경우) 라벨 줄 자체를 생략한다.
  label?: string;
  plays: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  // v2 전용 — 승률 숫자를 막대 위에 겹쳐 그린다(ValueBar와 같은 방식). 기본(false, v1)은
  // 기존처럼 라벨/전적/승률을 막대 위 별도 줄에 풀어서 보여준다.
  compact?: boolean;
  // 이미 끝난 기간에서 승률 1·2·3위에 붙는 메달(요청) — 막대 위의 승률 바로 옆에
  // 흐름으로 선다(ValueBar와 같다).
  medal?: string;
}

// 승률만 막대 안에 초록으로 채워 보여준다(요청: "승만 초록색 표시, 나머지는 빈칸으로" —
// 무/패를 각각 회색·붉은색으로 구분해 그리던 것을 없앴다). 게임수/생산/APM/커맨드
// (ValueBar)와 같은 원리로, 채운 만큼만 진하고 나머지는 반투명 그라디언트 한 장이다.
export default function StatBar({ label, plays, wins, draws, losses, winRate, compact = false, medal }: StatBarProps) {
  const rateText = plays > 0 ? `${winRate}%` : "-";
  const trackStyle: CSSProperties = plays > 0 ? { ["--scr-value-fill" as string]: `${winRate}%` } : {};
  return (
    <div className="scr-stat-bar-row">
      {!compact && (
        <div className="scr-stat-bar-top">
          <span className="scr-stat-bar-label-group">
            {label && <span className="scr-stat-bar-label">{label}</span>}
            <span className="scr-stat-bar-count">{plays > 0 ? `${plays}전` : "-"}</span>
          </span>
          {plays > 0 && (
            <span className="scr-stat-bar-nums">
              {wins}승{draws > 0 && ` ${draws}무`} {losses}패
            </span>
          )}
          <span className="scr-stat-bar-rate">{rateText}</span>
        </div>
      )}
      <div
        className={plays > 0 ? "scr-stat-bar-track-wrap" : "scr-stat-bar-track-wrap scr-value-bar-track-wrap-empty"}
        style={trackStyle}
      >
        {/* 승률도 다른 막대(게임수/생산/APM/커맨드)처럼 막대 위에 겹쳐 그린다(요청). */}
        {/* 메달은 승률 글자 안이다(ValueBar와 같은 이유) — 여기선 더 나빴다: 승률 글자는
            트랙 전체에 걸친 절대배치 상자(inset:0)가 가운데로 세우는데 메달만 흐름에
            있어서, 둘이 서로를 모른 채 겹쳤다(지적한 스크린샷의 "70%"). */}
        {compact && (
          <span className="scr-stat-bar-rate scr-stat-bar-rate-overlay">
            <span className="scr-stat-bar-rate-val">
              {rateText}
              {medal && <span className="scr-stat-medal">{medal}</span>}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
