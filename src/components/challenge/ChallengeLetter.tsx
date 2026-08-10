import { Fragment, type ReactNode } from "react";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { formatWhen, scheduledInstantMs, serverMs } from "../../utils/date";
import type { Challenge } from "../../types";

/* "너 나와!"의 생김새는 한 벌이다(요청: "활동 카드만의 너 나와! 디자인도 걷어내고 지금 쓰고
   있는 편지지양식을 카드에 보여주는걸로"). 인박스 팝업·공유 화면·활동 목록이 모두 이 편지지를
   쓴다 — 예전엔 카드가 제 나름의 로스터(양편을 좌우로 두고 가운데 손 이모지)를 따로 갖고
   있어서, 편지지를 손볼 때마다 같은 이야기를 두 군데서 고쳐야 했다.

   카드에서도 줄이지 않고 그대로 보여준다(요청: "압축없이 똑같이"). */

/** 지목된 사람의 응답을 아바타 배지에 적을 낱말. */
const RESPONSE_LABEL: Record<string, string> = {
  accepted: "수락", rejected: "거절", discarded: "버림", pending: "대기",
};

export type LetterPerson = {
  id: string;
  nickname: string;
  avatar: string | null;
  /** 지목된 쪽만 — 아바타에 "수락/거절/대기" 배지를 단다. */
  response?: string;
};

