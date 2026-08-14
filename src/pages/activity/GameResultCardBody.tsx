import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import GameResultStory from "./GameResultStory";
import { outcomeFor, teamSummaryName } from "./GameResultSides";
import { cleanMapName } from "../../utils/mapName";
import { shareThumb } from "../../utils/kakaoShare";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import type { GameResult, Member, GameResultSlot, GameOutcome } from "../../types";

// 케밥 메뉴의 카카오톡 공유에 쓸 경기 요약 — 양 팀 이름과 결과/맵/날짜.
function gameResultShareContent(gameResult: GameResult, memberOf: (id: string) => Member | undefined): KakaoShareContent {
  const t1 = teamSummaryName(gameResult.team1, memberOf) || "팀1";
  const t2 = teamSummaryName(gameResult.team2, memberOf) || "팀2";
  const resultLabel =
    gameResult.result === "draw" ? "무승부"
    : gameResult.result === "not_held" ? "미실시"
    : `${outcomeFor("team1", gameResult.result) === "win" ? t1 : t2} 승`;
  const cleanedMap = cleanMapName(gameResult.mapName);
  const mapPart = cleanedMap ? ` · ${cleanedMap}` : "";
  return {
    title: `${t1} vs ${t2}`,
    description: `${resultLabel}${mapPart} · ${gameResult.date}`,
    ...shareThumb("gameResult"),
    /* 직접 주소로(요청: 게임은 공유 주소(sv) 말고 페이지 주소) — 게임 상세가 주소를
       가진 페이지가 되면서, 카톡 링크도 그 페이지로 바로 들어간다. */
    link: `${window.location.origin}/?screen=activity&group=gameResult&game=${gameResult.id}`,
    fallbackText: `[스타게이트 게임결과]\n${t1} vs ${t2}\n결과: ${resultLabel}${mapPart}\n${gameResult.date}`,
  };
}

export interface SearchListRow {
  id: number;
  date: string;
  team1: GameResultSlot[];
  team2: GameResultSlot[];
  result: GameOutcome;
  raw: GameResult;
}

interface GameResultCardBodyProps {
  rows: SearchListRow[];
  memberOf: (id: string) => Member | undefined;
  /** 지운 경기의 id — 부르는 쪽이 목록에서 그 한 판만 빼낸다(요청: 새로고침 말고).
   *  API가 성공한 뒤에만 부른다. */
  onDeleted: (id: number) => void;
  // 유저 검색 중이면 그 회원(들)을 로스터에서 하이라이트 표시한다
  highlightMemberIds?: Set<string>;
  // memberId 매칭에 더해 표시 이름을 검색어로도 매칭해 하이라이트한다(별칭/비회원 보완).
  highlightTerms?: string[];
  // 지금 실제로 보이는 카드인가(접힌 묶음 안의 투명한 사본이면 false) — 미니맵 타임라인의
  // 자동재생을 그때만 돌린다.
  active?: boolean;
}

