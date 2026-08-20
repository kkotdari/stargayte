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
#include <cstring>
#include <map>
#include <vector>
#include <algorithm>

static int g_ok[64] = {0}, g_slot[64] = {0}, g_tot[64] = {0};
/** 고르기가 유닛을 찾았나 — 1분 칸으로 모은다(23.81프레임 = 1초). */
static int g_first[256], g_cnt[256];
/** 명령 갈래마다 **처음 나온 프레임**을 적어 둔다 — 어긋남이 시작되는 시각과 견주면
 *  "그 무렵 처음 쓰인 명령"이 범인 후보로 좁혀진다. */
void bwdump_action(int id, int frame) {
  id &= 0xff;
  if (!g_cnt[id]) g_first[id] = frame;
  g_cnt[id] += 1;
}
/* 세대(generation) 어긋남 재기 — 리플레이가 적어 온 세대와 우리가 센 세대의 **차이**를
   분 단위로 모은다. 차이가 늘 같은 수면 세는 시점만 다른 것이고(고치면 끝), 시각이
   갈수록 흩어지면 유닛이 나고 죽는 차례가 진짜로 갈라진 것이다. */
static std::map<int,int> g_gen[64];
static int g_gen_tot[64] = {0};
static std::map<int,int> g_pair;
void bwdump_gen(int frame, unsigned want, unsigned got, unsigned kind) {
  (void)kind;
  int b = frame / 1429; if (b > 63) b = 63;
  g_gen[b][(int)want - (int)got] += 1;
  /* 짝 그대로도 센다 — "우리는 한 번도 안 쓴 자리(0)인데 리플레이는 2라고 한다"면
     실제 게임이 그 자리를 두 번 더 돌려 쓴 것이고, 그건 우리가 안 죽인 유닛이 있다는 뜻이다. */
  g_pair[((int)got << 8) | (int)(want & 0xff)] += 1;
  g_gen_tot[b] += 1;
}
static void bwdump_gen_report() {
  if (!getenv("BWDUMP_GEN")) return;
  {
    fprintf(stderr, "\n(우리 세대 → 리플레이 세대) 짝, 많은 차례로\n");
    std::vector<std::pair<int,int>> v(g_pair.begin(), g_pair.end());
    std::sort(v.begin(), v.end(), [](const std::pair<int,int>& a, const std::pair<int,int>& c){ return a.second > c.second; });
    int tot = 0; for (auto& e : v) tot += e.second;
    for (size_t i = 0; i < v.size() && i < 14; i += 1)
      fprintf(stderr, "  %2d → %-3d  %5d회 (%.1f%%)%s\n", v[i].first >> 8, v[i].first & 0xff,
        v[i].second, v[i].second * 100.0 / tot, (v[i].first >> 8) == (v[i].first & 0xff) ? "  맞음" : "");
  }
  fprintf(stderr, "\n세대 차이(리플레이가 적은 값 − 우리가 센 값), 분마다 앞 4가지\n");
  for (int b = 0; b < 64; b += 1) {
    if (!g_gen_tot[b]) continue;
    std::map<int,int>& m = g_gen[b];
    std::vector<std::pair<int,int>> v(m.begin(), m.end());
    std::sort(v.begin(), v.end(), [](const std::pair<int,int>& a, const std::pair<int,int>& c){ return a.second > c.second; });
    fprintf(stderr, "  %2d분  n=%-5d ", b, g_gen_tot[b]);
    for (size_t i = 0; i < v.size() && i < 4; i += 1)
      fprintf(stderr, "  %+d:%.0f%%", v[i].first, v[i].second * 100.0 / g_gen_tot[b]);
    fprintf(stderr, "   (갈래 %d)\n", (int)v.size());
  }
}
static std::map<int,int> g_fit[64];
static int g_fit_tot[64] = {0};
void bwdump_shiftfit(int frame, int d, bool found) {
  int b = frame / 1429; if (b > 63) b = 63;
  g_fit[b][d] += 1; g_fit_tot[b] += 1;
}
static void bwdump_fit_report() {
  if (!getenv("BWDUMP_FIT")) return;
  fprintf(stderr, "\n못 찾은 고르기를 몇 칸 옮기면 맞나 (99=아무 데도 없음)\n");
  for (int b = 0; b < 64; b += 1) {
    if (!g_fit_tot[b]) continue;
    std::vector<std::pair<int,int>> v(g_fit[b].begin(), g_fit[b].end());
    std::sort(v.begin(), v.end(), [](const std::pair<int,int>& a, const std::pair<int,int>& c){ return a.second > c.second; });
    fprintf(stderr, "  %2d분  실패 %-5d ", b, g_fit_tot[b]);
    for (size_t i = 0; i < v.size() && i < 5; i += 1)
      fprintf(stderr, "  %+d:%.0f%%", v[i].first, v[i].second * 100.0 / g_fit_tot[b]);
    fprintf(stderr, "\n");
  }
}
static std::map<std::string,int> g_why;
void bwdump_why(const char* what, int step) {
  if (!getenv("BWDUMP_WHY")) return;
  char k[64]; snprintf(k, sizeof k, "%s#%d", what, step);
  g_why[k] += 1;
}
static int g_when = 0;
void bwdump_when(const char* what, int frame, int owner, int extra) {
  if (!getenv("BWDUMP_WHEN")) return;
  if (strstr(what, ":") == nullptr) return;      /* 실패만 */
  if (g_when++ >= 24) return;
  fprintf(stderr, "  %7.1f초  임자%d  %s (곁수 %d)\n", frame / 23.81, owner, what, extra);
}
static std::map<std::string,int> g_own;
void bwdump_owner(const char* what, int co, int uo) {
  if (!getenv("BWDUMP_WHY")) return;
  char k[80]; snprintf(k, sizeof k, "%-10s 명령임자%d → 유닛임자%d", what, co, uo);
  g_own[k] += 1;
}
static void bwdump_why_report() {
  if (!getenv("BWDUMP_WHY")) return;
  fprintf(stderr, "\n생산 명령이 어디서 막히나 (#0=들어온 횟수, 나머지=막힌 관문)\n");
  for (const auto& kv : g_why) fprintf(stderr, "  %-12s %6d\n", kv.first.c_str(), kv.second);
  fprintf(stderr, "\n임자별로\n");
  for (const auto& kv : g_own) fprintf(stderr, "  %-40s %6d\n", kv.first.c_str(), kv.second);
}
static std::map<int,int> g_trig;
void bwdump_trig(int type) { g_trig[type] += 1; }
static void bwdump_trig_report() {
  if (!getenv("BWDUMP_TRIG")) return;
  fprintf(stderr, "\n트리거 (−1 = 트리거 도는 횟수)\n");
  for (const auto& kv : g_trig) fprintf(stderr, "  동작 %3d  %7d회\n", kv.first, kv.second);
  if (g_trig.empty()) fprintf(stderr, "  한 번도 안 돔\n");
}
int bwdump_cur_owner = -1;
static int g_po[12][64] = {{0}}, g_pt[12][64] = {{0}};
static void bwdump_owner_time_report() {
  if (!getenv("BWDUMP_PT")) return;
  fprintf(stderr, "\n임자별 · 분별 고르기 적중률\n     ");
  for (int b = 0; b < 16; ++b) fprintf(stderr, "%6d분", b);
  fprintf(stderr, "\n");
  for (int p = 0; p < 12; ++p) {
    int any = 0; for (int b = 0; b < 64; ++b) any += g_pt[p][b];
    if (!any) continue;
    fprintf(stderr, "  임자%d", p);
    for (int b = 0; b < 16; ++b)
      if (g_pt[p][b]) fprintf(stderr, "%5.0f%%%c", g_po[p][b] * 100.0 / g_pt[p][b], ' ');
      else fprintf(stderr, "      -");
    fprintf(stderr, "\n");
  }
}
static std::map<std::string,int> g_fail;
static std::map<std::string,int> g_fail_first;
void bwdump_fail(const char* why, int frame, int id) {
  g_fail[why] += 1;
  if (frame >= 0 && !g_fail_first.count(why)) g_fail_first[why] = frame;
}
static void bwdump_fail_report() {
  if (g_fail.empty()) { fprintf(stderr, "\n유닛 만들기가 막힌 적 없음\n"); return; }
  fprintf(stderr, "\n유닛·그릇 만들기 실패\n");
  for (const auto& kv : g_fail)
    fprintf(stderr, "  %-32s %6d회  처음 %.1f초\n", kv.first.c_str(), kv.second,
      g_fail_first.count(kv.first) ? g_fail_first[kv.first] / 23.81 : -1.0);
}
static int g_map[3] = {0,0,0};
void bwdump_map(int which) { if (which >= 0 && which < 3) g_map[which] += 1; }
static void bwdump_map_report() {
  if (!getenv("BWDUMP_DUAL")) return;
  int t = g_map[0] + g_map[1] + g_map[2];
  if (!t) return;
  fprintf(stderr, "\n자리 셈 맞대기 — 1700 빼기 %d회(%.1f%%) · 그대로 %d회(%.1f%%) · 둘 다 아님 %d회(%.1f%%)\n",
    g_map[0], g_map[0]*100.0/t, g_map[1], g_map[1]*100.0/t, g_map[2], g_map[2]*100.0/t);
}
static int g_shown = 0;
static int g_firstmiss = -1;
void bwdump_resolve(int frame, bool ok, bool slot, unsigned raw) {
  /* 태그 0은 **표적이 없다**는 뜻이다(빈 땅 우클릭) — 실패가 아니라 정상이다.
     이걸 실패로 세면 적중률이 통째로 낮게 나온다(처음에 56%로 보였던 것이 그것이다). */
  if (raw == 0) return;
  int b = frame / 1429; if (b > 63) b = 63;
  g_tot[b] += 1; if (ok) g_ok[b] += 1; if (slot) g_slot[b] += 1;
  if (bwdump_cur_owner >= 0 && bwdump_cur_owner < 12) { g_pt[bwdump_cur_owner][b] += 1; if (ok) g_po[bwdump_cur_owner][b] += 1; }
  if (!ok && g_firstmiss < 0) g_firstmiss = frame;
  if (!ok && getenv("BWDUMP_MISSTAGS")) fprintf(stderr, "MISS\t%u\t%d\n", raw, frame);
  if (!ok && slot && getenv("BWDUMP_FIRSTMISS") && g_shown < 14) {
    g_shown += 1;
    fprintf(stderr, "  세대만 틀림 · 프레임 %d (%.1f초) · 자리 %u · 리플레이 세대 %u\n",
      frame, frame / 23.81, (raw & 0x1fff), raw >> 13);
  }
}
bw_limits_t bw_limits;      /* 그릇 한도 — 요즘 리플레이면 아래에서 리마스터 값으로 올린다 */
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
    /* 리마스터는 그릇 한도를 두 배로 늘렸다 — 리플레이의 LMTS 구획에 적힌 값이 이것이다.
       유닛 자리 번호가 `한도 − 몇째로 만들어졌나`라서, 1700칸으로 두면 번호가 통째로
       1700씩 어긋나 명령이 유닛을 못 찾는다. */
    bw_limits.units = 3400; bw_limits.bullets = 400; bw_limits.sprites = 5000;
    bw_limits.images = 10000; bw_limits.orders = 4000; bw_limits.thingies = 1000;
    /* 하나씩 되돌려 보기(시험용) */
    if (getenv("BWLIM_BULLETS")) bw_limits.bullets = (size_t)atoi(getenv("BWLIM_BULLETS"));
    if (getenv("BWLIM_SPRITES")) bw_limits.sprites = (size_t)atoi(getenv("BWLIM_SPRITES"));
    if (getenv("BWLIM_IMAGES")) bw_limits.images = (size_t)atoi(getenv("BWLIM_IMAGES"));
    if (getenv("BWLIM_ORDERS")) bw_limits.orders = (size_t)atoi(getenv("BWLIM_ORDERS"));
    if (getenv("BWLIM_THINGIES")) bw_limits.thingies = (size_t)atoi(getenv("BWLIM_THINGIES"));
    fprintf(stderr, "그릇 한도: 유닛 %zu · 스프라이트 %zu · 이미지 %zu\n",
      bw_limits.units, bw_limits.sprites, bw_limits.images);
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
  /* 태그(tag) 칸이 대조의 열쇠다 — 리플레이 명령이 유닛을 가리킬 때 쓰는 바로 그 수라,
     우리 분석이 붙인 개체와 **한 자리도 안 틀리고** 짝지을 수 있다. 리마스터 규약은
     (index + 1 + 1700) | (generation << 13) 이다(actions.h의 get_unit_scr 머리말). */
  /* --units: 프레임마다 전부 뱉는 대신 **유닛 생애표**만 낸다. 태그마다 한 줄로
     [정체·임자·태어난 프레임·마지막으로 보인 프레임·죽었나·첫 자리·끝 자리]다.
     대조(scripts/truth-check.mjs)에는 이게 자리마다의 좌표보다 훨씬 쓸모 있고, 매 프레임을
     빠짐없이 훑으므로 **한 프레임만 살다 간 유닛도 안 놓친다**. */
  bool units_mode = false;
  for (int i = 3; i < argc; ++i) if (std::string(argv[i]) == "--units") units_mode = true;
  struct life_t { int kind, owner, born, last; int bx, by, lx, ly; };
  std::map<unsigned, life_t> lives;
  if (units_mode) {
    while ((int)st.current_frame < (int)replay_st.end_frame) {
      rf.next_frame();
      /* 보이는 것 + **숨은 것**(수송선 안·건물 안)까지 훑는다 — 실려 있는 동안은
         visible_units에서 빠지므로, 그것만 보면 드랍된 유닛이 통째로 안 잡힌다. */
      std::vector<unit_t*> all9;
      for (unit_t* u : ptr(st.visible_units)) all9.push_back(u);
      for (unit_t* u : ptr(st.hidden_units)) all9.push_back(u);
      for (unit_t* u : all9) {
        const unsigned tg = (unsigned)((u->index + 1)
          | ((u->unit_id_generation % (1u << 19)) << 13));
        auto it = lives.find(tg);
        if (it == lives.end()) {
          lives.emplace(tg, life_t{ (int)u->unit_type->id, (int)u->owner,
            (int)st.current_frame, (int)st.current_frame,
            u->position.x, u->position.y, u->position.x, u->position.y });
        } else {
          it->second.last = (int)st.current_frame;
          it->second.lx = u->position.x;
          it->second.ly = u->position.y;
        }
      }
    }
    printf("tag\tkind\towner\tborn\tlast\tdied\tbx\tby\tlx\tly\n");
    for (const auto& kv : lives) {
      const auto& L = kv.second;
      printf("%u\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n", kv.first, L.kind, L.owner,
        L.born, L.last, L.last < (int)replay_st.end_frame - 1 ? 1 : 0, L.bx, L.by, L.lx, L.ly);
    }
    fprintf(stderr, "유닛 %zu기의 생애를 냈다\n", lives.size());
    if (getenv("BWDUMP_RESOLVE")) {
      fprintf(stderr, "  명령 갈래마다 처음 나온 시각:\n");
      {
        int order[256]; int n = 0;
        for (int i = 0; i < 256; ++i) if (g_cnt[i]) order[n++] = i;
        for (int a = 0; a < n; ++a) for (int b = a + 1; b < n; ++b)
          if (g_first[order[b]] < g_first[order[a]]) { int t = order[a]; order[a] = order[b]; order[b] = t; }
        for (int i = 0; i < n; ++i)
          fprintf(stderr, "    %3d(0x%02x)  처음 %6d프레임(%5.1f초) · %d회\n",
            order[i], order[i], g_first[order[i]], g_first[order[i]] / 23.81, g_cnt[order[i]]);
      }
      fprintf(stderr, "  분  고르기  찾음   슬롯만\n");
      for (int b = 0; b < 64; ++b) if (g_tot[b])
        fprintf(stderr, "  %2d  %6d  %5.1f%%  %5.1f%%\n", b, g_tot[b],
          g_ok[b] * 100.0 / g_tot[b], g_slot[b] * 100.0 / g_tot[b]);
    }
    bwdump_gen_report();
    bwdump_fit_report();
    bwdump_why_report();
    bwdump_map_report();
    bwdump_fail_report();
    bwdump_trig_report();
    bwdump_owner_time_report();
    {
      int o = 0, t = 0;
      for (int b = 0; b < 64; ++b) { o += g_ok[b]; t += g_tot[b]; }
      fprintf(stderr, "요약\t첫어긋남 %.1f초\t전체적중 %.1f%%\t유닛 %zu기\n",
        g_firstmiss < 0 ? 9999.0 : g_firstmiss / 23.81, t ? o * 100.0 / t : 0.0, lives.size());
    }
    for (size_t i = 0; i != 8; ++i) {
      if (replay_st.player_name[i].empty()) continue;
      fprintf(stderr, "  %-16s 끝 자원 미네랄 %6d · 가스 %5d · 캔 미네랄 %7d\n",
        replay_st.player_name[i].c_str(), (int)st.current_minerals[i], (int)st.current_gas[i],
        (int)st.total_minerals_gathered[i]);
    }
    return 0;
  }
  printf("frame\ttag\towner\ttype\tx\ty\thp\tshield\tenergy\tcompleted\n");
  while ((int)st.current_frame < (int)replay_st.end_frame) {
    rf.next_frame();
    if ((int)st.current_frame % step) continue;
    for (unit_t* u : ptr(st.visible_units)) {
      const unsigned scr_tag = (unsigned)((u->index + 1)
        | ((u->unit_id_generation % (1u << 19)) << 13));
      printf("%d\t%u\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n",
        (int)st.current_frame, scr_tag, (int)u->owner,
        (int)u->unit_type->id, u->position.x, u->position.y,
        u->hp.raw_value / 256, u->shield_points.raw_value / 256,
        u->energy.raw_value / 256, rf.u_completed(u) ? 1 : 0);
    }
  }
  fprintf(stderr, "끝\n");
  return 0;
}
