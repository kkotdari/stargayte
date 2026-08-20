/* 서버가 구워 준 참값 트랙을 푼다 ─────────────────────────────────────────────
 *
 * 여태 트랙은 리플레이 커맨드에서 **추론**해 화면에서 만들었다(src/legacy). 이제 서버가
 * OpenBW로 그 경기를 실제로 돌려 참값을 구워 두므로, 폰은 받아서 풀기만 하면 된다.
 * 유추도 없고 워커도 안 돌린다.
 *
 * [꼴 — tools/openbw/bwdump.cpp 의 쓰개와 짝이다]
 *
 *   전체 = zlib( 아래 바이트열 )              ← 작은 끝(little-endian)
 *
 *   머리
 *     char[4] "OBWT" · u8 판(=1) · f32 초당프레임 · i32 믿을프레임(-1이면 끝까지)
 *     u32 트랙수
 *   트랙표 × 트랙수
 *     u32 태그 · u8 임자 · u16 유닛종류 · u32 키수
 *   키 흐름 (트랙 차례대로, 트랙마다 앞 키와의 **차이**를 적는다)
 *     트랙마다 앞프레임=앞x=앞y=0에서 시작
 *     키마다: varint(zigzag(프레임차)) · varint(zigzag(x차)) · varint(zigzag(y차))
 *             · u8 방향(0~255) · u8 상태
 *
 * 왜 이렇게까지 접나 — 글자(TSV)로 내면 26분짜리 8인전이 39MB다. 서버가 트랙 하나에 쓸 수
 * 있는 자리는 4MB고, 폰으로 보내는 짐이기도 하다. 이 꼴로는 같은 경기가 1.8MB다.
 */
import { BW_UNIT_NAME } from "./bwUnitNames";

/** 앱이 쓰는 트랙 — src/legacy/simCore.ts 의 SimTrack과 같은 꼴이다.
 *  옛 길이 사라져도 이 꼴은 남으므로 여기에 다시 적어 둔다. */
export type TruthTrack = {
  tag: number;
  owner: number;
  kind: string;
  /** 초 */
  born: number;
  /** 초. 끝까지 살아 있었으면 null */
  died: number | null;
  /** 다섯씩 [t(초), x(타일), y(타일), 방향(도), 상태] */
  keys: Float32Array;
};

export type TruthTracks = {
  tracks: TruthTrack[];
  /** 시뮬이 실제 게임과 같다고 볼 수 있는 마지막 시각(초). null이면 끝까지 믿어도 된다. */
  trustUntil: number | null;
};

/** 상태 번호 — 옛 시뮬(ST_*)과 같은 값이다. */
export const TRUTH_ST_IDLE = 0;
export const TRUTH_ST_MOVE = 1;
export const TRUTH_ST_INSIDE = 2;
export const TRUTH_ST_GONE = 3;
export const TRUTH_ST_FIGHT = 4;
export const TRUTH_ST_GATHER = 5;
export const TRUTH_ST_BURROW = 6;
export const TRUTH_ST_CARRY_MIN = 7;
export const TRUTH_ST_CARRY_GAS = 8;

/* 자취 읽개 ─────────────────────────────────────────────────────────────────────
   키는 3프레임(약 0.126초)마다 하나다. 그 사이 시각은 앞뒤 키를 이어서 메운다 — 안 그러면
   초당 8칸씩 유닛이 튄다. 방향은 최단 각으로 돌리고(359°→1°가 358° 역회전이 안 되게),
   상태는 안 섞는다(걷는 중과 싸우는 중 사이에 '반쯤'은 없다).
   옛 시뮬(legacy/simCore.posAtSim)에 있던 것을 그대로 옮겼다 — 자취 꼴이 같으니 셈도 같고,
   이걸 옮겨야 시뮬 엔진이 앱 묶음에서 통째로 빠진다. */
const norm360 = (d: number): number => ((d % 360) + 360) % 360;
const angDiff = (a: number, b: number): number => {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
};

