interface StatBarProps {
  // 없으면(전체 전적처럼 칸 제목이 이미 있는 경우) 라벨 줄 자체를 생략한다.
  label?: string;
  plays: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  // v2 전용 — 캡션을 "승/전"(예: 5/8) 짧은 표기로 줄인다. 기본(false, v1)은 기존처럼
  // 승/무/패를 풀어서 보여준다.
  compact?: boolean;
}

// 승/무/패 비율만 막대 안 색 구간으로 보여준다 — 경기수(누가 더 많이 뛰었는지)는 별도
// 게임수 칸(ValueBar)이 맡으므로, 이 막대 길이는 항상 꽉 채워서 구간 비율(승:무:패)만
// 비교하면 된다. 정확한 수치(전적)는 라벨/승률과 같은 줄(top row) 가운데에 보여준다.
export default function StatBar({ label, plays, wins, draws, losses, winRate, compact = false }: StatBarProps) {
  return (
    <div className="scr-stat-bar-row">
      <div className="scr-stat-bar-top">
        <span className="scr-stat-bar-label-group">
          {label && <span className="scr-stat-bar-label">{label}</span>}
          <span className="scr-stat-bar-count">
            {plays > 0 ? (compact ? `${wins}/${plays}` : `${plays}전`) : "-"}
          </span>
        </span>
        {!compact && plays > 0 && (
          <span className="scr-stat-bar-nums">
            {wins}승{draws > 0 && ` ${draws}무`} {losses}패
          </span>
        )}
        <span className="scr-stat-bar-rate">{plays > 0 ? `${winRate}%` : "-"}</span>
      </div>
      <div className="scr-stat-bar-track-wrap">
        {plays > 0 && (
          <div className="scr-stat-bar-track">
            {wins > 0 && <div className="scr-stat-bar-seg scr-stat-bar-seg-win" style={{ flexGrow: wins }} />}
            {draws > 0 && <div className="scr-stat-bar-seg scr-stat-bar-seg-draw" style={{ flexGrow: draws }} />}
            {losses > 0 && <div className="scr-stat-bar-seg scr-stat-bar-seg-loss" style={{ flexGrow: losses }} />}
          </div>
        )}
      </div>
    </div>
  );
}