// 첨부된 리플레이 파일을 목록에서 바로 내려받는다 — 경기상세(GameResultDetailModal)/수정
// (GameResultModal)과 같은 방식(blob → 임시 a태그 클릭).
async function downloadReplay(gameResult: GameResult) {
  if (!gameResult.replay) return;
  try {
    const blob = await api.downloadReplay(gameResult.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = gameResult.replay.displayName;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // 목록 카드의 짧은 액션이라 별도 에러 표시 영역을 두지 않는다(경기상세와 같은 원칙).
  }
}

// 카드 오른쪽 세로점세개(⋮) — 누르면 메모/리플레이 저장/삭제를 드롭다운 메뉴로 연다(요청).
// 위치/뒤집기는 다른 드롭다운과 같은 attachPopover, 바깥 클릭/포커스 이동으로 닫는다.
function GameResultActionsMenu({
  gameResult, canDelete, memberOf, onDelete,
}: {
  gameResult: GameResult; canDelete: boolean; memberOf: (id: string) => Member | undefined;
  onDelete: (m: GameResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect(페인트 전) — 위치를 첫 페인트 전에 잡아, 엉뚱한 자리에서 한 프레임
  // 늦게 뜨거나 튀어 보이지 않고 즉시 제자리에 뜬다(요청: "즉시 뜨길 기대").
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growToContent: true, maxWidth: 200 });
  }, [open]);
  // 바깥을 눌러 닫는 일은 아래 백드롭(전체 화면 투명 판)이 맡는다 — 예전엔 document의
  // pointerdown으로 닫았는데, 그러면 '닫기'만 되고 그 뒤에 이어지는 click은 그대로
  // 카드 본체까지 가서 묶음이 같이 펼쳐지거나 접혔다(지적: 케밥만 닫히고 끝나야 한다).
  // pointerdown이 메뉴를 닫아 버리니 백드롭은 click이 오기도 전에 사라져 막을 수가 없다.
  // 백드롭 하나로 통일하면 그 판이 클릭을 삼키므로 '닫기'에서 정확히 끝난다(활동의 다른
  // 메뉴들과 같은 방식).

  const items: { key: string; label: string; danger?: boolean; onSelect: () => void }[] = [
    ...(gameResult.replay ? [{ key: "download", label: "리플레이 저장", onSelect: () => void downloadReplay(gameResult) }] : []),
    ...(canDelete ? [{ key: "delete", label: "삭제", danger: true, onSelect: () => onDelete(gameResult) }] : []),
  ];

  return (
    <div className="scr-activity-post-menu">
      <button
        type="button" ref={anchorRef}
        className="scr-activity-post-menu-btn scr-activity-kebab-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && createPortal(
        // 포털이라도 이벤트는 리액트 트리를 따라 올라간다 — 묶음 목록의 '접기'가 같이
        // 눌리지 않게 백드롭과 드롭 양쪽에서 끊는다(위 시트와 같은 이유).
        <>
          <div
            /* 상세 팝업(z 130)·확대창 안에서도 닫혀야 한다(지적: 다른 데를 눌러도 안 닫힘)
               — 기본 백드롭(z 89)은 그 창들 밑에 깔려 클릭을 못 받았다. 드롭(500) 바로
               아래 층의 백드롭을 쓴다. */
            className="scr-activity-add-backdrop scr-menu-pop-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
        <div
          className="scr-menu-pop-drop scr-activity-post-menu-drop scr-scroll" ref={dropRef} role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it) => (
            <button
              key={it.key} type="button" role="menuitem"
              className={cx("scr-menu-pop-opt", it.danger && "scr-activity-post-menu-opt-danger")}
              onClick={(e) => { e.stopPropagation(); it.onSelect(); setOpen(false); }}
            >
              {it.label}
            </button>
          ))}
          {/* 이 경기 결과를 카카오톡으로 공유(요청). 누르면 메뉴를 닫는다. */}
          <KakaoShareButton
            variant="menu"
            content={() => gameResultShareContent(gameResult, memberOf)}
            onDone={() => setOpen(false)}
          />
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// 예전엔 여기 사람별 총합 스탯 표와, 그걸 띄우는 전체화면 시트(시간축 그래프 포함)가
// 있었다 — 통째로 걷어냈다(요청: 기능 삭제).

