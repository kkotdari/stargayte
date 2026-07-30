// 리플레이 요약을 '문장'이 아니라 '무슨 일이 있었나'로 저장하기 위한 형식(요청).
//
// 예전에는 완성된 한국어 문장을 그대로 DB에 넣었다. 그러면 등록 순간의 닉네임과 그때의
// 문구가 영원히 굳는다 — 나중에 누가 닉네임을 바꾸거나(회원 정보 수정), 비회원으로 남아
// 있던 게임 아이디가 실제 회원으로 연결되거나, 전술 설명 문구를 더 낫게 고쳐도 이미 등록된
// 경기들은 옛말을 계속 보여준다.
//
// 그래서 저장하는 건 다음 세 가지뿐이다.
//   - 어떤 일이었나(k): 문장 틀의 키. 문구 자체는 replaySummaryText.ts에만 있다.
//   - 누가 했나(who): 리플레이 원본 게임 아이디. 회원 pk가 아니라 이 값을 쓰는 이유는,
//     이게 그 경기 시점의 유일한 증거이고(GameResultSlot.rawName 주석 참고) 회원 연결은 나중에
//     바뀔 수 있기 때문이다. 볼 때마다 지금의 연결로 다시 풀어 현재 닉네임을 보여준다.
//   - 무엇으로(p): 유닛/건물/테크는 screp 영문 키로, 수치는 숫자로. 한국어 표기가 바뀌어도
//     저장된 값은 그대로다.
//
// 이렇게 두면 문구를 고치는 건 코드 한 곳을 고치는 일이 되고, 이미 등록된 경기들도 다음
// 조회부터 새 문구·새 닉네임으로 읽힌다.

/** 저장 형식 버전. 틀 키의 의미를 바꿔야 할 때만 올린다(문구만 바꿀 땐 그대로). */
export const REPLAY_SUMMARY_VERSION = 1;

export interface ReplaySummaryBeat {
  /** 문장 틀 키(replaySummaryText.ts의 TEMPLATES). 모르는 키는 조용히 건너뛴다. */
  k: string;
  /** 이 일을 한 쪽이 이겼나 — 같은 틀도 이긴 쪽/진 쪽의 맺음이 다르다. */
  won: boolean;
  /** 행위자들의 리플레이 원본 게임 아이디. */
  who: string[];
  /** 부차 행위자(팀에서 특히 활약한 사람 등). 없으면 생략. */
  who2?: string[];
  /** 당한 쪽 — "관우의 저글링 성큰을 뚫음"처럼 상대를 지목하는 문장에서만. */
  whom?: string[];
  /** 일어난 프레임 — 이야기를 시간순으로 늘어놓는 데만 쓴다. */
  at?: number | null;
  /** 틀에 꽂히는 값들. 유닛/건물/테크는 screp 영문 키, 나머지는 숫자/불리언. */
  p?: Record<string, string | number | boolean | string[]>;
  /** 원본 게임 아이디 → 그 무렵 그 사람이 병력을 보낸 자리(타일 좌표). 미니맵 스냅에
   *  아바타를 놓는 데 쓴다(요청). 근거는 이동·공격 명령 좌표뿐이라 '있던 곳'이 아니라
   *  '보낸 곳'이고, 명령이 몇 개 안 찍힌 사람은 아예 빠진다(replaySummary의 beatPositions).
   *  맵 좌표를 못 읽은 리플레이와 옛 데이터에는 없다. */
  pos?: Record<string, [number, number]>;
}

export interface ReplaySummaryData {
  v: number;
  /** 일대일이었나 — 개인전에서는 "1팀이", "양 팀이" 같은 팀 용어를 쓰지 않는다(요청).
   *  옛 데이터에는 없어 생략 가능하고, 없으면 예전처럼 팀 용어를 쓴다. */
  duel?: boolean;
  /** 경기 전체 길이(프레임). '초반'은 절대 시간이 아니라 경기 길이에 대비해 봐야 한다(지적) —
   *  40분 경기의 8분과 9분 경기의 8분은 전혀 다른 자리다. 옛 데이터에는 없어 생략 가능하다. */
  end?: number;
  /** (옛 데이터 전용) 원본 게임 아이디 → 시작 지점을 시계로 부른 값(1~12). 한동안 요약
   *  문장에 "정구(1시)"처럼 붙였는데, 미니맵이 생기면서 걷어냈다(요청: 팀 언급과 몇시는
   *  빼도 되겠다) — 어디서 시작했는지는 이제 그림이 보여준다. 이미 저장된 경기에는 이 값이
   *  남아 있어 형식으로는 남겨 두지만, 읽는 곳은 없다. */
  spots?: Record<string, number>;
  /** 원본 게임 아이디 → 본진 자리(타일 좌표). 미니맵에 그 사람의 아바타+닉네임을 늘
   *  띄워 두는 자리다(요청). 옛 데이터에는 없어 생략 가능하다. */
  bases?: Record<string, [number, number]>;
  beats: ReplaySummaryBeat[];
}

/** 서버에서 받은 값이 우리가 아는 형식인지 — JSON 컬럼이라 무엇이든 들어올 수 있다. */
export function isReplaySummaryData(v: unknown): v is ReplaySummaryData {
  if (!v || typeof v !== "object") return false;
  const d = v as Partial<ReplaySummaryData>;
  return typeof d.v === "number" && Array.isArray(d.beats);
}
