/* 스타 설치본(MPQ 셋)에서 **시뮬에 쓰이는 파일 열 개만** 뽑아낸다.
 *   bwextract <스타설치폴더> <낼폴더>
 *
 * 왜 뽑나 — 배포하는 서버가 통짜 설치본(수백 MB, 그림·소리·영상)을 지고 갈 이유가 없다.
 * OpenBW가 시뮬레이션에 실제로 여는 것은 아래 열 개뿐이고 합쳐 2MB 남짓이다.
 * MPQ 읽기는 OpenBW의 것을 그대로 쓴다(따로 가져올 것이 없다). */
#include "data_loading.h"
#include <cstdio>
#include <string>
#include <sys/stat.h>

using namespace bwgame;

static const char* FILES[] = {
  "arr/units.dat", "arr/weapons.dat", "arr/upgrades.dat", "arr/techdata.dat",
  "arr/flingy.dat", "arr/sprites.dat", "arr/images.dat", "arr/orders.dat",
  "arr/images.tbl", "scripts/iscript.bin",
};

static void mkdirp(const std::string& p) {
  for (size_t i = 1; i < p.size(); ++i) if (p[i] == '/') mkdir(p.substr(0, i).c_str(), 0755);
  mkdir(p.c_str(), 0755);
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "쓰기: bwextract <스타설치폴더> <낼폴더>\n"); return 2; }
  std::string src = argv[1];
  std::string dst = argv[2];
  auto load = data_loading::data_files_directory(a_string(src.c_str()));
  mkdirp(dst + "/arr");
  mkdirp(dst + "/scripts");
  size_t total = 0;
  for (const char* name : FILES) {
    a_vector<uint8_t> buf;
    load(buf, a_string(name));
    std::string out = dst + "/" + name;
    FILE* f = fopen(out.c_str(), "wb");
    if (!f) { fprintf(stderr, "못 씀: %s\n", out.c_str()); return 1; }
    fwrite(buf.data(), 1, buf.size(), f);
    fclose(f);
    total += buf.size();
    printf("%-22s %8zu 바이트\n", name, buf.size());
  }
  printf("합계 %.2f MB — 이 폴더만 있으면 시뮬이 돈다.\n", total / 1048576.0);
  return 0;
}
