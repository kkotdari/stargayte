// 유닛·기술·건물의 한국어 통용 표기 — 원래 요약 문장 렌더러(replaySummaryText.ts)에
// 살던 사전인데, 요약(문장·beats) 기능이 통째로 걷히면서 사전만 여기로 옮겨 왔다.
// 통계(MemberStatRow)·생산 구성(replayBuildMix)·연속 재생(ReplayMotionPlayer)이 쓴다.

// screp 영문명 → 한국어 통용 표기. 여기 없는 유닛은 화면에 쓰지 않는다 — 영문명을 그대로
// 노출하면 어색하고, UMS 맵의 영웅 유닛까지 새어 나온다.
export const UNIT_KO: Record<string, string> = {
  // 라바·알(요청: 인포 팝업) — 개체 기록에는 안 남지만 화면에는 그려진다.
  Larva: "라바", Egg: "변태알",
  Marine: "마린", Firebat: "파이어뱃", Medic: "메딕", Ghost: "고스트",
  Vulture: "벌처", Goliath: "골리앗",
  "Siege Tank (Tank Mode)": "탱크", "Siege Tank (Siege Mode)": "탱크",
  Wraith: "레이스", Dropship: "드랍십", "Science Vessel": "사이언스베슬",
  Battlecruiser: "배틀크루저", Valkyrie: "발키리", "Nuclear Missile": "핵",
  Zealot: "질럿", Dragoon: "드라군", "High Templar": "하이템플러",
  "Dark Templar": "다크템플러", Archon: "아콘", "Dark Archon": "다크아콘",
  Reaver: "리버", Shuttle: "셔틀", Observer: "옵저버", Scout: "스카웃",
  Corsair: "커세어", Carrier: "캐리어", Arbiter: "아비터",
  Zergling: "저글링", Hydralisk: "히드라", Lurker: "러커", Ultralisk: "울트라",
  Mutalisk: "뮤탈", Scourge: "스커지", Guardian: "가디언", Devourer: "디바우러",
  Queen: "퀸", Defiler: "디파일러", "Infested Terran": "감염된 테란",
  /* 파서가 짚어 주는 묶음 이름(replayParser의 orderPositions.by) — 마린·메딕·파이어뱃은
     한 부대로 같이 움직여 하나로 잡히고, 탱크는 시즈/언시즈 커맨드로 짚이므로 모드 없는
     이름으로 온다. 위의 "Siege Tank (Tank Mode)"와 같은 것이라 같은 말로 옮긴다. */
  Bionic: "바이오닉", "Siege Tank": "탱크",
};

// 연구로 잡히는 기술 전부. 예전엔 절반쯤만 적혀 있었고, 그나마 "Cloaking"은 screp에 없는
// 이름이라 늘 빈손이었다(지적) — 레이스 클로킹의 실제 이름은 "Cloaking Field"다.
export const TECH_KO: Record<string, string> = {
  // 테란
  "Stim Packs": "스팀팩", Lockdown: "락다운", "EMP Shockwave": "EMP",
  "Spider Mines": "마인", "Tank Siege Mode": "시즈모드", Irradiate: "이레디에이트",
  "Yamato Gun": "야마토", "Cloaking Field": "레이스 클로킹",
  "Personnel Cloaking": "고스트 클로킹", Restoration: "리스토레이션",
  "Optical Flare": "옵티컬 플레어",
  // 저그
  Burrowing: "버로우", "Lurker Aspect": "럴커", Plague: "플레이그", Consume: "컨슘",
  Ensnare: "인스네어", "Spawn Broodlings": "브루들링", "Dark Swarm": "다크스웜",
  // 프로토스
  "Psionic Storm": "스톰", Recall: "리콜", "Stasis Field": "스테이시스",
  Hallucination: "할루시네이션", "Disruption Web": "디스럽션 웹",
  "Mind Control": "마인드컨트롤", Maelstrom: "마엘스트롬",
  // 종족 구분 밖 — 핵은 연구가 아니라 고스트의 명령이다(replayTechNames의 TECH_NAMES 주석).
  "Nuclear Strike": "핵",
};

/** 방어 건물. */
const DEFENSE_KO: Record<string, string> = {
  "Sunken Colony": "성큰", "Spore Colony": "스포어",
  Bunker: "벙커", "Missile Turret": "터렛", "Photon Cannon": "포토",
};

/** 생산 건물. */
const PRODUCTION_KO: Record<string, string> = {
  Gateway: "게이트", Factory: "팩토리", Barracks: "배럭", Starport: "스타포트",
  "Robotics Facility": "로보틱스", Hatchery: "해처리",
};

/** 화면에 쓸 만한 건물 이름 — 여기 없는 건물은 그냥 '건물'이라고만 말한다. */
export const BUILDING_KO: Record<string, string> = {
  ...DEFENSE_KO, ...PRODUCTION_KO,
  Pylon: "파일런", "Supply Depot": "서플라이", "Creep Colony": "크립 콜로니",
  Forge: "포지", Academy: "아카데미", Armory: "아머리", Observatory: "옵저버토리",
  // 저그 유저들은 에볼루션 챔버를 "챔버"라고 부른다(요청) — 앞자리를 줄인 "에볼루션"은
  // 이 바닥에서 안 쓰는 말이라 낯설게 걸린다.
  "Evolution Chamber": "챔버", "Spawning Pool": "스포닝풀",
  "Nydus Canal": "나이더스", "Engineering Bay": "엔지니어링 베이", Refinery: "리파이너리",
  Assimilator: "어시밀레이터", Extractor: "익스트랙터", Nexus: "넥서스",
  "Command Center": "커맨드", Hatchery: "해처리",
  /* 나머지 건물들(지적: 연속 재생에서 건물 이름이 안 나온다) — 재생 화면이 건설 순간의
     이름표로 쓴다. */
  "Cybernetics Core": "코어", "Templar Archives": "아카이브", "Citadel of Adun": "시타델",
  Stargate: "스타게이트", "Fleet Beacon": "플릿 비콘", "Arbiter Tribunal": "트리뷰널",
  "Robotics Support Bay": "서포트 베이", "Shield Battery": "배터리",
  Spire: "스파이어", "Greater Spire": "그레이터 스파이어", "Queen's Nest": "퀸즈 네스트",
  "Defiler Mound": "디파일러 마운드", "Ultralisk Cavern": "울트라 동굴",
  "Hydralisk Den": "히드라 덴", Lair: "레어", Hive: "하이브",
  "Science Facility": "사이언스 퍼실리티", "Comsat Station": "컴셋",
  "Machine Shop": "머신샵", "Control Tower": "컨트롤 타워", "Covert Ops": "커버트 옵스",
  "Physics Lab": "피직스 랩", "Nuclear Silo": "핵 사일로",
  "Infested Command Center": "감염된 커맨드",
};
