import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import Pagination from "../../components/common/Pagination";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import MemberDetailModal from "../../modals/MemberDetailModal";
import CreateMemberModal from "../../modals/CreateMemberModal";
import { cx } from "../../utils/format";
import { useAppStore } from "../../store/appStore";
import { ROLE_INFO, isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import type { Member, MemberRole, MemberStatus } from "../../types";

const PAGE_SIZE = 20;

// 목록 배지 — 그냥 "회원(0203)"만인 경우는 굳이 배지를 보여줄 필요가 없어 운영자(0202)만
// 배지로 보여준다.
const ROLE_BADGE_ORDER: MemberRole[] = ["0202"];
const ROLE_BADGE_CLASS: Partial<Record<MemberRole, string>> = {
  "0202": "scr-status-admin",
};

function memberRoleBadges(roles: MemberRole[]): { role: MemberRole; label: string; className: string }[] {
  return ROLE_BADGE_ORDER
    .filter((r) => roles.includes(r))
    .map((r) => ({ role: r, label: ROLE_INFO[r], className: ROLE_BADGE_CLASS[r]! }));
}

type StatusFilter = "all" | MemberStatus;
const FILTER_OPTS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: "승인대기" },
  { value: "active", label: "활성" },
  { value: "suspended", label: "정지" },
  { value: "withdrawn", label: "탈퇴" },
];

const STATUS_LABEL: Record<MemberStatus, string> = {
  pending: "승인대기",
  active: "활성",
  suspended: "정지",
  withdrawn: "탈퇴",
};

// 운영자 전용 — 회원 목록 조회 + 승인/사용 중지/재개
export default function MembersScreen() {
  const members = useAppStore((s) => s.members);
  const currentUser = useAppStore((s) => s.user);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const canCreateMember = !!currentUser && isAdminRole(currentUser.roles);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const rows = useMemo(() => {
    const list = members.filter((m) =>
      (filter === "all" || m.status === filter) &&
      memberMatchesQuery(m, query));
    // 기본(전체) 목록은 최신 가입순. 특정 상태로 좁혀서 볼 때는 그 상태가 된 시점(승인대기는
    // 사실상 가입 시점과 같고, 활성/정지/탈퇴는 마지막으로 상태가 바뀐 시점) 기준 최신순으로 본다.
    return [...list].sort((a, b) => {
      const aTime = filter === "all" ? a.createdAt : a.updatedAt;
      const bTime = filter === "all" ? b.createdAt : b.updatedAt;
      return bTime.localeCompare(aTime);
    });
  }, [members, filter, query]);

  // 필터가 바뀌면 결과 목록도 바뀌니 1페이지로 되돌린다
  useEffect(() => { setPage(1); }, [filter, query]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="scr-screen scr-members-screen-v2">
      <div className="scr-v2-toolbar scr-members-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">회원</h1>
      </div>

      {/* "생성" 버튼 — 타이틀 줄 아래 별도 줄에 가운데 정렬, 1.2배 확대(요청: "경기 화면의
          등록 버튼, 회원 화면의 생성 버튼과 동일한 CSS"). */}
      {canCreateMember && (
        <div className="scr-v2-primary-row">
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => setCreating(true)}>
            <UserPlus size={14} /> 생성
          </button>
        </div>
      )}

      {/* 경기/랭킹/통계와 똑같은 SearchFilterBar를 그대로 쓴다 — 회원 화면만의 필터/검색
          UI를 따로 두지 않는다(요청: "회원/게임아이디만의 요소가 없도록"). 기간/경기번호
          개념이 없어 넘기지 않는다. */}
      <SearchFilterBar
        count={rows.length}
        countLabel="명"
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="유저 검색"
        suggestions={suggestions}
        showSearch={false}
        filterPanel={
          <FilterItem label="상태">
            <PillTabs options={FILTER_OPTS} value={filter} onChange={setFilter} aria-label="회원 상태" />
          </FilterItem>
        }
      />

      <div className="scr-members-list-v2">
        {rows.length === 0 && <div className="scr-empty">표시할 회원이 없어요.</div>}

        <div className="scr-member-rows">
          {pageRows.map((m) => (
            <button type="button" key={m.id} className="scr-member-row" onClick={() => setSelected(m)}>
              <Avatar member={m} size={36} />
              <div className="scr-member-row-main">
                <span className="scr-member-row-name">{m.nickname}</span>
                <span className="scr-member-row-tag scr-mono">{m.battletag}</span>
              </div>
              {memberRoleBadges(m.roles).map((badge) => (
                <span key={badge.role} className={cx("scr-status-badge", badge.className)}>{badge.label}</span>
              ))}
              <span className={cx("scr-status-badge", `scr-status-${m.status}`)}>{STATUS_LABEL[m.status]}</span>
            </button>
          ))}
        </div>

        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {selected && (
        <MemberDetailModal
          member={rows.find((m) => m.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
        />
      )}

      {creating && <CreateMemberModal onClose={() => setCreating(false)} />}
    </div>
  );
}
