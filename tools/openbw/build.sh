#!/bin/sh
# OpenBW 헤드리스 도구 빌드 — 맥·리눅스 공용. cmake도 SDL도 BWAPI도 안 쓴다.
#   ./build.sh            소스를 받아 bwdump·cascextract를 만든다
set -e
cd "$(dirname "$0")"

[ -d openbw ] || git clone --depth 1 https://github.com/OpenBW/openbw openbw
# 리마스터(1.21+) 명령 여섯을 더한다 — 없으면 요즘 리플레이는 첫 고르기에서 죽는다.
( cd openbw && git checkout -- . && git apply ../openbw-scr.patch )

[ -d CascLib ] || git clone --depth 1 https://github.com/ladislav-zezula/CascLib.git CascLib

echo "· bwdump"
c++ -std=c++17 -O2 -w -I openbw -o bwdump bwdump.cpp -lz

echo "· cascextract"
cc -std=gnu99 -O2 -w -c CascLib/src/jenkins/lookup3.c -o lookup3.o
c++ -std=c++17 -O2 -w -DCASC_USE_SYSTEM_ZLIB -o cascextract cascextract.cpp \
  $(find CascLib/src -maxdepth 1 -name "*.cpp" ! -name "DllMain*" | tr '\n' ' ') \
  $(find CascLib/src/common CascLib/src/hashes -name "*.cpp" | tr '\n' ' ') \
  CascLib/src/overwatch/apm.cpp CascLib/src/overwatch/cmf.cpp CascLib/src/overwatch/aes.cpp \
  lookup3.o -lz
rm -f lookup3.o

echo "됐다. 쓰기:"
echo "  ./cascextract /Applications/StarCraft ./data     # 자료 뽑기(한 번만)"
echo "  ./bwdump ./data <리플레이.rep> [프레임간격]      # 참값 뽑기"