// 활동 카드(GameResultCard)의 본문 — 경기 한 장의 로스터·요약·케밥을 그린다. 이름은 목록이지만
// 이제 '목록 화면'은 없다: 예전에 이걸 날것으로 쓰던 카톡 단일 경기 공유도 활동 카드를
// 그대로 쓰게 바뀌어(요청), 부르는 곳은 GameResultCard 하나뿐이다. 그래서 날짜 그룹 머리글·
// 로딩 스피너·비-매치업 로스터처럼 '목록'이던 시절의 갈래는 다 걷어냈다(요청: 잘못
// 쓰이지 않게) — 다시 목록으로 쓰려면 그때 필요한 것만 되살리는 편이 낫다.
export default function GameResultCardBody({
  rows, memberOf, onDeleted, highlightMemberIds, highlightTerms, active = true,
}: GameResultCardBodyProps) {
  const user = useAppStore((s) => s.user);
  const deleteGameResultAction = useAppStore((s) => s.deleteGameResult);
  // 삭제는 운영자만 — 카드의 메모(연필)와 달리 실제 경기 기록 자체를 지우는 동작이라
  // 작성자 본인이어도 허용하지 않는다(오삭제 방지, 경기상세 모달의 canDelete와 동일 기준).
  const canDelete = !!user && isAdminRole(user.roles);
  const [deleteTarget, setDeleteTarget] = useState<GameResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  // 카드 안에서 펼치던 상세(스탯 표)는 없앴다(요청) — 그래서 로우 자체의 펼침/접힘도
  // 통째로 사라졌다. 게임번호·등록자는 펼쳐야 보이던 걸 늘 보이는 자리로 올렸다(요청).

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      await deleteGameResultAction(deleteTarget.id);
      // 서버가 실제로 지운 뒤에만 알린다(요청) — 실패하면 아래 catch로 떨어져 목록은
      // 그대로 남는다. 목록 전체를 다시 받지 않고 이 한 판만 빠지게 하려고 id를 넘긴다.
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      onDeleted(deletedId);
    } catch (e) {
      // 실패를 확인창 안에 남긴다 — 예전엔 catch가 없어 요청이 깨지면 오류가 그대로
      // 밖으로 새고(unhandled rejection) 창은 그 자리에 그대로 떠 있었다. 누르는 쪽에서는
      // 삭제 버튼이 죽은 것처럼 보였다(지적: "조용히 오류남 페이지가 멈춤").
      setDeleteErr(e instanceof Error ? e.message : "삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="scr-game-result-list-panel-v2">
      <div className="scr-game-result-cards">
        {rows.map((r) => (
              <div key={r.id} className="scr-game-result-trow">
                {/* 윗줄 — 이제 오른쪽 위 케밥메뉴만 남는다. 게임번호는 감췄고(요청),
                    등록자는 카드 머리의 시각 옆으로 옮겼다(요청). */}
                <div className="scr-game-result-trow-topline">
                  <div className="scr-game-result-trow-topmeta">
                    <GameResultActionsMenu
                      gameResult={r.raw} canDelete={canDelete} memberOf={memberOf}
                      onDelete={setDeleteTarget}
                    />
                  </div>
                </div>
                {/* 로스터·미니맵·타임라인·요약 — 한 상태를 함께 쓰는 한 덩어리라 통째로
                    GameResultStory가 맡는다(타임라인의 스냅을 고르면 미니맵과 요약 문장이
                    같이 따라와야 한다). */}
                <GameResultStory
                  gameResult={r.raw} team1={r.team1} team2={r.team2} result={r.result}
                  memberOf={memberOf} active={active}
                  highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
                  /* 확대 창에도 케밥이 있어야 한다(요청: PC 기본이 확대) — 카드 윗줄의
                     메뉴와 같은 것을 하나 더 만들어 내려보낸다. */
                  menu={(
                    <GameResultActionsMenu
                      gameResult={r.raw} canDelete={canDelete} memberOf={memberOf}
                      onDelete={setDeleteTarget}
                    />
                  )}
                />
              </div>
        ))}
      </div>

      {/* 확인창도 이 컴포넌트 안(=묶음 목록 안)에서 그려진다 — 클릭이 목록으로 올라가면
          지울지 묻는 중에 목록이 접힌다. 감싸서 끊는다. */}
      {deleteTarget && (
        <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          title="게임결과를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={deleting ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          error={deleteErr}
          onConfirm={confirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteErr(null); }}
        />
        </div>
      )}
    </div>
  );
}