/** 편지지 모서리의 한 편 — From./To. 라벨과 그 편 전원의 아바타(겹쳐 쌓음), 그 밑에 작은
 *  닉네임(요청: "겹쳐서 보여줘", "아바타 밑에 닉네임도 작게 붙여줘 누군지 모르겠어").
 *
 *  1:1이면 한 장이라 겹칠 것이 없고, 팀전이면 두세 장이 왼쪽으로 조금씩 물려 쌓인다 —
 *  겹친 자리가 구분되도록 아바타마다 편지지 색 테두리를 한 겹 두른다(CSS).
 *
 *  지목된 쪽(To.)은 아바타마다 배지를 단다(요청) — 누가 어떻게 답했는지는 사람마다 다른데
 *  그것을 말할 자리가 아바타뿐이다. 예전엔 ✓/✕ 기호였는데 안 와닿는다는 지적으로 낱말을
 *  넣고 배지를 조금 키웠다(요청: "v/x 대신 수락/거절/대기"). 아직 답이 없는 사람도 "대기"로
 *  적는다 — 빈자리로 두면 '이 사람은 뭐지'가 된다. */
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
            const mark = m.response ? RESPONSE_LABEL[m.response] : undefined;
            return (
              <span key={m.id} className="scr-challenge-party-slot">
                <Avatar size={44} className="scr-challenge-party-av" member={m} />
                {mark && (
                  <span className={`scr-challenge-party-badge scr-challenge-party-badge-${m.response}`}>
                    {mark}
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

/** 부른 사람의 한마디 — 편지지 가운데 맨 위. 안 남겼으면 통째로 빠진다. */
export function ChallengeWords({ from, message }: { from: string; message: string }) {
  const mine = message.trim();
  if (!mine) return null;
  return (
    <div className="scr-challenge-words">
      <div className="scr-challenge-word scr-challenge-word-call">
        <p className="scr-challenge-word-text">{mine}</p>
        <div className="scr-challenge-word-who">— {from}</div>
      </div>
    </div>
  );
}

/** 약속한 일시 — 제목 줄 오른쪽에 값만 적는다(요청: "날짜 언제 라벨 제거하고 제목줄로
 *  이동, 글자 1스텝 축소").
 *
 *  라벨을 뗀 이유는 그 자리가 제목 옆이라서다. 편지 한가운데에 홀로 있을 때는 "날짜"·"언제"가
 *  무엇을 가리키는지 말해 줘야 했지만, "팍규 너 나와!" 바로 옆에 붙은 "오늘 · 오후 8시 30분
 *  이후"는 그 자체로 언제 붙자는 말로 읽힌다.
 *
 *  응답할 수 있는 사람에게는 이 자리 대신 본문에 입력칸이 들어간다(부르는 쪽이 안 정했으면
 *  답하는 쪽이 정한다) — 그건 호출부가 schedule로 넣는다. */
export function ChallengeWhen({ challenge }: { challenge: Challenge }) {
  const note = challenge.scheduledTimeNote.trim();
  return (
    <div className="scr-challenge-when">
      <span className="scr-challenge-when-value">
        {formatWhen(challenge.scheduledDate, { empty: "일정 미정" })}
      </span>
      {note && (
        <>
          <span className="scr-challenge-when-sep" aria-hidden>·</span>
          <span className="scr-challenge-when-value">{note}</span>
        </>
      )}
    </div>
  );
}

/** 답한 사람들이 남긴 한마디 — 그것만 세로로 늘어놓는다(요청: "응답자 아바타 밑에는 기존
 *  응답 상태 다 제거하고 등록된 응답 한마디들만 표시").
 *
 *  예전엔 "1명 수락함" 같은 상태 줄이 무리마다 서고 그 아래 한마디가 딸렸는데, 누가 어떻게
 *  답했는지는 이제 To. 아바타의 배지가 사람마다 직접 말하고, 이 대결이 어떻게 됐는지는 맨
 *  아랫줄이 말한다. 같은 사실을 세 군데서 말할 이유가 없다. */
export function ChallengeReplies({ targets }: { targets: Challenge["targets"] }) {
  const said = targets.filter((t) => t.responseMessage.trim() !== "");
  if (said.length === 0) return null;
  return (
    <div className="scr-challenge-words scr-challenge-words-reply">
      {said.map((t) => (
        <div key={t.memberId} className="scr-challenge-word scr-challenge-word-reply">
          <p className="scr-challenge-word-text">{t.responseMessage}</p>
          <div className="scr-challenge-word-who">— {t.nickname}</div>
        </div>
      ))}
    </div>
  );
}

/** 이 대결이 지금 어디까지 왔나 — 편지지 맨 아랫줄 한 줄(요청: "응답 기다리는 중/만료/취소/
 *  준비중/누구 승(또는 무승부)/미실시 — 이건 경기 최종 상태니까 맨 아랫줄에 표시하는 걸로
 *  하고, 배지 아니고 텍스트로 통일").
 *
 *  아바타 배지가 '사람마다 어떻게 답했나'를 말한다면 이 줄은 '이 건이 어떻게 됐나'를 말한다.
 *  그래서 둘은 겹치지 않는다 — 셋이 다 수락해도 이 줄은 "준비중"이고, 결과가 들어오면
 *  "OO 승"으로 바뀐다. */
export function challengeOutcome(c: Challenge): { text: string; tone: string } {
  if (c.resultWinnerSide === "draw") return { text: "무승부", tone: "draw" };
  if (c.resultWinnerSide === "not_held") return { text: "미실시", tone: "expired" };
  if (c.resultWinnerSide === "creator" || c.resultWinnerSide === "target") {
    const won = c.resultWinnerSide === "creator"
      ? [c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname)]
      : c.targets.map((t) => t.nickname);
    return { text: `${won.join(", ")} 승`, tone: "win" };
  }
  if (c.status === "pending") return { text: "응답 기다리는 중", tone: "pending" };
  if (c.status === "confirmed") return { text: "준비중", tone: "accepted" };
  // 여기부터는 폐기(휴지통)된 건이다. 부른 사람이 거둬들였으면 취소, 아무도 답하지 않은
  // 채 마감이 지났으면 만료, 그 밖은 누군가 거절하거나 버린 것이다.
  // 그 마지막을 "거절함"이 아니라 "성사 안 됨"으로 되돌린다(요청) — 이 줄이 말하는 것은
  // 사람의 행동이 아니라 이 건의 끝이고("만료"·"취소"와 같은 층), 누가 거절했는지는 바로
  // 위 To. 아바타의 배지가 사람마다 이미 말한다.
  if (c.canceledBy) return { text: "취소", tone: "canceled" };
  if (c.targets.every((t) => t.response === "pending")) return { text: "만료", tone: "expired" };
  return { text: "성사 안 됨", tone: "rejected" };
}

/** 응답 마감 = 부른 때 + 24시간, 다만 예정 시각이 그보다 먼저면 그 시각(백엔드와 같은 기준).
 *  아직 답을 기다리는 호출에만 셀 것이 있다. */
const CHALLENGE_EXPIRE_MS = 24 * 60 * 60 * 1000;

/** "17시간 후 마감" — 남은 시간이 없거나 이미 답이 온 건이면 null.
 *
 *  serverMs로 읽는다 — 서버가 주는 시각 문자열에는 시간대 표시가 없어서, 그대로 new Date에
 *  넣으면 브라우저가 제 지역시(한국이면 UTC+9)로 읽어 마감이 9시간 앞당겨진다.
 *
 *  초 단위 시계는 안 돌린다(요청: 실시간 변동 X) — 한 시간이 안 남았을 때만 분으로 적는다.
 *  그때는 "0시간 후"가 되어 버려서 말이 안 된다. */
function deadlineLeft(c: Challenge): string | null {
  if (c.status !== "pending") return null;
  const base = serverMs(c.createdAt) + CHALLENGE_EXPIRE_MS;
  const scheduled = scheduledInstantMs(c);
  const remain = (scheduled !== null ? Math.min(base, scheduled) : base) - Date.now();
  if (remain <= 0) return null;
  const minutes = Math.floor(remain / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간` : `${Math.max(1, minutes)}분`;
}

/** 맨 아랫줄 — 이 건이 어떻게 됐나, 그리고 아직 기다리는 중이면 언제까지인가.
 *
 *  마감은 예전에 카드 윗줄 가운데에 따로 떠 있었는데, 그 줄이 케밥과 같은 띠에 앉느라
 *  본문을 한 줄만큼 밀어 두어야 했다. 둘 다 '이 건이 지금 어디쯤인가'라 같은 줄에 두는 편이
 *  읽기도 낫다(요청: "응답 마감 시간 표시를 너 나와 상태 표시하는 줄에 같이 표시"). */
export function ChallengeOutcome({ challenge }: { challenge: Challenge }) {
  const { text, tone } = challengeOutcome(challenge);
  const left = deadlineLeft(challenge);
  return (
    <div className={`scr-challenge-outcome scr-challenge-outcome-${tone}`}>
      {text}
      {left && <span className="scr-challenge-outcome-deadline">{left} 후 마감</span>}
    </div>
  );
}

/** 한 통의 편지지 — From. / 제목·일시·한마디 / To.
 *
 *  일시는 한마디보다 위다(요청, 스크린샷) — 약속이 이 편지의 용건이고 한마디는 그에
 *  붙는 말이라, 용건이 먼저 눈에 들어와야 한다. */
export function ChallengeLetter({
  challenge, schedule, when, foot, highlight,
}: {
  challenge: Challenge;
  /** 일시 입력칸 — 답할 수 있는 사람에게만. 제목 아래 본문에 그대로 놓인다. */
  schedule?: ReactNode;
  /** 이미 정해진 일시 — 제목 줄 오른쪽에 값만 붙는다(요청). 보통 <ChallengeWhen/>이다. */
  when?: ReactNode;
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
  /* 제목은 실제로 지목된 사람(들)의 닉네임을 쓴다 — 지금 보고 있는 사람(user)을 쓰면,
     요청자 본인이 제 공유 카드를 열었을 때 자기 닉네임이 "OO 너 나와!"로 뜬다(지적). */
  const names = toSide.map((m) => m.nickname);
  const title = names.length > 0 ? `${names.join(", ")} 너 나와!` : "너 나와!";
  /* 구분선은 이제 제 몫의 칸 하나다(요청: "구분선도 보더가 아닌 하나의 div로 처리해서
     위아래 gap이 들어가게") — 예전에는 아래 토막의 border-top이었고, 그러면 선 위쪽은
     본문의 gap이 벌려 주는데 선 아래쪽은 그 토막이 padding-top을 따로 들고 있어야 했다.
     한 선을 두 규칙이 나눠 맡으니 값이 어긋날 때마다 선이 위나 아래로 딸려 붙었다.
     선을 칸으로 세우면 위아래 모두 같은 gap이 벌려 줘서 저절로 한가운데에 선다.

     선을 그을 자리를 여기서 미리 세는 이유: 아래 토막들은 비면 통째로 null을 뱉는데
     (PartySide·ChallengeReplies), 그때 선만 남으면 편지지 끝에 뜬금없는 줄이 그어진다. */
  const hasReplies = challenge.targets.some((t) => t.responseMessage.trim() !== "");
  const rule = <div className="scr-challenge-rule" aria-hidden />;

  return (
    <>
      <div className="scr-modal-body scr-challenge-inbox-body">
        {/* 제목과 일시가 한 줄이고(요청), 그 줄이 From.보다 위다(요청: "제목하고 일시는
            호출자 아바타 옆이 아니라 그 윗줄") — 편지지에서 먼저 읽어야 하는 것은 용건이고,
            누가 불렀는지는 그 다음이다. 좁아서 못 들어가면 일시가 통째로 다음 줄로 접힌다. */}
        <div className="scr-challenge-title-row">
          <div className="scr-challenge-inbox-title">{title}</div>
          {when}
        </div>
        <PartySide tag="From." members={fromSide} highlight={highlight} />
        <ChallengeWords from={challenge.createdBy.nickname} message={challenge.message} />
        {schedule}
        {/* 지목된 쪽 토막이 여기서 열린다 — 그 첫 줄은 답한 말이고(요청: 부른 쪽이
            '한마디 → 아바타'로 읽히는데 답한 쪽만 뒤집혀 있었다), 그 뒤가 아바타다.
            선은 토막 하나에 한 번만 긋는다. */}
        {(hasReplies || toSide.length > 0) && rule}
        <ChallengeReplies targets={challenge.targets} />
        <PartySide tag="To." members={toSide} highlight={highlight} />
        {foot}
        {/* 맨 아랫줄 — 이 건이 어떻게 됐나(요청). foot(인박스의 오류 줄 등)보다도 아래다. */}
        {rule}
        <ChallengeOutcome challenge={challenge} />
      </div>
    </>
  );
}
