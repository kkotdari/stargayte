// 작은 효과음 몇 개를 Web Audio로 즉석 합성해서 낸다 — 오디오 파일(에셋)을 두지 않고
// 코드로만 만들어 번들도 안 늘리고 CSP/네트워크 걱정도 없다.
//
// 브라우저 자동재생 정책: AudioContext는 사용자 제스처가 있기 전엔 suspended 상태라 소리가
// 안 난다. 제어판 열기(로고 3연타)·로그인 직후처럼 최근에 사용자 상호작용이 있었으면 나고,
// 새로고침으로 세션만 복원된 경우(제스처 없음)엔 조용히 무시된다 — 소리 하나 때문에 앱이
// 멈추면 안 되므로 실패는 전부 삼킨다.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// 낡은 경첩이 삐걱이는 "끼익" — 톱니파를 높은 데서 낮게 떨어뜨리며 빠른 비브라토(떨림)를
// 얹고, 밴드패스로 좁혀 쇠가 긁히는 듯한 소리를 낸다(요청: "제어판 열릴때 끼익 소리").
export function playCreak(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.42);

    // 삐걱이는 떨림 — 오실레이터 주파수를 빠르게 흔든다.
    const lfo = ac.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(26, t);
    lfo.frequency.linearRampToValueAtTime(15, t + 0.42);
    const lfoGain = ac.createGain();
    lfoGain.gain.setValueAtTime(50, t);
    lfo.connect(lfoGain).connect(osc.frequency);

    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(950, t);
    bp.Q.setValueAtTime(6, t);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);

    osc.connect(bp).connect(gain).connect(ac.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.5);
    lfo.stop(t + 0.5);
  } catch {
    // 합성 실패는 무시.
  }
}

// 우편 알림 "딸랑딸랑" — 진짜 방울/차임벨처럼 맑고 영롱하게(요청). 사인파 배음을 정수배로
// 쌓으면 오르간처럼 밋밋해서 종 느낌이 안 난다 — 그래서 튜블러 벨(금속 종)의 비조화 배음비
// (1 : 2.76 : 5.40 : 8.93)로 배음을 얹어 "댕~" 하는 금속 종 특유의 맑은 울림을 만들고,
// 높은 배음일수록 빨리 사라지게 해 반짝이는 잔향만 남긴다. 높은 두 음을 번갈아 빠르게 네 번
// 쳐서 작은 방울이 딸랑딸랑 흔들리는 소리를 낸다.
export function playMailChime(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    // [배음 주파수비, 상대 볼륨, 감쇠(초)]
    const partials: [number, number, number][] = [
      [1.0, 1.0, 0.9],
      [2.76, 0.55, 0.6],
      [5.40, 0.28, 0.4],
      [8.93, 0.1, 0.26],
    ];
    // 종 한 번 치기 — 기본 주파수 base로 비조화 배음을 한꺼번에 울리고 각자 감쇠시킨다.
    const strike = (start: number, base: number, peak: number) => {
      for (const [ratio, vol, decay] of partials) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(base * ratio, start);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak * vol, start + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        o.connect(g).connect(ac.destination);
        o.start(start);
        o.stop(start + decay + 0.05);
      }
    };
    // 높은 두 음(C7↔F7)을 번갈아 — 딸-랑-딸-랑.
    const seq: [number, number][] = [
      [0.0, 2093],
      [0.13, 2793],
      [0.30, 2093],
      [0.43, 2793],
    ];
    for (const [delay, base] of seq) {
      const start = t0 + delay;
      strike(start, base, 0.11);
      // 아주 살짝 디튠한 겹종 — 방울들이 함께 흔들리며 생기는 반짝임(맥놀이)을 더한다.
      strike(start + 0.005, base * 1.006, 0.04);
    }
  } catch {
    // 합성 실패는 무시.
  }
}
