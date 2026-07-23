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

// 우편 알림 "딸랑딸랑" — 진짜 방울처럼(요청). 실제 방울은 음이 여러 개가 아니라 한 가지고,
// 같은 음이 빠르게 네 번 딸랑거린 뒤 메아리(에코)로 잦아든다. 그래서 하나의 기본음만 쓰되,
// 사인파를 정수배로 쌓으면 오르간처럼 밋밋해 종 느낌이 안 나므로 튜블러 벨(금속 종)의 비조화
// 배음비(1 : 2.76 : 5.40 : 8.93)로 그 한 음의 음색을 "댕~" 하는 맑은 금속 울림으로 만든다.
// 딜레이+피드백으로 친 소리가 메아리처럼 반복되며 사라지는 잔향을 붙인다.
export function playMailChime(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    // 메아리(에코) 버스 — 친 소리를 딜레이로 되울리고, 피드백으로 점점 작아지며 반복시킨다.
    const echo = ac.createDelay(1.0);
    echo.delayTime.setValueAtTime(0.19, t0);
    const feedback = ac.createGain();
    feedback.gain.setValueAtTime(0.42, t0); // <1이라 메아리가 점점 잦아든다.
    const echoLevel = ac.createGain();
    echoLevel.gain.setValueAtTime(0.5, t0);
    echo.connect(feedback).connect(echo);      // 피드백 루프
    echo.connect(echoLevel).connect(ac.destination);
    // 마른 소리(dry) + 에코로 함께 보내는 버스.
    const bus = ac.createGain();
    bus.gain.setValueAtTime(1, t0);
    bus.connect(ac.destination);
    bus.connect(echo);

    // [배음 주파수비, 상대 볼륨, 감쇠(초)] — 한 음의 음색(금속 종).
    const partials: [number, number, number][] = [
      [1.0, 1.0, 0.7],
      [2.76, 0.55, 0.45],
      [5.40, 0.28, 0.3],
      [8.93, 0.1, 0.2],
    ];
    // 방울 한 번 치기 — 진짜 쇠종은 클래퍼가 부딪히는 순간 음이 살짝 높았다가 바로 안정되므로
    // (금속 "팅~" 어택) 주파수를 아주 조금 높은 데서 base로 미끄러뜨린다. 소리는 에코 버스로.
    const strike = (start: number, base: number, peak: number) => {
      for (const [ratio, vol, decay] of partials) {
        const f = base * ratio;
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f * 1.012, start);
        o.frequency.exponentialRampToValueAtTime(f, start + 0.025);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak * vol, start + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        o.connect(g).connect(bus);
        o.start(start);
        o.stop(start + decay + 0.05);
      }
    };
    // 같은 음(E7)이 네 번 딸랑딸랑. 이후는 에코가 알아서 메아리를 만든다.
    const BASE = 2637;
    for (let i = 0; i < 4; i++) {
      strike(t0 + i * 0.15, BASE, 0.11);
    }
  } catch {
    // 합성 실패는 무시.
  }
}
