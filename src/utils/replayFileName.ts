// 리플레이 첨부를 알아보기 쉬운 파일명으로 만든다(요청). 업로드(등록·일괄) 시점에만
// 생성해 저장하고, 다운로드는 저장된 이름을 그대로 쓴다. 형식:
//   yyyymmddhhmmss(시작시각)_맵_team1-이름,이름_team2-이름,이름.rep
// 이름은 인게임 플레이어 네임(rawName)을 그대로 쓴다 — 회원 매칭 결과와 무관하게 리플레이
// 안에 고정된 값이라 안정적이다(옵저버는 파일명에 넣지 않는다).
import type { ParsedReplay } from "./replayParser";

// "표시 폭" 기준 자르기 — 한글 등 비ASCII 글자는 폭 2, ASCII(영문·숫자·기호)는 폭 1로 보고
// maxWidth를 넘지 않을 때까지만 담는다(요청: 한글 3자 / 영문 6자 = 폭 6). 2폭짜리가 마지막에
// 안 맞으면 그 앞에서 멈춘다(폭이 정확히 안 맞고 5에서 끝날 수 있음).
function cutByWidth(s: string, maxWidth: number): string {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + cw > maxWidth) break;
    w += cw;
    out += ch;
  }
  return out;
}

// 파일명에 못 쓰는 문자만 정리한다 — 제어문자(맵 이름의 색상코드 등, \x00-\x1f·\x7f)는 제거,
// Windows 금지문자(/ \ : * ? " < > |)는 _로 치환. 한글·공백·그 외(#, 영문·숫자 등)는 통과.
function sanitize(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function stamp(gameStartedAt: string | null, dateFallback: string): string {
  const parsed = gameStartedAt ? new Date(gameStartedAt) : null;
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(`${dateFallback}T00:00:00`);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const NAME_WIDTH = 6; // 인게임 플레이어 네임 (한글 3 / 영문 6)
const MAP_WIDTH = 12; // 맵 이름 (한글 6 / 영문 12)
const MAX_TOTAL = 180; // 전체 길이 상한(비정상적으로 긴 조합 방어)

export function buildReplayFileName(parsed: ParsedReplay): string {
  const time = stamp(parsed.gameStartedAt, parsed.date);
  const map = cutByWidth(sanitize(parsed.mapName || ""), MAP_WIDTH) || "map";
  const names = (players: { rawName: string }[]) =>
    players.map((p) => cutByWidth(sanitize(p.rawName), NAME_WIDTH) || "?").join(",");
  let base = `${time}_${map}_team1-${names(parsed.team1)}_team2-${names(parsed.team2)}`;
  if (base.length > MAX_TOTAL) base = base.slice(0, MAX_TOTAL);
  return `${base}.rep`;
}
