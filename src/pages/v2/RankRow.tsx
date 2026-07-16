import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import RecordText from "../../components/common/RecordText";
import RankDeltaBadge from "./RankDeltaBadge";
import { cx } from "../../utils/format";
import type { RankRow as RankRowData } from "./rank";

interface RankRowProps {
  row: RankRowData;
  // 바로 위 행과 공동순위(같은 순위)인지 — 그러면 그 사이 구분선을 그리지 않는다(같은
  // 그룹으로 묶여 보이도록).
  tiedWithPrev?: boolean;
  // 카드(행) 전체를 누르면 뜨는 상세(최근 5개월 순위변동 + 경기 이력) 모달(요청).
  onOpenTrend?: () => void;
  // 유저 검색에 걸린 사람 — 경기결과 로스터(.scr-team-player-highlight)와 같은 반전색으로
  // 프사+닉네임을 함께 칠한다(요청: "닉네임뿐 아니라 프사까지 하이라이팅 주고 경기
  // 하이라이트랑 똑같은 css").
  highlighted?: boolean;
}

// v2 일대일 랭킹의 한 줄 — #순위(+전월 대비 변동) | 프사 | 닉네임 | 전적 + 승점.
//
// 승률 대신 전적(승/패/무)과 승점을 보여준다. 순위를 가르는 기준이 승자승 → 간접비교 →
// 승점으로 바뀌면서 승률은 정렬에 아무 역할을 하지 않게 됐고, 승점(승-패)은 간접비교가
// 없을 때 순위를 가르는 최후 기준이라 카드에도 함께 보여준다(요청: "개인 카드에 승점도 표시").
// 예전엔 "최근 vs 상대 승/패" 한 줄을 붙였는데, 이제 일대일 경기 이력 전체를 카드 상세 모달
// (그래프 아래)에서 보여주므로 카드에선 뺐다(요청: "최근 경기 이력말고 일대일 이력 다").
export default function RankRowV2({ row, tiedWithPrev = false, highlighted = false, onOpenTrend }: RankRowProps) {
  const { member, stats, rank, rankDelta } = row;
  const [photoOpen, setPhotoOpen] = useState(false);
  // 승점(승 +1, 무 0, 패 -1) = 승-패. 양수는 +부호로.
  const points = stats.wins - stats.losses;

  const openPhoto = (e: MouseEvent) => {
    e.stopPropagation();
    setPhotoOpen(true);
  };

  return (
    // PhotoViewer는 행 바깥의 형제로 둔다 — createPortal로 body에 그려도 React 합성 이벤트는
    // DOM이 아니라 JSX 트리를 따라 버블링돼서, 행 안(자손)에 두면 그 안의 클릭이 행까지
    // 올라간다(실제로 지적받은 문제).
    <>
      <div className={cx("scr-rank-row", tiedWithPrev && "scr-rank-row-tied")}>
        <div
          className={cx("scr-rank-row-inner", onOpenTrend && "scr-rank-row-clickable", highlighted && "scr-rank-row-hit")}
          onClick={onOpenTrend}
          role={onOpenTrend ? "button" : undefined}
          tabIndex={onOpenTrend ? 0 : undefined}
        >
          <div className="scr-rank-badge">
            {/* 공동순위(같은 순위가 여러 명)일 때는 그 그룹의 첫 행에서만 순위 숫자를 보여주고,
                나머지는 비워둔다(칸 자체는 남겨 높이가 흔들리지 않게 한다). "#"은 팀 카드와
                같은 규칙 — 숫자만 덩그러니 놓이면 무슨 수인지 안 읽힌다. 순위 변동은 그와
                별개로 사람마다 다를 수 있어 공동순위여도 매 행 각자 보여준다(요청: "랭킹에서
                공동순위라도 순위변동은 각각 표시돼야함"). */}
            <span className="scr-rank-num">
              {!tiedWithPrev && <><span className="scr-rank-num-hash">#</span>{rank}</>}
            </span>
            <RankDeltaBadge delta={rankDelta} />
          </div>
          <button type="button" className="scr-rank-avatar-btn" onClick={openPhoto} aria-label={`${member.nickname} 사진 보기`}>
            <Avatar member={member} size={52} />
          </button>
          <div className="scr-rank-name-wrap">
            <span className="scr-rank-name">{member.nickname}</span>
          </div>
          <div className="scr-rank-record-wrap">
            <RecordText
              className="scr-rank-record-v2"
              plays={stats.plays} wins={stats.wins} losses={stats.losses} draws={stats.draws}
            />
            <span className="scr-rank-points">승점 {points > 0 ? `+${points}` : points}</span>
          </div>
        </div>
      </div>
      {photoOpen && member.avatar && createPortal(
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />,
        document.body,
      )}
    </>
  );
}
