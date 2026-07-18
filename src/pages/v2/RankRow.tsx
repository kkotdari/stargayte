import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
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

// v2 일대일 랭킹의 한 줄 — #순위(+전월 대비 변동) | 프사 | 닉네임 | 점수(참가+우열).
//
// 순위를 가르는 기준이 '사람 단위 점수'(붙어본 상대별로 이기면 3 / 비기면 2 / 지면 1점 합산
// = 참가점수 + 우열점수)라, 카드에도 그 합계를 큼직하게 싣고 아래에 참가/우열 두 갈래를
// 보여준다. 예전엔 "최근 vs 상대 승/패" 한 줄을 붙였는데, 이제 일대일 경기 이력 전체를 카드
// 상세 모달(그래프 아래)에서 보여주므로 카드에선 뺐다(요청).
export default function RankRowV2({ row, tiedWithPrev = false, highlighted = false, onOpenTrend }: RankRowProps) {
  const { member, personScore, superiorCount, equalCount, inferiorCount, rank, rankDelta } = row;
  const [photoOpen, setPhotoOpen] = useState(false);
  // 점수 = 참가점수(상대 한 명당 2점) + 우열점수(우세 - 열세). 붙어본 상대별로 이기면 3 /
  // 비기면 2 / 지면 1점을 받은 것과 같다. 헤드라인엔 합계를, 아래엔 두 갈래를 보여준다.
  const participation = 2 * (superiorCount + equalCount + inferiorCount);
  const winloss = personScore; // 우열점수
  const total = participation + winloss;
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

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
          {/* 점수/전적을 팀 랭킹 카드와 같은 배치로 통일 — 사람단위 점수를 위에 큼직하게
              ("+N점"), 전적을 그 아래에. 이 점수가 순위(승자승 다음)를 가르는 기준이라 숫자로
              도드라지게 한다. */}
          <div className="scr-rank-record-wrap">
            <span className="scr-mono scr-rank-stat-primary">
              {signed(total)}<span className="scr-num-unit">점</span>
            </span>
            {/* 점수의 두 갈래 — 참가점수(붙은 사람 수 기반)와 우열점수(우세-열세)로 나눠 보여준다(요청). */}
            <span className="scr-mono scr-rank-record-v2 scr-rank-superiority">
              <span className="scr-num-unit">참가</span> {participation}{"  "}
              <span className="scr-num-unit">우열</span> {signed(winloss)}
            </span>
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
