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
 *   머리   char[4] "OBWT" · u8 판(=2) · f32 초당프레임 · i32 믿을프레임(-1이면 끝까지)
 *   로스터 u8 사람수, 사람마다 u8 임자 · u8 리플레이id · u8 종족 · u8 편 · u8 controller
 *          · u32 색번호(RGB가 아니다 — 아래 BW_COLOR로 편다) · u8 이름길이 · 이름(UTF-8)
 *   트랙표 u32 트랙수, 트랙마다 u32 태그 · u8 임자 · u16 유닛종류
 *          · u32 키수 · u32 체력키수 · u32 인터셉터키수
 *   키 흐름 (트랙 차례대로, 트랙마다 앞 키와의 **차이**를 적는다)
 *     키마다: varint(zigzag(프레임차)) · varint(zigzag(x차)) · varint(zigzag(y차))
 *             · u8 방향(0~255) · u8 상태(최상위 비트=아직 안 지어짐) · varint(zigzag(종류차))
 *   체력 흐름 → 인터셉터 흐름 (트랙 차례대로, 키가 있는 트랙만)
 *     키마다: varint(프레임차) · varint(값차)
 *   업그레이드 u32 개수, 개마다 varint(프레임차) · u16 id · u8 단계 · u8 사람
 *   마법       u32 개수, 개마다 varint(프레임차) · u16 x · u16 y · u8 기술 · u8 사람
 *   핑         u32 개수, 개마다 varint(프레임차) · u16 x · u16 y · u8 사람
 *   자원       u32 개수, 개마다 u8 사람 · varint(그 사람의 앞 값과의 프레임차)
 *              · varint(미네랄차) · varint(가스차)
 *   명령       u32 개수, 개마다 varint(프레임차) · u32 태그 · u16 x · u16 y · u8 갈래
 *   APM        u32 개수 · u16 통크기(프레임), 개마다 varint(통차) · u8 사람 · varint(명령수)
 *
 * 왜 이렇게까지 접나 — 글자(TSV)로 내면 26분짜리 8인전이 39MB다. 폰으로 보내는 짐이라
 * 이 꼴로 접어 0.8~3.8MB로 만든다.
 */
import { BW_UNIT_NAME } from "./bwUnitNames";
import { bwUpgradeName, BW_TECH_NAME } from "./bwUpgradeNames";

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
  /** 키마다 '다 지어졌나' — 0이면 짓는 중이다. 시작부터 서 있던 건물과 지금 짓는 건물을
   *  가리는 표다. 키 수와 길이가 같다. */
  done: Uint8Array;
  /** 키마다의 유닛 종류 번호 — 한 생애 안에서 바뀐다(라바→알→저글링, 탱크↔시즈모드).
   *  `kind`는 그중 **마지막**이다. 키 수와 길이가 같다. */
  types: Uint16Array;
  /** 체력 변곡점 [초, 남은 체력] — 실드를 더한 **실제 수치**다(퍼센트가 아니다).
   *  잔물결(저그 재생·프로토스 실드 충전)은 솎여 있다. */
  hp?: [number, number][];
  /** 캐리어 인터셉터 수 변곡점 [초, 개수]. 캐리어가 아니면 없다. */
  ic?: [number, number][];
};

/** 리플레이 머리말이 아는 사람. */
export type TruthPlayer = {
  /** 시뮬 안의 임자 번호(0~11) — 트랙의 owner와 같은 것이다. */
  owner: number;
  /** 리플레이가 적어 둔 사람 번호 — 옛 분석(screp)의 PlayerID와 같은 자리다. */
  pid: number;
  /** 0 저그 1 테란 2 프로토스 */
  race: number;
  /** 편(force) 번호 */
  force: number;
  controller: number;
  /** 게임 안 개인색 #rrggbb */
  color: string;
  name: string;
};

