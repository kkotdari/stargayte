// 리플레이 하나를 읽어 분석 값만 돌려주는 일꾼(Web Worker).
//
// 왜 화면 밖으로 내보내나 — 리플레이 파싱(screp-js)은 GopherJS로 컴파일된 순수 JS라
// 통째로 한 실꾸리(스레드)에서 돈다. 실측으로 한 판에 파싱 252ms이고, 이걸
// 화면 쪽에서 돌리면 그동안 화면이 통째로 멈춘다. 제어판의 '경기 재분석'은 등록된
// 경기를 전부 다시 읽는 일이라 그 시간이 경기 수만큼 곱해진다(지적: 너무 느려서 못 쓰겠다).
//
// 일꾼으로 내보내면 두 가지가 한꺼번에 풀린다.
//   ① 코어 수만큼 동시에 파싱한다 — 파싱은 CPU 일이라 한 실꾸리에서는 아무리 겹쳐 불러도
//      빨라지지 않는다.
//   ② 그동안 화면이 안 멈춘다 — 진행 숫자가 실제로 흐르고 다른 버튼도 눌린다.
//
// 오가는 것은 리플레이 바이트(들어갈 때)와 지표·지형 격자(나올 때)뿐이다. 파싱 결과 전체
// (커맨드 수만 개)는 일꾼 안에서 쓰고 버린다 — 그걸 돌려보내면 직렬화 비용이 파싱만큼 든다.
import { parseReplayFile } from "./replayParser";
import type { ReplayMapGrid } from "./replayParser";
import type { BuildMix } from "./replayBuildMix";

/** 일감 — id는 부른 쪽이 짝을 맞추는 데만 쓴다(경기 id를 그대로 넣는다). */
export interface SummaryJob {
  id: number;
  /** 파일 이름 — 파싱이 실패했을 때의 메시지에만 쓰인다. */
  name: string;
  buf: ArrayBuffer;
}

/** 한 사람 몫의 '리플레이가 말해 주는 값' — 회원 연결과 무관한 것만 담는다. 짝은 원본
 *  게임 아이디(rawName)로 맞춘다: 슬롯의 회원 연결은 사람이 고쳤을 수 있어 손대면 안 되고,
 *  rawName은 그 경기 시점의 유일한 증거라 서버가 한 번 저장하면 바꾸지 않는다. */
export interface ReanalyzedSlot {
  rawName: string;
  race: string;
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
  buildCount: number | null;
  buildMix: BuildMix | null;
}

export type SummaryJobResult =
  | {
    id: number; ok: true;
    mapData: ReplayMapGrid | null;
    /* 아래는 리플레이에서 다시 나오는 값들이다(요청: 등록자·등록시간처럼 절대 바뀌면
       안 되는 것은 그대로) — 파서가
       바뀌면 옛 경기의 이 값들도 같이 낡는다. 사람이 정한 것(등록자·등록시각·경기번호·
       날짜·분류·승패·회원 연결·첨부 리플레이)은 여기 없다. */
    mapName: string | null;
    gameStartedAt: string | null;
    durationSeconds: number | null;
    slots: ReanalyzedSlot[];
    /** 개체 트랙 v2(JSON 문자열) — 재분석이 옛 경기에도 v2를 만들어 준다(요청: 재분석
     *  한 번으로 기존 경기 전부). 분석 실패면 null — 재분석 자체는 그대로 간다. */
    unitTracks: string | null;
  }
  | { id: number; ok: false; error: string };

/* 일꾼 전역(self)의 타입 — DedicatedWorkerGlobalScope를 쓰려면 tsconfig에 WebWorker lib을
   더해야 하는데, 그러면 화면 쪽 코드의 전역 타입까지 함께 흔들린다. 쓰는 것이 둘뿐이라
   그 둘만 적어 둔다. */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SummaryJob>) => void) | null;
  postMessage: (m: SummaryJobResult) => void;
};

ctx.onmessage = (e: MessageEvent<SummaryJob>) => {
  const { id, name, buf } = e.data;
  void (async () => {
    try {
      const parsed = await parseReplayFile(new File([buf], name));
      ctx.postMessage({
        id, ok: true,
        mapData: parsed.mapGrid ?? null,
        mapName: parsed.mapName || null,
        gameStartedAt: parsed.gameStartedAt ?? null,
        durationSeconds: parsed.durationSeconds ?? null,
        slots: parsed.players.map((p) => ({
          rawName: p.rawName,
          race: p.race,
          apm: p.apm, eapm: p.eapm,
          cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount,
          buildCount: p.buildCount, buildMix: p.buildMix,
        })),
        unitTracks: parsed.unitTracks ?? null,
      });
    } catch (err) {
      ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : "리플레이를 읽지 못했어요." });
    }
  })();
};
