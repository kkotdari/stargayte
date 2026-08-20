/* OpenBW 헤드리스 리플레이 덤퍼 — 프레임마다 유닛 상태를 내보낸다.
 *   bwdump <자료폴더> <리플레이.rep> [프레임간격]
 * 자료폴더에는 MPQ가 아니라 **풀어 놓은 파일 열 개**만 있으면 된다:
 *   arr/{units,weapons,upgrades,techdata,flingy,sprites,images,orders}.dat
 *   arr/images.tbl · scripts/iscript.bin
 * 그림·소리는 한 장도 안 쓴다(시뮬레이션만 한다). */
#include "replay.h"
#include <cstdio>
#include <string>

using namespace bwgame;

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "쓰기: bwdump <자료폴더> <리플레이.rep> [간격]\n"); return 2; }
  std::string dir = argv[1];
  const int step = argc > 3 ? atoi(argv[3]) : 24;

  auto load_file = [&](a_vector<uint8_t>& dst, a_string filename) {
    std::string p = dir + "/" + filename.c_str();
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
  rf.load_replay_file(argv[2]);

  state& st = player.st();
  fprintf(stderr, "맵 %dx%d · 끝 프레임 %d\n",
    (int)st.game->map_width, (int)st.game->map_height, (int)replay_st.end_frame);

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
