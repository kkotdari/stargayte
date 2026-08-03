// 리플레이를 여러 개 한꺼번에 다시 읽을 때 쓰는 일꾼 묶음(Web Worker 풀).
//
// 제어판의 '요약 재분석'이 쓴다 — 등록된 경기를 하나씩 내려받아 다시 읽고 요약만 갈아
// 끼우는 일인데, 예전에는 그 전부(내려받기 → 파싱 → 올리기)를 한 줄로 세워 놓고 화면
// 쪽에서 돌렸다. 파싱 한 번이 실측 252ms라 화면이 그만큼씩 멈췄고, 경기 수만큼 곱해져
// 쓸 수 없을 만큼 느렸다(지적).
//
// 여기서 하는 일은 두 가지다.
//   ① 코어 수만큼 일꾼을 띄워 파싱을 실제로 나란히 돌린다(replaySummaryWorker.ts).
//   ② 일꾼 수보다 조금 더 많은 갈래로 굴려, 한쪽이 파싱하는 동안 다른 쪽은 내려받게 한다 —
//      내려받기는 기다림이고 파싱은 계산이라 둘은 겹칠 수 있다.
import type { SummaryJob, SummaryJobResult } from "./replaySummaryWorker";

/** 일꾼 수 — 코어 하나는 화면 몫으로 남기고, 넷을 넘기지 않는다. 리플레이 파싱은 메모리도
 *  같이 먹어서(커맨드 수만 개) 무작정 늘리면 오히려 느려진다. 코어 수를 못 읽는 브라우저는
 *  둘로 잡는다 — 하나보다는 확실히 낫고, 둘이면 어지간한 기기에서 안전하다. */
export function poolSize(): number {
  const cores = typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency ?? 0;
  return Math.max(1, Math.min(4, cores > 0 ? cores - 1 : 2));
}

export interface SummaryPool {
  /** 리플레이 바이트를 넘기면 요약을 만들어 준다 — 빈 일꾼이 없으면 줄을 선다. */
  run(id: number, name: string, buf: ArrayBuffer): Promise<SummaryJobResult>;
  /** 다 쓰면 반드시 부른다 — 일꾼은 안 끄면 탭이 살아 있는 동안 그대로 남는다. */
  close(): void;
  size: number;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

interface Waiting {
  job: SummaryJob;
  resolve: (r: SummaryJobResult) => void;
}

/** 이 브라우저가 '모듈 일꾼'을 아나 — 우리 일꾼은 파서를 동적 import 하므로 모듈이라야 한다.
 *
 *  못 쓰는 브라우저는 조용히 실패한다: 생성자는 그냥 돌아가고 나중에 error 이벤트만 뜨는데,
 *  그때는 이미 일감을 넘긴 뒤라 전부 실패로 돌아온다. 그래서 미리 물어본다 — 옵션 객체의
 *  type을 게터로 두면 브라우저가 그 값을 읽을 때만 게터가 불린다(모듈 일꾼을 모르는
 *  브라우저는 type을 아예 안 읽는다). 빈 스크립트라 만들어져도 아무 일도 안 한다. */
function moduleWorkerOk(): boolean {
  if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") return false;
  let asked = false;
  const url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
  try {
    new Worker(url, { get type() { asked = true; return "module"; } } as WorkerOptions).terminate();
  } catch {
    asked = false;
  } finally {
    URL.revokeObjectURL(url);
  }
  return asked;
}

/** 일꾼 묶음을 띄운다 — 이 환경에서 Worker를 못 쓰면 null(부른 쪽이 예전처럼 화면에서 돈다). */
export function createSummaryPool(size = poolSize()): SummaryPool | null {
  if (!moduleWorkerOk()) return null;
  const slots: Slot[] = [];
  const queue: Waiting[] = [];
  /** 일꾼에 넘긴 일감 — 답이 오면 여기서 짝을 찾는다. 일꾼마다 한 번에 하나씩만 준다. */
  const inFlight = new Map<Worker, { id: number; resolve: (r: SummaryJobResult) => void }>();

  const handOut = (slot: Slot) => {
    const next = queue.shift();
    if (!next) { slot.busy = false; return; }
    slot.busy = true;
    inFlight.set(slot.worker, { id: next.job.id, resolve: next.resolve });
    // 바이트는 넘겨 준다(transfer) — 128KB짜리를 일꾼 수만큼 복사할 이유가 없다.
    slot.worker.postMessage(next.job, [next.job.buf]);
  };

  try {
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL("./replaySummaryWorker.ts", import.meta.url), { type: "module" });
      const slot: Slot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<SummaryJobResult>) => {
        const cur = inFlight.get(worker);
        inFlight.delete(worker);
        cur?.resolve(e.data);
        handOut(slot);
      };
      /* 일꾼이 통째로 죽는 경우(메모리 부족 등) — 기다리던 쪽이 영영 안 깨어나면 재분석이
         멈춘 채로 남는다. 실패로 돌려주고 그 일꾼은 놀린다. */
      worker.onerror = () => {
        const cur = inFlight.get(worker);
        inFlight.delete(worker);
        cur?.resolve({ id: cur.id, ok: false, error: "리플레이를 읽는 일꾼이 멈췄어요." });
        handOut(slot);
      };
      slots.push(slot);
    }
  } catch {
    slots.forEach((s) => s.worker.terminate());
    return null;
  }
  if (slots.length === 0) return null;

  return {
    size: slots.length,
    run(id, name, buf) {
      return new Promise<SummaryJobResult>((resolve) => {
        queue.push({ job: { id, name, buf }, resolve });
        const free = slots.find((s) => !s.busy);
        if (free) handOut(free);
      });
    },
    close() {
      queue.length = 0;
      inFlight.clear();
      slots.forEach((s) => s.worker.terminate());
    },
  };
}

/** 목록을 정해진 수만큼 나란히 굴린다 — 하나가 끝나면 바로 다음 것을 집는다(묶음으로
 *  끊어 기다리지 않는다: 느린 하나 때문에 나머지가 다 노는 일이 없어야 한다).
 *  stop이 참을 돌려주면 남은 것은 시작하지 않는다. */
export async function runLanes<T>(
  items: T[], lanes: number, work: (item: T) => Promise<void>, stop?: () => boolean,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (;;) {
      if (stop?.()) return;
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, lane));
}
