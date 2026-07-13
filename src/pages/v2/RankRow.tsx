import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import RecordText from "../../components/common/RecordText";
import { cx } from "../../utils/format";
import type { LatestMatch, RankRow as RankRowData } from "./rank";

interface RankRowProps {
  row: RankRowData;
  // 바로 위 행과 공동순위(같은 순위)인지 — 그러면 그 사이 구분선을 그리지 않는다(같은
  // 그룹으로 묶여 보이도록).
  tiedWithPrev?: boolean;
  // 최근 경기 목록 모달(팀랭킹 모달 재활용)을 연다 — row.latestMatch가 있을 때만 호출된다.
  onOpenLatestMatch?: () => void;
}

const OUTCOME_LABEL: Record<LatestMatch["outcome"], string> = { win: "승", loss: "패", draw: "무", notHeld: "미실시" };
// 전적(RecordText)의 승/무/패와 같은 색 계열 — 미실시는 승패 개념이 없어 색을 안 입힌다.
const OUTCOME_CLASS: Record<LatestMatch["outcome"], string | undefined> = {
  win: "scr-record-win", loss: "scr-record-loss", draw: "scr-record-draw", notHeld: undefined,
};

// v2 일대일 랭킹의 한 줄 — #순위 | 프사 | 닉네임 | 전적.
//
// 승률 대신 전적(승/패/무)을 보여준다. 순위를 가르는 기준이 승자승 → 승점 → 공통상대 → 승수로
// 바뀌면서 승률은 정렬에 아무 역할을 하지 않게 됐는데, 그걸 큰 숫자로 붙여두면 "1위인데 왜
// 승률이 낮지?"라고 읽히기만 한다. 전적은 승점(승-패)을 눈으로 셀 수 있어 순서와 어긋나지 않는다.
// 예전 화면의 경기수 막대는 그대로 없다.
//
// 기간을 나누지 않고 전체 경기를 집계하게 되면서 비교할 "직전 기간"이 사라져, 순위 변동
// 표시와 그 상세(최근 추이 그래프 모달)도 함께 없앴다. 대신 최근 일대일 경기 하나("vs 상대
// 승/패")를 전적 아래에 붙이고, 그걸 누르면 그 회원의 일대일 경기 목록 모달(팀랭킹 모달
// 재활용)이 뜬다 — 최근 경기가 없으면(표본 밖) 그 줄 자체가 없고 행도 클릭 대상이 아니다.
export default function RankRowV2({ row, tiedWithPrev = false, onOpenLatestMatch }: RankRowProps) {
  const { member, stats, rank, latestMatch } = row;
  const [photoOpen, setPhotoOpen] = useState(false);

  const openPhoto = (e: MouseEvent) => {
    e.stopPropagation();
    setPhotoOpen(true);
  };

  const clickable = !!latestMatch && !!onOpenLatestMatch;

  return (
    // PhotoViewer는 행 바깥의 형제로 둔다 — createPortal로 body에 그려도 React 합성 이벤트는
    // DOM이 아니라 JSX 트리를 따라 버블링돼서, 행 안(자손)에 두면 그 안의 클릭이 행까지
    // 올라간다(실제로 지적받은 문제).
    <>
      <div className={cx("scr-rank-row", tiedWithPrev && "scr-rank-row-tied")}>
        <div
          className={cx("scr-rank-row-inner", clickable && "scr-rank-row-clickable")}
          onClick={clickable ? onOpenLatestMatch : undefined}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
        >
          <div className="scr-rank-badge">
            {/* 공동순위(같은 순위가 여러 명)일 때는 그 그룹의 첫 행에서만 순위 숫자를 보여주고,
                나머지는 비워둔다(칸 자체는 남겨 높이가 흔들리지 않게 한다). "#"은 팀 카드와
                같은 규칙 — 숫자만 덩그러니 놓이면 무슨 수인지 안 읽힌다. */}
            <span className="scr-rank-num">
              {!tiedWithPrev && <><span className="scr-rank-num-hash">#</span>{rank}</>}
            </span>
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
            {latestMatch && (
              // 상대 이름이 길면 그 이름만 줄여서(말줄임) 상대 이름 앞뒤(vs/승패 표시)는
              // 항상 온전히 보이게 한다 — 예전엔 문장 전체를 한 덩이로 말줄임해서, 이름이
              // 길면 정작 승/패 표시가 잘려서 안 보였다(실제로 지적받은 문제).
              <span className="scr-rank-latest-match">
                <span className="scr-rank-latest-match-label">최근</span>
                <span className="scr-rank-latest-match-vs">vs</span>
                <span className="scr-rank-latest-match-opponent">{latestMatch.opponentLabel}</span>
                <span className={cx("scr-rank-latest-match-outcome", OUTCOME_CLASS[latestMatch.outcome])}>
                  {OUTCOME_LABEL[latestMatch.outcome]}
                </span>
              </span>
            )}
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
