import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import MatchList, { type SearchListRow } from "../pages/v2/MatchList";
import MatchMemoModal from "./MatchMemoModal";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Match, MatchType, Member } from "../types";

interface TeamMatchesModalProps {
  // 서버가 개인 승점 높은 순으로 정렬해준 그대로 — 헤더에 닉네임을 이 순서로 나열한다.
  // 일대일 랭킹에서 재사용할 때는 members가 회원 한 명뿐인 배열이다.
  members: Member[];
  // 일대일 랭킹에서 재사용할 때만 넘긴다 — 그 회원의 "일대일" 경기만 보여줘야 하므로
  // (팀전에서의 개인 전적은 섞지 않는다). 팀 랭킹에서 쓸 때는 안 넘겨 전부 보여준다.
  matchType?: MatchType;
  // 챌린지의 "결과 보기"에서 재사용할 때만 넘긴다 — 그 도전장에 잡힌 날짜에 등록된
  // 경기만 보여줘야 하므로(같은 팀 구성으로 다른 날 뛴 경기까지 섞이면 헷갈린다).
  dateFrom?: string;
  dateTo?: string;
  // 팀 랭킹에서 재사용할 때는 로스터 반전색 강조가 "누가 이 팀이었는지" 알려주는
  // 용도라 필요하지만, 챌린지의 "결과 보기"는 이미 그 도전장 카드 자체가 팀 구성을
  // 보여주고 있어 중복이라 꺼둔다(요청: "결과 보기에서 강조 표시 없애기"). 기본값은
  // 랭킹 쪽 기존 동작을 그대로 유지하도록 true.
  highlightMembers?: boolean;
  onClose: () => void;
}

// 팀 랭킹에서 팀 하나를 눌렀을 때 뜨는 경기 목록 — 그 구성원들이 전부 "같은 편"으로 뛴
// 경기만 서버가 추려준다(teamMemberIds). 목록 자체는 경기 화면이 쓰는 v2 MatchList를 그대로
// 재사용한다 — 카드 모양/메모/다운로드/삭제까지 전부 같은 동작이라 여기서 다시 만들 이유가 없다.
//
// 경기 화면과 달리 무한스크롤은 두지 않는다 — 한 팀이 함께 뛴 경기는 많아야 수십 건이라
// 한 번에 받아 보여주고, 그보다 많으면 최근 것부터 100건까지만 보여준다.
const PAGE_LIMIT = 100;

export default function TeamMatchesModal({
  members, matchType, dateFrom, dateTo, highlightMembers = true, onClose,
}: TeamMatchesModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);

  const [matches, setMatches] = useState<Match[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [memoMatch, setMemoMatch] = useState<Match | null>(null);

  const memberIds = members.map((m) => m.id);
  // 배열은 렌더마다 새 참조라 그대로 의존성에 두면 무한 재조회가 된다 — 내용만 문자열로 비교한다.
  const memberIdsKey = memberIds.join(",");

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    api.getMatchesPage({ teamMemberIds: memberIdsKey.split(","), matchType, dateFrom, dateTo, limit: PAGE_LIMIT })
      .then((page) => {
        if (cancelled) return;
        setMatches(page.items);
        setTotal(page.total ?? page.items.length);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "경기를 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memberIdsKey, matchType, dateFrom, dateTo]);

  useEffect(() => reload(), [reload]);

  const rows: SearchListRow[] = matches.map((m) => (
    { id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }
  ));

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      {/* 카드 안쪽 클릭이 오버레이까지 올라가 모달을 닫아버리지 않게 막는다. */}
      <div className="scr-modal scr-modal-team-matches" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span className="scr-team-matches-title">
            {members.map((m) => m.nickname).join(" · ")}
            {total !== null && <span className="scr-team-matches-count">{total}경기</span>}
          </span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {err && <div className="scr-err">{err}</div>}
          {/* 이 팀 구성원을 로스터에서 반전색으로 짚어준다 — 4:4 경기라면 카드 안에 여덟 명이
              들어가서 누가 이 팀이었는지 한눈에 안 보인다(팀 랭킹 카드의 검색 하이라이트와 같은 원칙). */}
          <MatchList
            rows={rows}
            memberOf={memberOf}
            onMemo={setMemoMatch}
            onDeleted={reload}
            loading={loading}
            highlightMemberIds={highlightMembers ? new Set(memberIds) : undefined}
          />
        </div>
      </div>

      {memoMatch && (
        <MatchMemoModal
          match={memoMatch}
          onClose={() => setMemoMatch(null)}
          onSaved={() => { setMemoMatch(null); reload(); }}
        />
      )}
    </div>,
    document.body,
  );
}
