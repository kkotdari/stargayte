import { Bell } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import type { ActivityNotice, Member } from "../../types";
import { ActivityCard } from "./ActivityCard";

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

export default function NoticeCard({
  notice, timeText, dateLabel, memberOf, footer,
}: {
  notice: ActivityNotice;
  timeText: string;
  dateLabel?: string;
  memberOf: (id: string) => Member | undefined;
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
      comment={footer}
    >
      <ul className="scr-notice-list">
        {changes.map((c) => {
          const member = memberOf(c.memberId);
          return (
            <li className="scr-notice-row" key={c.memberId}>
              {member && <Avatar member={member} size={24} />}
              <span className="scr-notice-name">{member?.nickname ?? c.memberId}</span>
              {/* 이름과 칭호 사이는 가운뎃점으로 끊는다(요청) — 굵기만 다른 채 붙어 있으면
                  "군범 개근의 여왕"이 한 사람 이름처럼 읽힌다. 목록 줄에서 쓰는 것과 같은
                  부호라(scr-activity-row-sep) 앱 안에서 뜻이 이어진다. */}
              <span className="scr-notice-sep">·</span>
              {/* 옛 칭호는 있을 때만 — 없다가 생긴 것은 화살표를 붙일 데가 없다(랭크 변동의
                  '진입'과 같은 생각). 그럴 때는 새 칭호 하나만 적는다. */}
              {c.from && (
                <>
                  <span className="scr-notice-from">{c.from}</span>
                  <span className="scr-notice-arrow">→</span>
                </>
              )}
              <span className="scr-notice-to">{c.to}</span>
              {/* 무엇 때문에 바뀌었나 — 통계 표의 칭호에 달리는 근거와 같은 문장이다.
                  좁은 화면에서는 아래 줄로 넘어간다(CSS). */}
              {c.why && <span className="scr-notice-why">{c.why}</span>}
            </li>
          );
        })}
      </ul>
    </ActivityCard>
  );
}
