import { useState } from "react";
import { Bell, MoreHorizontal } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { shareThumb, type KakaoShareContent } from "../../utils/kakaoShare";
import type { ActivityNotice, Member } from "../../types";
import { ActivityCard } from "./ActivityCard";
import { classCx } from "../stats/MemberStatRow";
import { cx } from "../../utils/format";

/* 활동에 뜨는 알림 카드(요청: 활동 피드에 알림 유형 추가).
 *
 * 서버는 '무슨 일이 있었나'만 담아 보내고(종류 + 값) 문장은 여기서 만든다 — 리플레이
 * 요약과 같은 원칙이다: 문구를 고치거나 닉네임이 바뀌어도 이미 쌓인 알림이 옛말을 계속
 * 보여주면 안 된다. 그래서 payload에는 회원 id만 있고, 이름·프사는 볼 때 지금 회원
 * 정보에서 푼다.
 *
 * 종류가 늘어도 이 파일만 는다(요청: 앞으로 랭킹 변동 등이 추가될 수도) — 모르는 종류는
 * 조용히 건너뛴다. 옛 화면이 새 알림을 만나도 카드가 깨지는 대신 안 보일 뿐이다. */

export const NOTICE_TITLE = "알림";

/** 이 알림을 한 줄로 부르면 — 목록의 줄 제목이 쓴다. */
export function noticeLine(notice: ActivityNotice, nameOf: (id: string) => string): string {
  const changes = notice.payload?.changes ?? [];
  if (notice.kind === "epithet" && changes.length > 0) {
    const first = nameOf(changes[0].memberId);
    const rest = changes.length - 1;
    return rest > 0 ? `${first} 외 ${rest}명 칭호 변경` : `${first} 칭호 변경`;
  }
  return NOTICE_TITLE;
}

/** 카카오로 내보낼 한 장 — 랭크 변동(rankShiftShareContent)과 같은 얼개다(요청: 알림도 공유).
 *  본문은 바뀐 사람 둘까지만 적는다: 카카오 카드가 두 줄 남짓이라 그 이상은 어차피 잘리고,
 *  전부 보려고 링크를 여는 것이 이 카드가 하는 일이다.
 *  썸네일은 알림 갈래의 것을 쓴다 — 한때 랭크 변동 그림을 빌려 썼는데, 칭호가 바뀌었다는
 *  글에 '랭크 변동'이라 적힌 그림이 붙어 나갔다(지적). 랭크 변동도 같은 그림을 쓴다. */
export function noticeShareContent(
  notice: ActivityNotice, nameOf: (id: string) => string,
): KakaoShareContent {
  const changes = notice.payload?.changes ?? [];
  const summary = changes
    .slice(0, 2)
    .map((c) => `${nameOf(c.memberId)} ${c.to}`)
    .join(" · ") + (changes.length > 2 ? ` 외 ${changes.length - 2}명` : "");
  return {
    title: "칭호 변경",
    description: summary,
    ...shareThumb("notice"),
    link: `${window.location.origin}/?sv=notice&sid=${notice.id}`,
    fallbackText: `[스타게이트] 칭호 변경\n${summary}`,
  };
}

/** 카드 케밥 — 카카오 공유 하나뿐이다(알림은 사람이 지울 것이 아니다). 너 나와·랭크 변동
 *  케밥과 같은 CSS(scr-activity-chal-menu)를 그대로 쓴다. */
export function NoticeMenu({
  notice, nameOf,
}: { notice: ActivityNotice; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="scr-activity-chal-menu">
      <button
        type="button" className="scr-activity-post-menu-btn scr-activity-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝난다 — 안 끊으면 그 클릭이 카드 본체까지 올라간다. */}
          <div
            className="scr-activity-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-activity-chal-menu-drop" role="menu">
            <KakaoShareButton
              variant="menu"
              content={() => noticeShareContent(notice, nameOf)}
              onDone={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function NoticeCard({
  notice, timeText, dateLabel, memberOf, actions, footer,
}: {
  notice: ActivityNotice;
  timeText: string;
  dateLabel?: string;
  memberOf: (id: string) => Member | undefined;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const changes = notice.payload?.changes ?? [];
  if (notice.kind !== "epithet" || changes.length === 0) return null;

  return (
    <ActivityCard
      className="scr-notice-card"
      dateLabel={dateLabel}
      icon={<Bell size={14} />}
      label="칭호 변경"
      timeText={timeText}
      actions={actions}
      comment={footer}
    >
      <ul className="scr-notice-list">
        {changes.map((c) => {
          const member = memberOf(c.memberId);
          return (
            <li className="scr-notice-row" key={c.memberId}>
              {/* 첫 줄은 누가 무엇이 되었나까지 한 번에 읽힌다(요청) — 이름과 칭호 사이는
                  긴 줄표(—)로 끊는다. 가운뎃점으로 끊어도 봤지만 이 줄에는 화살표(→)가
                  이미 있어서, 점만 한 짧은 부호로는 이름의 경계가 안 섰다. */}
              <div className="scr-notice-who">
                {member && <Avatar member={member} size={24} />}
                <span className="scr-notice-name">{member?.nickname ?? c.memberId}</span>
                <span className="scr-notice-sep">—</span>
                {/* 옛 칭호는 있을 때만 — 없다가 생긴 것은 화살표를 붙일 데가 없다(랭크 변동의
                    '진입'과 같은 생각). 그럴 때는 새 칭호 하나만 적는다. */}
                {c.from && (
                  <>
                    <span className="scr-notice-from">{c.from}</span>
                    <span className="scr-notice-arrow">→</span>
                  </>
                )}
                {/* 새 칭호는 등급 색으로(요청: 칭호 변동 본문에도 색) — 통계표와 같은 색이라
                    두 화면이 한 말을 한다. 옛 칭호는 색을 안 준다: 이미 지나간 말이라
                    지금 등급을 말할 자리가 아니다. */}
                <span className={cx("scr-notice-to", classCx(c.to))}>{c.to}</span>
              </div>
              {/* 무엇 때문에 바뀌었나는 아랫줄이다(요청) — 첫 줄이 알리는 말이고 이건 그
                  근거라, 같은 줄에 두면 정작 바뀐 칭호가 문장 가운데에 묻힌다. */}
              {c.why && <div className="scr-notice-why">{c.why}</div>}
            </li>
          );
        })}
      </ul>
    </ActivityCard>
  );
}