export type TruthTracks = {
  tracks: TruthTrack[];
  /** 시뮬이 실제 게임과 같다고 볼 수 있는 마지막 시각(초). null이면 끝까지 믿어도 된다. */
  trustUntil: number | null;
  players: TruthPlayer[];
  /** 연구가 **끝난** 시각 [초, 이름, 임자]. 누른 때가 아니라 실제로 올라간 때다. */
  ups: [number, string, number][];
  /** 마법 [초, x(타일), y(타일), 기술 이름, 임자] — 기운을 실제로 쓴 순간이다. */
  casts: [number, number, number, string, number][];
  /** 미니맵 핑 [초, x(타일), y(타일), 임자] */
  pings: [number, number, number, number][];
  /** 자원 현황 — 임자마다 [초, 미네랄, 가스] 변곡점. 안 바뀌는 동안은 안 적혀 있다. */
  res: Map<number, [number, number, number][]>;
  /** 실시간 APM의 재료 — 임자마다 [통 시작 초, 그 통의 명령 수]. 통은 약 5초다.
   *  경기 전체 평균 하나로는 "지금 얼마나 바쁜가"를 못 그린다. */
  apm: Map<number, [number, number][]>;
  /** APM 통 하나의 길이(초). */
  apmBucketSec: number;
  /** 태그마다 그 유닛에게 떨어진 명령 [초, x(타일), y(타일), 갈래(0 이동·7 공격)].
   *  게임 상태에는 안 남는 것이라(누른 사람만 아는 일) 명령 스트림에서만 온다 —
   *  마우스 자국과 선택 링이 이걸로 선다. */
  orders: Map<number, [number, number, number, number][]>;
};

/* 개인색 — 리플레이는 **색 번호**를 담는다(RGB가 아니다). 원작의 팔레트로 편다.
   0~7이 여덟 사람 자리의 색이라 실제로 쓰이는 것은 거의 이 여덟이고, 그 위는 관전·중립
   자리에서나 나온다. 값은 원작 팔레트(111~126번 칸) 그대로다. */
