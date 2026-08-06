import { Fragment, type ReactNode } from "react";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { formatWhen } from "../../utils/date";
import type { Challenge } from "../../types";

/* "너 나와!"의 생김새는 한 벌이다(요청: "활동 카드만의 너 나와! 디자인도 걷어내고 지금 쓰고
   있는 편지지양식을 카드에 보여주는걸로"). 인박스 팝업·공유 화면·활동 목록이 모두 이 편지지를
   쓴다 — 예전엔 카드가 제 나름의 로스터(양편을 좌우로 두고 가운데 손 이모지)를 따로 갖고
   있어서, 편지지를 손볼 때마다 같은 이야기를 두 군데서 고쳐야 했다.

   카드에서도 줄이지 않고 그대로 보여준다(요청: "압축없이 똑같이"). */

export type LetterPerson = {
  id: string;
  nickname: string;
  avatar: string | null;
  /** 지목된 쪽만 — 아바타에 수락(✓)·거절(✕) 배지를 단다. */
  response?: string;
};

/** 편지지 모서리의 한 편 — From./To. 라벨과 그 편 전원의 아바타(겹쳐 쌓음), 그 밑에 작은
 *  닉네임(요청: "겹쳐서 보여줘", "아바타 밑에 닉네임도 작게 붙여줘 누군지 모르겠어").
 *
 *  1:1이면 한 장이라 겹칠 것이 없고, 팀전이면 두세 장이 왼쪽으로 조금씩 물려 쌓인다 —
 *  겹친 자리가 구분되도록 아바타마다 편지지 색 테두리를 한 겹 두른다(CSS).
 *
 *  지목된 쪽(To.)은 아바타마다 수락·거절 배지를 단다(요청) — 누가 답했는지는 사람마다
 *  다른데 그것을 말할 자리가 아바타뿐이다. 아직 답이 없으면 배지도 없다. */
export function PartySide({ tag, members, highlight }: {
  tag: "From." | "To.";
  members: LetterPerson[];
  /** 유저 검색에 걸린 사람 — 닉네임을 반전색으로 칠한다. */
  highlight?: Set<string>;
}) {
  if (members.length === 0) return null;
  return (
    <div className={`scr-challenge-party scr-challenge-party-${tag === "From." ? "from" : "to"}`}>
      <span className="scr-challenge-party-tag">{tag}</span>
      <div className="scr-challenge-party-who">
        <div className="scr-challenge-party-stack">
          {members.map((m) => {
            const mark = m.response === "accepted" ? "수락" : m.response === "rejected" ? "거절" : null;
            return (
              <span key={m.id} className="scr-challenge-party-slot">
                <Avatar size={44} className="scr-challenge-party-av" member={m} />
                {mark && (
                  <span
                    className={`scr-challenge-party-badge scr-challenge-party-badge-${m.response}`}
                    title={mark} aria-label={mark} role="img"
                  >
                    {m.response === "accepted" ? "✓" : "✕"}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <span className="scr-challenge-party-names">
          {members.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 && ", "}
              <span className={cx(highlight?.has(m.id) && "scr-roster-hit")}>{m.nickname}</span>
            </Fragment>
          ))}
        </span>
      </div>
    </div>
  );
}

/** 편지지 가운데의 본론 — 부른 사람의 한마디와 그 아래 답한 사람들의 한마디(요청).
 *  팀전이든 1:1이든 같은 모양이고, 아무도 한마디를 안 남겼으면 통째로 빠진다. */
export function ChallengeWords({ from, message, replies }: {
  from: string;
  message: string;
  replies: { memberId: string; nickname: string; responseMessage: string }[];
}) {
  const mine = message.trim();
  if (!mine && replies.length === 0) return null;
  return (
    <div className="scr-challenge-words">
      {mine && (
        <div className="scr-challenge-word">
          <p className="scr-challenge-word-text">{mine}</p>
          <div className="scr-challenge-word-who">— {from}</div>
        </div>
      )}
      {replies.map((t) => (
        <div key={t.memberId} className="scr-challenge-word scr-challenge-word-reply">
          {t.responseMessage.trim() && (
            <p className="scr-challenge-word-text">{t.responseMessage}</p>
          )}
          {/* 수락·거절은 To. 아바타의 배지가 말한다(요청) — 여기선 이름만 밝힌다. */}
          <div className="scr-challenge-word-who">— {t.nickname}</div>
        </div>
      ))}
    </div>
  );
}

/** 약속한 일시 — 날짜와 "언제"를 글로. 응답할 수 있는 사람에게는 이 자리에 입력칸이
 *  대신 들어간다(부르는 쪽이 안 정했으면 답하는 쪽이 정한다). */
export function ChallengeWhen({ challenge }: { challenge: Challenge }) {
  return (
    <>
      <div className="scr-challenge-inbox-date">
        {formatWhen(challenge.scheduledDate, { empty: "일정 미정" })}
      </div>
      {challenge.scheduledTimeNote.trim() && (
        <div className="scr-challenge-inbox-time">{challenge.scheduledTimeNote}</div>
      )}
    </>
  );
}

/** 한 통의 편지지 — From. / 제목·일시·한마디 / To.
 *
 *  일시는 한마디보다 위다(요청, 스크린샷) — 약속이 이 편지의 용건이고 한마디는 그에
 *  붙는 말이라, 용건이 먼저 눈에 들어와야 한다. */
export function ChallengeLetter({
  challenge, reply = false, schedule, foot, highlight,
}: {
  challenge: Challenge;
  /** 응답 공유(?sv=challengeReply) — 한마디를 안 남기고 답만 한 사람도 한 줄로 세운다. */
  reply?: boolean;
  /** 일시 자리 — 인박스는 입력칸, 카드·구경은 그냥 글. */
  schedule?: ReactNode;
  /** 본문 맨 아래에 덧붙일 것 — 카드의 승/무·취소 표시, 인박스의 오류 줄. */
  foot?: ReactNode;
  highlight?: Set<string>;
}) {
  const fromSide: LetterPerson[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: challenge.createdBy.avatar },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const toSide: LetterPerson[] = challenge.targets.map((t) => ({
    id: t.memberId, nickname: t.nickname, avatar: t.avatar, response: t.response,
  }));
  /* 오간 한마디 — 한마디를 남긴 사람만 싣는다(요청). 다만 응답 공유에서는 답했다는 사실
     자체가 이 화면이 열린 이유라, 한마디가 없어도 그 사람 줄은 남긴다. */
  const said = challenge.targets.filter((t) => (
    t.responseMessage.trim() !== ""
    || (reply && t.response !== "pending" && t.response !== "discarded")
  ));
  /* 제목은 실제로 지목된 사람(들)의 닉네임을 쓴다 — 지금 보고 있는 사람(user)을 쓰면,
     요청자 본인이 제 공유 카드를 열었을 때 자기 닉네임이 "OO 너 나와!"로 뜬다(지적). */
  const names = toSide.map((m) => m.nickname);
  const title = names.length > 0 ? `${names.join(", ")} 너 나와!` : "너 나와!";

  return (
    <>
      <PartySide tag="From." members={fromSide} highlight={highlight} />
      <div className="scr-modal-body scr-challenge-inbox-body">
        <div className="scr-challenge-inbox-title">{title}</div>
        {schedule}
        <ChallengeWords
          from={challenge.createdBy.nickname}
          message={challenge.message}
          replies={said}
        />
        {foot}
      </div>
      <PartySide tag="To." members={toSide} highlight={highlight} />
    </>
  );
}
