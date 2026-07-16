import Avatar from "../../components/common/Avatar";
import RecordText from "../../components/common/RecordText";
import RankDeltaBadge from "./RankDeltaBadge";
import { cx } from "../../utils/format";
import type { TeamRankRow as TeamRankRowData } from "./rank";

interface TeamRankRowProps {
  row: TeamRankRowData;
  // 바로 위 행과 공동순위인지 — 그러면 그 사이 구분선을 그리지 않는다(같은 그룹으로 묶여 보이도록).
  tiedWithPrev?: boolean;
  // 유저 검색으로 이 팀이 남은 이유가 된 사람들 — 팀에 4명이 있으면 누구 때문에 걸렸는지
  // 한눈에 안 보여서, 검색어에 걸린 사람만 반전색으로 도드라지게 한다.
  highlightMemberIds?: Set<string>;
  // 카드(행) 전체를 누르면 뜨는 상세 모달(최근 5개월 순위변동 + 이 팀이 함께 뛴 경기 이력).
  // 개인전 카드와 똑같이 카드 클릭 하나로 그래프와 경기 이력을 모두 보여준다(요청: 팀도
  // 개인처럼 "카드 클릭 → 상세 모달(그래프+이력)" 하나로 통합).
  onOpenTrend?: () => void;
}

// v2 팀 랭킹의 한 줄 — 개인전 행에서 프사·닉네임이 차지하던 자리를 구성원 격자(2열, 왼→오
// 위→아래)가 대신하고, 승률 자리에는 승점과 전적을 위아래로 쌓는다. 승점은 이 랭킹의 1순위
// 정렬 기준이라 숫자로 보여줘야 순서가 납득된다(전적만으론 왜 이 팀이 위인지 안 보인다).
//
// 카드를 누르면 상세 모달(최근 5개월 순위변동 그래프 + 함께 뛴 경기 이력)이 열린다.
// 개인전 행과 달리 프사를 눌러 사진뷰어를 여는 동작은 없다.
//
// 구성원 순서는 서버가 개인 승점 높은 순으로 정렬해서 보내준다(그 팀의 "에이스"가 왼쪽 위).
// 2:2면 두 칸, 3:3이면 세 칸이 차고 남는 칸은 비운다.
export default function TeamRankRow({
  row, tiedWithPrev = false, highlightMemberIds, onOpenTrend,
}: TeamRankRowProps) {
  const { members, rank, rankDelta, entry } = row;

  return (
    <div className={cx("scr-rank-row", "scr-team-rank-row", tiedWithPrev && "scr-rank-row-tied")}>
      <div
        className={cx("scr-rank-row-inner scr-team-rank-row-inner", onOpenTrend && "scr-team-rank-row-clickable")}
        onClick={onOpenTrend}
        role={onOpenTrend ? "button" : undefined}
        tabIndex={onOpenTrend ? 0 : undefined}
      >
        <div className="scr-rank-badge">
          {/* 개인전 행과 달리 순위 숫자 옆에 아무 정보(순위변동/승률)도 없어서 숫자만 덩그러니
              놓이면 무슨 수인지 읽히지 않는다 — "#"을 붙여 순위임을 분명히 한다. 순위 변동은
              팀마다 다를 수 있어 공동순위여도 매 행 각자 보여준다(요청: "랭킹에서 공동순위라도
              순위변동은 각각 표시돼야함"). */}
          <span className="scr-rank-num">{!tiedWithPrev && <><span className="scr-rank-num-hash">#</span>{rank}</>}</span>
          <RankDeltaBadge delta={rankDelta} />
        </div>
        <div className="scr-team-rank-grid">
          {members.map((m) => (
            // 검색에 걸린 사람만 경기결과 로스터와 똑같은 반전색으로 칠한다 — 팀에 넷이
            // 있으면 누구 때문에 이 팀이 남았는지 안 보인다. 닉네임만 칠하던 것에서 프사까지
            // 함께 덮는다(요청: "닉네임뿐 아니라 프사까지 하이라이팅 주고 경기 하이라이트랑
            // 똑같은 css").
            <div key={m.id} className={cx("scr-team-rank-member", highlightMemberIds?.has(m.id) && "scr-team-rank-member-hit")}>
              <Avatar member={m} size={36} />
              <span className="scr-team-rank-name">{m.nickname}</span>
            </div>
          ))}
        </div>
        <div className="scr-team-rank-stats">
          {/* 승점은 음수도 흔해서(패가 많은 팀) 양수일 때만 부호를 붙여 "+4 / -4"로 읽히게 한다. */}
          <span className="scr-mono scr-rank-stat-primary">
            {entry.points > 0 ? `+${entry.points}` : entry.points}<span className="scr-num-unit">점</span>
          </span>
          <RecordText
            className="scr-team-rank-record"
            plays={entry.plays} wins={entry.wins} losses={entry.losses} draws={entry.draws}
          />
        </div>
      </div>
    </div>
  );
}
