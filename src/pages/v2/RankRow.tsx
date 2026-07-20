import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Send } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import PhotoViewer from "../../components/common/PhotoViewer";
import RankDeltaBadge from "./RankDeltaBadge";
import { cx } from "../../utils/format";
import type { RankRow as RankRowData } from "./rank";
import type { Member } from "../../types";

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
  // 닉네임 옆 주먹 버튼 — 그 상대를 바로 지목한 도전장 작성 모달을 띄운다(요청: "랭킹카드에
  // 바로 그 상대로 도전장 띄우는 버튼 추가 닉네임 옆에"). 본인 행에는 안 넘겨줘서 버튼 자체가
  // 안 뜬다.
  onChallenge?: (member: Member) => void;
  // 이 기간 경기수 순위(1~3) — 닉네임 옆에 "경기수N위" 글자 배지를 붙이고 닉네임을 파스텔
  // 분홍 메탈색으로 칠한다(요청). 순위(메달 1~3위)이기도 하면 메달색↔분홍을 느리게 교대.
  gamesRank?: number;
}

// v2 일대일 랭킹의 한 줄 — #순위(+전월 대비 변동) | 프사 | 닉네임 | 점수(참가+우열).
//
// 순위를 가르는 기준이 '사람 단위 점수'(붙어본 상대별로 이기면 3 / 비기면 2 / 지면 1점 합산
// = 참가점수 + 우열점수)라, 카드에도 그 합계를 큼직하게 싣고 아래에 참가/우열 두 갈래를
// 보여준다. 예전엔 "최근 vs 상대 승/패" 한 줄을 붙였는데, 이제 일대일 경기 이력 전체를 카드
// 상세 모달(그래프 아래)에서 보여주므로 카드에선 뺐다(요청).
// 1~3위 닉네임 색 — 글로우 대신 금/은/동 메탈 폰트색으로(요청: "글로우 제거 대신 1위
// 닉네임은 금색 메탈 늒낌 2위는 은색 메탈 느낌 3위는 동색 메탈느낌", "폰트색 말하는것").
const MEDAL_NAME_CLASS: Record<number, string> = {
  1: "scr-rank-name-gold",
  2: "scr-rank-name-silver",
  3: "scr-rank-name-bronze",
};

export default function RankRowV2({ row, tiedWithPrev = false, highlighted = false, onOpenTrend, onChallenge, gamesRank }: RankRowProps) {
  const { member, rankScore, rank, rankDelta, provisional } = row;
  const [photoOpen, setPhotoOpen] = useState(false);
  // 닉네임 색: 메달(1~3위)이면서 경기수 상위면 메달메탈↔분홍메탈을 느리게 교대(요청: 메달
  // 2초 → 1초 페이드 → 분홍 2초 → 1초 페이드). 메달만이면 메달색, 경기수 상위만이면 분홍,
  // 그 외엔 기본색.
  const isGamesTop = gamesRank !== undefined;
  const medalClass = MEDAL_NAME_CLASS[rank];
  const isMedalGames = medalClass !== undefined && isGamesTop;
  const nameClass = cx(
    medalClass ?? (isGamesTop ? "scr-rank-name-games" : undefined),
    isMedalGames && "scr-rank-name-games-medal",
  );
  // 카드엔 총점만 보여주고(세부는 랭킹 상세에서 — 요청), 경기마다 가중 합산이라 음수도 가능하다.
  // 항상 양수가 아니므로 +부호는 안 붙이고(양수는 그대로), 음수는 자연히 - 가 붙는다.

  const openPhoto = (e: MouseEvent) => {
    e.stopPropagation();
    setPhotoOpen(true);
  };

  const challenge = (e: MouseEvent) => {
    e.stopPropagation();
    onChallenge?.(member);
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
              {!tiedWithPrev && rank}
            </span>
            <RankDeltaBadge delta={rankDelta} />
          </div>
          <button type="button" className="scr-rank-avatar-btn" onClick={openPhoto} aria-label={`${member.nickname} 사진 보기`}>
            <Avatar member={member} size={40} />
          </button>
          <div className="scr-rank-name-wrap">
            <span className={cx("scr-rank-name", nameClass)} data-name={member.nickname}>{member.nickname}</span>
            {isGamesTop && <span className="scr-rank-games-badge">참가{gamesRank}위</span>}
            {onChallenge && (
              <button
                type="button" className="scr-rank-challenge-btn" onClick={challenge}
                aria-label={`${member.nickname}에게 너 나와! 신청`}
              >
                <Send size={16} />
              </button>
            )}
          </div>
          {/* 점수/전적을 팀 랭킹 카드와 같은 배치로 통일 — 사람단위 점수를 위에 큼직하게
              ("+N점"), 전적을 그 아래에. 이 점수가 순위(승자승 다음)를 가르는 기준이라 숫자로
              도드라지게 한다. */}
          <div className="scr-rank-record-wrap scr-rank-record-wrap-scoreonly">
            {/* 잠정 뱃지는 자기 칸을 따로 차지하지 않고(요청: "필터의 라벨처럼 영역을
                차지하지 않고 붙어있는 추가 요소로") 점수에 절대위치로 겹쳐 붙는다 —
                레이아웃 흐름에서 완전히 빠져 있어 잠정 유무와 무관하게 다른 요소 위치가
                흔들리지 않는다. 바깥 wrap은 그리드 칸 너비만큼 늘어나 있어서(justify-self:
                stretch) 그 기준으로 절대위치를 잡으면 실제 점수 숫자와 멀리 떨어져 보인다
                (요청: "잠정배지가 ...wrap 이거 밖에 있고 안으로 못들어가서 멀리 떨어져
                보여") — 점수 글자 폭만큼만 딱 맞는 인라인 래퍼를 하나 더 둬서 그 기준으로
                붙인다. */}
            <span className="scr-rank-score-inline">
              {provisional && <span className="scr-rank-provisional">잠정</span>}
              {/* 카드엔 레이팅(보수추정 μ−3σ)만(세부는 상세에서). 음수면 자연히 - 가 붙는다. */}
              <span className="scr-rank-stat-primary">
                {rankScore}<span className="scr-num-unit">점</span>
              </span>
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
