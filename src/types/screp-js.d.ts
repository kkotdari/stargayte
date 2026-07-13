// screp-js는 타입 선언을 제공하지 않는 순수 JS 패키지라 여기서 최소한으로 직접 선언한다.
// 실제 파싱 결과의 정확한 모양은 utils/replayParser.ts의 ScrepResult가 담당한다.
declare module "screp-js" {
  interface Screp {
    parseBuffer(buf: Uint8Array): Promise<unknown>;
    getVersion(): string;
  }
  const screp: Screp;
  export default screp;
}
