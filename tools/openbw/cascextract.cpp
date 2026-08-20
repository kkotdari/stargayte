/* CASC(스타크래프트 리마스터) 설치본에서 시뮬용 파일 열 개만 뽑는다.
 *   cascextract <스타설치폴더> <낼폴더>
 * 리마스터는 옛 MPQ가 아니라 CASC로 자료를 담는다(Data/data/*.NNN + indices).
 * 그래서 MPQ용 bwextract가 아니라 이쪽을 쓴다. */
#include "CascLib/src/CascLib.h"
#include <cstdio>
#include <cstring>
#include <string>
#include <sys/stat.h>

static const char* FILES[] = {
  "arr\\units.dat", "arr\\weapons.dat", "arr\\upgrades.dat", "arr\\techdata.dat",
  "arr\\flingy.dat", "arr\\sprites.dat", "arr\\images.dat", "arr\\orders.dat",
  "arr\\images.tbl", "scripts\\iscript.bin",
  /* 밀리 방식의 승패·시작 조건이 든 트리거 — 시뮬이 게임을 '시작'하려면 이것도 읽는다.
     (staredit/scenario.chk는 리플레이 안에 들어 있어 따로 안 뽑는다.) */
  "triggers\\Melee.trg",
};

static void mkdirp(const std::string& p) {
  for (size_t i = 1; i < p.size(); ++i) if (p[i] == '/') mkdir(p.substr(0, i).c_str(), 0755);
  mkdir(p.c_str(), 0755);
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "쓰기: cascextract <스타설치폴더> <낼폴더>\n"); return 2; }
  HANDLE storage = NULL;
  if (!CascOpenStorage(argv[1], 0, &storage)) {
    fprintf(stderr, "CASC 못 엶: %s (오류 %u)\n", argv[1], GetCascError());
    return 1;
  }
  std::string dst = argv[2];
  mkdirp(dst + "/arr");
  mkdirp(dst + "/scripts");
  mkdirp(dst + "/triggers");
  size_t total = 0;
  int bad = 0;
  for (const char* name : FILES) {
    HANDLE f = NULL;
    if (!CascOpenFile(storage, name, 0, 0, &f)) {
      fprintf(stderr, "  못 찾음: %s (오류 %u)\n", name, GetCascError());
      bad += 1;
      continue;
    }
    ULONGLONG sz = 0;
    CascGetFileSize64(f, &sz);
    std::string buf;
    buf.resize((size_t)sz);
    DWORD got = 0;
    CascReadFile(f, &buf[0], (DWORD)sz, &got);
    CascCloseFile(f);
    std::string out = dst + "/";
    for (const char* c = name; *c; ++c) out += (*c == '\\' ? '/' : *c);
    FILE* o = fopen(out.c_str(), "wb");
    fwrite(buf.data(), 1, got, o);
    fclose(o);
    total += got;
    printf("%-22s %8u 바이트\n", name, (unsigned)got);
  }
  /* images.tbl이 가리키는 그림 파일들(unit/…) — OpenBW는 시뮬만 해도 이것을 읽는다.
     스프라이트의 칸 수·크기가 iscript와 맞물려 있어서다(그림을 안 그려도 필요하다).
     이름은 전부 images.tbl 안에 있으므로 목록을 따로 구할 필요가 없다:
     맨 앞 uint16이 개수, 그다음이 오프셋 표, 그 뒤가 널로 끝나는 이름들이다. */
  {
    std::string tbl = dst + "/arr/images.tbl";
    FILE* t = fopen(tbl.c_str(), "rb");
    if (t) {
      fseek(t, 0, SEEK_END); long n = ftell(t); fseek(t, 0, SEEK_SET);
      std::string b; b.resize((size_t)n);
      fread(&b[0], 1, (size_t)n, t); fclose(t);
      auto u16 = [&](size_t off) { return (unsigned)(unsigned char)b[off] | ((unsigned)(unsigned char)b[off + 1] << 8); };
      unsigned cnt = u16(0);
      size_t got = 0, miss = 0;
      for (unsigned i = 1; i <= cnt; ++i) {
        size_t off = u16(2 + (i - 1) * 2);
        if (off >= b.size()) continue;
        std::string fn(b.c_str() + off);
        if (fn.empty()) continue;
        std::string casc = "unit\\" + fn;
        HANDLE f = NULL;
        if (!CascOpenFile(storage, casc.c_str(), 0, 0, &f)) { miss += 1; continue; }
        ULONGLONG sz = 0; CascGetFileSize64(f, &sz);
        std::string buf; buf.resize((size_t)sz);
        DWORD rd = 0; CascReadFile(f, &buf[0], (DWORD)sz, &rd);
        CascCloseFile(f);
        std::string out = dst + "/unit/" + fn;
        for (char& c : out) if (c == '\\') c = '/';
        mkdirp(out.substr(0, out.rfind('/')));
        FILE* o = fopen(out.c_str(), "wb");
        if (o) { fwrite(buf.data(), 1, rd, o); fclose(o); total += rd; got += 1; }
      }
      printf("그림표(images.tbl) %u개 중 %zu개 뽑음 · 없음 %zu개\n", cnt, got, miss);
    }
  }
  /* 지형 타일 표 여덟 벌(.vf4 걷기 가능 여부 · .cv5 타일 묶음) — 지도의 걸어갈 수 있는
     칸을 여기서 읽는다. 그림이 아니라 **판정 표**라 시뮬에 반드시 필요하다. */
  {
    static const char* TS[] = { "badlands", "platform", "install", "AshWorld",
                                "Jungle", "Desert", "Ice", "Twilight" };
    mkdirp(dst + "/Tileset");
    for (const char* t : TS) {
      for (const char* ext : { "vf4", "cv5" }) {
        std::string casc = std::string("Tileset\\") + t + "." + ext;
        HANDLE f = NULL;
        if (!CascOpenFile(storage, casc.c_str(), 0, 0, &f)) { fprintf(stderr, "  없음: %s\n", casc.c_str()); bad += 1; continue; }
        ULONGLONG sz = 0; CascGetFileSize64(f, &sz);
        std::string buf; buf.resize((size_t)sz);
        DWORD rd = 0; CascReadFile(f, &buf[0], (DWORD)sz, &rd);
        CascCloseFile(f);
        std::string out = dst + "/Tileset/" + t + "." + ext;
        FILE* o = fopen(out.c_str(), "wb");
        if (o) { fwrite(buf.data(), 1, rd, o); fclose(o); total += rd; }
      }
    }
    printf("지형 타일 표 여덟 벌 뽑음\n");
  }
  CascCloseStorage(storage);
  printf("합계 %.2f MB · 실패 %d개\n", total / 1048576.0, bad);
  return bad ? 1 : 0;
}
