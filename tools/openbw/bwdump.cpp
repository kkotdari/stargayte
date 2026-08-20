/* OpenBW 헤드리스 리플레이 덤퍼 — 프레임마다 유닛 상태를 내보낸다.
 *   bwdump <자료폴더> <리플레이.rep> [프레임간격]
 * 자료폴더에는 MPQ가 아니라 **풀어 놓은 파일 열 개**만 있으면 된다:
 *   arr/{units,weapons,upgrades,techdata,flingy,sprites,images,orders}.dat
 *   arr/images.tbl · scripts/iscript.bin
 * 그림·소리는 한 장도 안 쓴다(시뮬레이션만 한다). */
#include "replay.h"
#include "modern_replay.h"
#include <cstdio>
#include <string>

using namespace bwgame;

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "쓰기: bwdump <자료폴더> <리플레이.rep> [간격]\n"); return 2; }
  std::string dir = argv[1];
  const int step = argc > 3 ? atoi(argv[3]) : 24;

  auto load_file = [&](a_vector<uint8_t>& dst, a_string filename) {
    /* 이름 안의 역슬래시를 슬래시로 — images.tbl이 적어 둔 그림 이름은 "zerg\\avenger.grp"
       처럼 윈도 표기라, 그대로 이으면 맥·리눅스에서 파일을 못 찾는다. */
    std::string p = dir + "/" + filename.c_str();
    for (char& c : p) if (c == '\\') c = '/';
    FILE* f = fopen(p.c_str(), "rb");
    if (!f) error("자료 파일 없음: %s", p.c_str());
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    dst.resize((size_t)n);
    if (fread(dst.data(), 1, (size_t)n, f) != (size_t)n) error("읽기 실패: %s", p.c_str());
    fclose(f);
  };

  /* 자료를 어디서 읽나 — 둘 다 받는다.
     ① 폴더에 MPQ 셋(Patch_rt·BrooDat·StarDat)이 있으면 그대로 읽는다. 스타크래프트
        설치 폴더를 그냥 가리키면 되는 길이다.
     ② 없으면 풀어 놓은 파일 열 개를 읽는다. 배포 서버에는 이쪽이 낫다 — 그림·소리가
        든 통짜 MPQ(수백 MB)를 안 두고, 시뮬에 진짜 필요한 2MB 남짓만 둔다. */
  const bool have_mpq = [&]{
    FILE* f = fopen((dir + "/StarDat.mpq").c_str(), "rb");
    if (!f) f = fopen((dir + "/stardat.mpq").c_str(), "rb");
    if (!f) return false;
    fclose(f); return true;
  }();
  fprintf(stderr, "자료: %s (%s)\n", dir.c_str(), have_mpq ? "MPQ" : "풀어 놓은 파일");
  game_player player;
  if (have_mpq) player.init(data_loading::data_files_directory(a_string(dir.c_str())));
  else player.init(load_file);
  action_state action_st;
  replay_state replay_st;
  replay_functions rf(player.st(), action_st, replay_st);
  /* 옛 형식이면 OpenBW의 읽개로, 리마스터(1.21+)면 우리 읽개로 — 표식과 압축이 달라
     한쪽 읽개로는 다른 쪽을 못 읽는다(modern_replay.h 머리말). */
  if (data_loading::is_modern_replay(argv[2])) {
    fprintf(stderr, "리플레이 형식: 리마스터(1.21+)\n");
    auto file_r = data_loading::file_reader<>(a_string(argv[2]));
    /* 지도(.chk)를 옆으로 빼 둔다 — BWDUMP_CHK에 경로를 주면 그 파일로 쓴다.
       지도가 선언한 유닛 수와 시뮬이 실제로 세운 수를 견주는 데 쓴다. */
    std::vector<uint8_t> chk;
    rf.load_replay(data_loading::make_modern_replay_file_reader(file_r), true,
                   getenv("BWDUMP_CHK") ? &chk : nullptr);
    if (getenv("BWDUMP_CHK") && !chk.empty()) {
      FILE* c = fopen(getenv("BWDUMP_CHK"), "wb");
      if (c) { fwrite(chk.data(), 1, chk.size(), c); fclose(c);
        fprintf(stderr, "지도 %zu 바이트를 %s 로 뺐다\n", chk.size(), getenv("BWDUMP_CHK")); }
    }
  } else {
    fprintf(stderr, "리플레이 형식: 옛것\n");
    std::vector<uint8_t> chk;
    auto file_r = data_loading::file_reader<>(a_string(argv[2]));
    rf.load_replay(data_loading::make_replay_file_reader(file_r), true,
                   getenv("BWDUMP_CHK") ? &chk : nullptr);
    if (getenv("BWDUMP_CHK") && !chk.empty()) {
      FILE* c = fopen(getenv("BWDUMP_CHK"), "wb");
      if (c) { fwrite(chk.data(), 1, chk.size(), c); fclose(c); }
    }
  }

  state& st = player.st();
  fprintf(stderr, "맵 %dx%d · 끝 프레임 %d · 이름 %s\n",
    (int)st.game->map_width, (int)st.game->map_height, (int)replay_st.end_frame,
    replay_st.map_name.c_str());
  for (size_t i = 0; i != 12; ++i) {
    if (!replay_st.player_name[i].empty())
      fprintf(stderr, "  자리 %zu: %s · 미네랄 %d · 가스 %d\n", i,
        replay_st.player_name[i].c_str(), (int)st.current_minerals[i], (int)st.current_gas[i]);
    if (getenv("BWDUMP_SLOTS"))
      fprintf(stderr, "     └ 명령 임자번호 %d · 종족 %d · 조종 %d\n",
        (int)action_st.player_id[i], (int)st.players[i].race, (int)st.players[i].controller);
  }

  if (getenv("BWDUMP_IDX")) {
    size_t n = 0, mn = (size_t)-1, mx = 0;
    for (unit_t* u : ptr(st.visible_units)) {
      n += 1; mn = std::min(mn, (size_t)u->index); mx = std::max(mx, (size_t)u->index);
    }
    fprintf(stderr, "시작 유닛 %zu기 · index %zu~%zu · 첫 유닛 id32 %u\n", n, mn, mx,
      st.visible_units.empty() ? 0u : (unsigned)rf.get_unit_id_32(&*st.visible_units.begin()).raw_value);
  }
  if (getenv("BWDUMP_CMDS")) {
    const auto& b = replay_st.actions_data_buffer;
    size_t p = 0; int shown = 0;
    while (p + 5 <= b.size() && shown < 14) {
      int frame = (int)(b[p] | (b[p+1]<<8) | (b[p+2]<<16) | ((unsigned)b[p+3]<<24));
      size_t len = b[p+4];
      fprintf(stderr, "프레임 %6d · %2zu바이트:", frame, len);
      for (size_t i = 0; i < len && p+5+i < b.size(); ++i) fprintf(stderr, " %02x", b[p+5+i]);
      fprintf(stderr, "\n");
      p += 5 + len; shown += 1;
    }
  }
  printf("frame\tid\towner\ttype\tx\ty\thp\tshield\tenergy\tcompleted\n");
  while ((int)st.current_frame < (int)replay_st.end_frame) {
    rf.next_frame();
    if ((int)st.current_frame % step) continue;
    for (unit_t* u : ptr(st.visible_units)) {
      printf("%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n",
        (int)st.current_frame, (int)rf.get_unit_id(u).raw_value, (int)u->owner,
        (int)u->unit_type->id, u->position.x, u->position.y,
        u->hp.raw_value / 256, u->shield_points.raw_value / 256,
        u->energy.raw_value / 256, rf.u_completed(u) ? 1 : 0);
    }
  }
  fprintf(stderr, "끝\n");
  return 0;
}
