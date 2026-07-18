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

// 우편 알림 "딩동" — 사인파 두 음(E6→A6)에 배음을 살짝 얹고 빠르게 감쇠시켜 맑은 종소리
// 느낌을 낸다(요청: "도전장 인박스 모달 뜰때 우편벨소리").
export function playMailChime(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const notes: [number, number][] = [[0, 1318.5], [0.13, 1760]];
    for (const [delay, freq] of notes) {
      const start = t + delay;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, start);
      const harmonic = ac.createOscillator();
      harmonic.type = "sine";
      harmonic.frequency.setValueAtTime(freq * 2, start);

      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      const hg = ac.createGain();
      hg.gain.setValueAtTime(0.05, start);

      o.connect(g).connect(ac.destination);
      harmonic.connect(hg).connect(g);
      o.start(start);
      harmonic.start(start);
      o.stop(start + 0.55);
      harmonic.stop(start + 0.55);
    }
  } catch {
    // 합성 실패는 무시.
  }
}
