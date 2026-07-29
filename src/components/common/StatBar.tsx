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
          {/* compact(통계 그리드)에선 승/전 수치를 승률과 같은 줄에 두면 좁다(지적) —
              막대 아래 줄로 내린다. */}
          {!compact && (
            <span className="scr-stat-bar-count">{plays > 0 ? `${plays}전` : "-"}</span>
          )}
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
      {/* "승/전" 줄은 경기가 없어도 자리를 비워 둔 채 항상 그린다(요청: "데이터 안 나오는
          로우와 나오는 로우 높이가 달라서 흔들림"). 예전엔 이 줄을 아예 안 그려서 경기가
          없는 행만 한 줄 낮았고, 그 차이를 행 min-height로 덮고 있었다 — 글자 크기가
          커지면(iOS 텍스트 크기 조절 등) 내용 있는 행이 그 최소높이를 넘어서면서 다시
          어긋난다. 자리를 늘 잡아 두면 애초에 어긋날 일이 없다. */}
      {compact && (
        <div className="scr-stat-bar-count-below" aria-hidden={plays === 0 || undefined}>
          {/* 그냥 공백은 접혀서 줄 높이가 안 생기므로 안 접히는 공백(U+00A0)으로 자리만 남긴다. */}
          {plays > 0 ? `${wins}/${plays}` : " "}
        </div>
      )}
    </div>
  );
}