const BW_COLOR: Record<number, string> = {
  0: "#f40404",  // 빨강
  1: "#0c48cc",  // 파랑
  2: "#2cb494",  // 청록
  3: "#88409c",  // 보라
  4: "#f88c14",  // 주황
  5: "#703014",  // 갈색
  6: "#cce0d0",  // 하양
  7: "#fcfc38",  // 노랑
  8: "#088008",  // 초록
  9: "#fcfc7c",  // 연노랑
  10: "#ecc4b0", // 살구
  11: "#4068d4", // 하늘
  12: "#74a47c", // 연두
  13: "#9090b8", // 회보라
  14: "#fcfc7c", // 연노랑
  15: "#00e4fc", // 시안
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
  /** UTF-8 글 n바이트. 사람 이름이 여기로 온다(한글은 덤퍼가 CP949에서 옮겨 놓는다). */
  utf8(n: number): string {
    const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
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
    if (version !== 2) return null;
    const fps = c.f32();
    const trustFrame = c.i32();
    if (!Number.isFinite(fps) || fps <= 0) return null;

    const players: TruthPlayer[] = [];
    const pn = c.u8();
    for (let i = 0; i < pn; i += 1) {
      const owner = c.u8();
      const pid = c.u8();
      const race = c.u8();
      const force = c.u8();
      const controller = c.u8();
      const slot = c.u32();
      const name = c.utf8(c.u8());
      const color = BW_COLOR[slot] ?? "#cccccc";
      players.push({ owner, pid, race, force, controller, color, name });
    }

    const n = c.u32();
    if (n > 100000) return null;
    const head: { tag: number; owner: number; type: number;
      count: number; hp: number; ic: number }[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      head[i] = { tag: c.u32(), owner: c.u8(), type: c.u16(),
        count: c.u32(), hp: c.u32(), ic: c.u32() };
    }

    const tracks: TruthTrack[] = [];
    for (let i = 0; i < n; i += 1) {
      const h = head[i];
      const keys = new Float32Array(h.count * 5);
      const types = new Uint16Array(h.count);
      const done = new Uint8Array(h.count);
      let pf = 0;
      let px = 0;
      let py = 0;
      let pt = 0;
      let born = 0;
      let died: number | null = null;
      for (let k = 0; k < h.count; k += 1) {
        pf += c.varint();
        px += c.varint();
        py += c.varint();
        const headingByte = c.u8();
        const stateByte = c.u8();
        const state = stateByte & 0x7f;
        done[k] = stateByte & 0x80 ? 0 : 1;
        pt += c.varint();
        types[k] = pt;
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
        types,
        done,
      });
    }

    /* 체력·인터셉터는 자리 키와 따로 온다(섞으면 한쪽이 바뀔 때마다 다른 쪽 키까지
       끌려 나온다). 트랙 차례가 같으므로 같은 차례로 읽어 붙인다. */
    const readTicks = (want: (h: typeof head[number]) => number,
      put: (tr: TruthTrack, v: [number, number][]) => void): void => {
      for (let i = 0; i < n; i += 1) {
        const cnt = want(head[i]);
        if (!cnt) continue;
        const out: [number, number][] = new Array(cnt);
        let pf = 0;
        let pv = 0;
        for (let k = 0; k < cnt; k += 1) {
          pf += c.varint();
          pv += c.varint();
          out[k] = [pf / fps, pv];
        }
        put(tracks[i], out);
      }
    };
    readTicks((h) => h.hp, (tr, v) => { tr.hp = v; });
    readTicks((h) => h.ic, (tr, v) => { tr.ic = v; });

    const ups: [number, string, number][] = [];
    { let pf = 0;
      const cnt = c.u32();
      for (let i = 0; i < cnt; i += 1) {
        pf += c.varint();
        const id = c.u16();
        const level = c.u8();
        const who = c.u8();
        const nm = bwUpgradeName(id);
        // 2단계·3단계는 이름 뒤에 단계를 붙인다 — 옛 표기와 같은 자리다.
        if (nm) ups.push([pf / fps, level > 1 ? `${nm} ${level}` : nm, who]);
      } }

    const casts: [number, number, number, string, number][] = [];
    { let pf = 0;
      const cnt = c.u32();
      for (let i = 0; i < cnt; i += 1) {
        pf += c.varint();
        const x = c.u16();
        const y = c.u16();
        const tech = c.u8();
        const who = c.u8();
        casts.push([pf / fps, x / 32, y / 32, BW_TECH_NAME[tech] ?? `?${tech}`, who]);
      } }

    const pings: [number, number, number, number][] = [];
    { let pf = 0;
      const cnt = c.u32();
      for (let i = 0; i < cnt; i += 1) {
        pf += c.varint();
        const x = c.u16();
        const y = c.u16();
        pings.push([pf / fps, x / 32, y / 32, c.u8()]);
      } }

    const res = new Map<number, [number, number, number][]>();
    { const prev = new Map<number, [number, number, number]>();
      const cnt = c.u32();
      for (let i = 0; i < cnt; i += 1) {
        const who = c.u8();
        const p = prev.get(who) ?? [0, 0, 0];
        const row: [number, number, number] = [p[0] + c.varint(), p[1] + c.varint(), p[2] + c.varint()];
        prev.set(who, row);
        const arr = res.get(who) ?? [];
        arr.push([row[0] / fps, row[1], row[2]]);
        res.set(who, arr);
      } }

    const orders = new Map<number, [number, number, number, number][]>();
    { let pf = 0;
      const cnt = c.u32();
      for (let i = 0; i < cnt; i += 1) {
        pf += c.varint();
        const tag = c.u32();
        const x = c.u16();
        const y = c.u16();
        const kind = c.u8();
        const arr = orders.get(tag) ?? [];
        arr.push([pf / fps, x / 32, y / 32, kind]);
        orders.set(tag, arr);
      } }

    const apm = new Map<number, [number, number][]>();
    let apmBucketSec = 5;
    { const cnt = c.u32();
      const bucketFrames = c.u16();
      apmBucketSec = bucketFrames / fps;
      let pb = 0;
      for (let i = 0; i < cnt; i += 1) {
        pb += c.varint();
        const who = c.u8();
        const n = c.varint();
        const arr = apm.get(who) ?? [];
        arr.push([(pb * bucketFrames) / fps, n]);
        apm.set(who, arr);
      } }

    return { tracks, trustUntil: trustFrame < 0 ? null : trustFrame / fps,
      players, ups, casts, pings, res, apm, apmBucketSec, orders };
  } catch {
    return null;
  }
}
