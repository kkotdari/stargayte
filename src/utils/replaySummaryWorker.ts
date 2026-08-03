// 리플레이 하나를 읽어 요약만 만들어 돌려주는 일꾼(Web Worker).
//
// 왜 화면 밖으로 내보내나 — 리플레이 파싱(screp-js)은 GopherJS로 컴파일된 순수 JS라
// 통째로 한 실꾸리(스레드)에서 돈다. 실측으로 한 판에 파싱 252ms + 요약 23ms이고, 이걸
// 화면 쪽에서 돌리면 그 275ms 동안 화면이 통째로 멈춘다. 제어판의 '요약 재분석'은 등록된
// 경기를 전부 다시 읽는 일이라 그 275ms가 경기 수만큼 곱해진다(지적: 너무 느려서 못 쓰겠다).
//
// 일꾼으로 내보내면 두 가지가 한꺼번에 풀린다.
//   ① 코어 수만큼 동시에 파싱한다 — 파싱은 CPU 일이라 한 실꾸리에서는 아무리 겹쳐 불러도
//      빨라지지 않는다.
//   ② 그동안 화면이 안 멈춘다 — 진행 숫자가 실제로 흐르고 다른 버튼도 눌린다.
//
// 오가는 것은 리플레이 바이트(들어갈 때)와 요약·지형 격자(나올 때)뿐이다. 파싱 결과 전체
// (커맨드 수만 개)는 일꾼 안에서 쓰고 버린다 — 그걸 돌려보내면 직렬화 비용이 파싱만큼 든다.
import { parseReplayFile } from "./replayParser";
import { buildReplaySummary } from "./replaySummary";
import type { ReplaySummaryData } from "./replaySummaryData";
import type { ReplayMapGrid } from "./replayParser";

/** 일감 — id는 부른 쪽이 짝을 맞추는 데만 쓴다(경기 id를 그대로 넣는다). */
export interface SummaryJob {
  id: number;
  /** 파일 이름 — 파싱이 실패했을 때의 메시지에만 쓰인다. */
  name: string;
  buf: ArrayBuffer;
}

export type SummaryJobResult =
  | { id: number; ok: true; summaryData: ReplaySummaryData | null; mapData: ReplayMapGrid | null }
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
        summaryData: buildReplaySummary(parsed),
        mapData: parsed.mapGrid ?? null,
      });
    } catch (err) {
      ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : "리플레이를 읽지 못했어요." });
    }
  })();
};
