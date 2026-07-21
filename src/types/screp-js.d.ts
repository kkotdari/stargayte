// screp-js는 타입 선언을 제공하지 않는 순수 JS 패키지라 여기서 최소한으로 직접 선언한다.
// 실제 파싱 결과의 정확한 모양은 utils/replayParser.ts의 ScrepResult가 담당한다.
declare module "screp-js" {
  // 두 번째 인자는 파싱 옵션(readme 참고) — cmds:true를 줘야 커맨드 스트림이 채워진다.
  interface ScrepParseOptions {
    header?: boolean;
    computed?: boolean;
    mapData?: boolean;
    mapTiles?: boolean;
    mapResLoc?: boolean;
    cmds?: boolean;
  }
  interface Screp {
    parseBuffer(buf: Uint8Array, options?: ScrepParseOptions): Promise<unknown>;
    getVersion(): string;
  }
  const screp: Screp;
  export default screp;
}