/** t초일 때 이 개체의 자리·방향·상태. 아직 안 태어났으면 null. */
export function posAtTruth(
  tr: TruthTrack, t: number,
): { x: number; y: number; hdg: number; state: number } | null {
  const n = tr.keys.length / 5;
  if (n === 0) return null;
  if (t < tr.keys[0]) return null;
  // 마지막으로 t를 안 넘는 키 — 키가 수천 개라 이분법으로 찾는다.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr.keys[mid * 5] <= t) lo = mid; else hi = mid - 1;
  }
  const i = lo * 5;
  const st = tr.keys[i + 4];
  if (lo === n - 1) return { x: tr.keys[i + 1], y: tr.keys[i + 2], hdg: tr.keys[i + 3], state: st };
  const j = i + 5;
  const span = tr.keys[j] - tr.keys[i];
  const u = span > 0 ? Math.min(1, Math.max(0, (t - tr.keys[i]) / span)) : 0;
  const dh = angDiff(tr.keys[i + 3], tr.keys[j + 3]);
  return {
    x: tr.keys[i + 1] + (tr.keys[j + 1] - tr.keys[i + 1]) * u,
    y: tr.keys[i + 2] + (tr.keys[j + 2] - tr.keys[i + 2]) * u,
    hdg: norm360(tr.keys[i + 3] + dh * u),
    state: st,
  };
}

/** base64 → 바이트. atob는 라틴1 문자열을 주므로 코드포인트를 그대로 옮긴다. */
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** zlib 풀기 — 브라우저가 해 준다(DecompressionStream). 없는 환경이면 던진다. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error("이 브라우저는 DecompressionStream이 없다");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 바이트열을 앞에서부터 훑는 작은 커서 — 꼴이 한 줄로 이어져 있어 되감을 일이 없다. */
class Cursor {
  private p = 0;
  private readonly b: Uint8Array;
  /* 매개변수 속성(constructor(private b))은 안 쓴다 — 이 리포는 erasableSyntaxOnly라
     타입만 지워서는 자바스크립트가 안 되는 문법을 금한다. */
  constructor(b: Uint8Array) { this.b = b; }
  u8(): number { return this.b[this.p++]; }
  u16(): number { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  u32(): number {
    const v = (this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16)
      | (this.b[this.p + 3] << 24)) >>> 0;
    this.p += 4;
    return v;
  }
  i32(): number { return this.u32() | 0; }
  f32(): number {
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getFloat32(0, true);
    this.p += 4;
    return v;
  }
  /** 7비트씩 담긴 수 + zigzag 되돌리기 — 음수도 작은 바이트로 들어온다. */
  varint(): number {
    let z = 0;
    let shift = 0;
    for (;;) {
      const c = this.b[this.p++];
      z |= (c & 0x7f) << shift;
      if (!(c & 0x80)) break;
      shift += 7;
    }
    z >>>= 0;
    return (z >>> 1) ^ -(z & 1);
  }
  get left(): number { return this.b.length - this.p; }
}

/**
 * 서버가 준 문자열(base64)을 트랙으로 푼다.
 *
 * 던지지 않는다 — 꼴이 낯설거나 못 풀면 null을 준다. 부르는 쪽은 그때 옛 길로 돌아가면 된다.
 */
export async function decodeTruthTracks(b64: string): Promise<TruthTracks | null> {
  try {
    const raw = await inflate(fromBase64(b64));
    const c = new Cursor(raw);
    if (c.u8() !== 0x4f || c.u8() !== 0x42 || c.u8() !== 0x57 || c.u8() !== 0x54) return null; // "OBWT"
    const version = c.u8();
    if (version !== 1) return null;
    const fps = c.f32();
    const trustFrame = c.i32();
    const n = c.u32();
    if (!Number.isFinite(fps) || fps <= 0 || n > 100000) return null;

    const head: { tag: number; owner: number; type: number; count: number }[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      head[i] = { tag: c.u32(), owner: c.u8(), type: c.u16(), count: c.u32() };
    }

    const tracks: TruthTrack[] = [];
    for (let i = 0; i < n; i += 1) {
      const h = head[i];
      const keys = new Float32Array(h.count * 5);
      let pf = 0;
      let px = 0;
      let py = 0;
      let born = 0;
      let died: number | null = null;
      for (let k = 0; k < h.count; k += 1) {
        pf += c.varint();
        px += c.varint();
        py += c.varint();
        const headingByte = c.u8();
        const state = c.u8();
        const t = pf / fps;
        if (k === 0) born = t;
        if (state === TRUTH_ST_GONE) died = t;
        const o = k * 5;
        keys[o] = t;
        keys[o + 1] = px / 32;              // 픽셀 → 타일
        keys[o + 2] = py / 32;
        keys[o + 3] = (headingByte * 360) / 256;
        keys[o + 4] = state;
      }
      tracks.push({
        tag: h.tag,
        owner: h.owner,
        kind: BW_UNIT_NAME[h.type] ?? `?${h.type}`,
        born,
        died,
        keys,
      });
    }
    return { tracks, trustUntil: trustFrame < 0 ? null : trustFrame / fps };
  } catch {
    return null;
  }
}
