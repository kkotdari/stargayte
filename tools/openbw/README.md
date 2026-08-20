# OpenBW 헤드리스 덤퍼 (실현 가능성 확인 완료)

리플레이를 **유추하지 않고 실제로 시뮬레이션**해서, 프레임마다 유닛의 참값을 뽑는다.
지금 우리 파이프라인(커맨드 증거 → 정체 유추 → 원장 결합 → 자체 시뮬)이 하는 일을
통째로 대신할 수 있는 자리다.

## 확인된 것

* OpenBW는 **헤더 온리 C++**다(`bwgame.h` 800KB + `replay.h`). BWAPI도 SDL도 필요 없다.
* 맥(Apple clang 21, arm64)에서 **한 번에 빌드된다** — 963KB 실행 파일, 의존성 0.
* 시뮬에 실제로 필요한 자료는 **파일 열 개**뿐이다(그림·소리는 한 장도 안 쓴다):

  ```
  arr/units.dat      arr/weapons.dat   arr/upgrades.dat  arr/techdata.dat
  arr/flingy.dat     arr/sprites.dat   arr/images.dat    arr/orders.dat
  arr/images.tbl     scripts/iscript.bin
  ```

  합쳐 2MB 남짓이다. MPQ 셋(Patch_rt·BrooDat·StarDat)을 그대로 가리켜도 되고, 위
  열 개만 풀어 둬도 된다 — 덤퍼가 둘 다 받는다.
* 지도는 리플레이 안에 들어 있다. 따로 안 필요하다.

## 빌드

```
git clone --depth 1 https://github.com/OpenBW/openbw
clang++ -std=c++17 -O2 -w -I openbw -o bwdump bwdump.cpp
```

## 실행

```
./bwdump <자료폴더> <리플레이.rep> [프레임간격]     # 자료폴더 = 스타 설치 폴더 또는 풀어 둔 폴더
```

프레임·유닛마다 `id owner type x y hp shield energy completed`를 탭으로 내보낸다.
이것이 곧 지금 `SimTrack`이 담는 것과 같은 내용이고, 다른 점은 **어림이 아니라 참값**이라는
것뿐이다.

## 남은 일

1. 자료 열 개(또는 MPQ 셋)를 구해 한 판 돌려 본다 — 여기서 막혀 있다.
2. 지금 파이프라인과 대조한다: 정체 판정·원장 결합률·죽음 판정이 실제로 몇 %를 맞히나.
   지금까지 이 프로젝트에는 **정답표가 없었다** — 이 대조가 처음으로 그것을 만든다.
3. 결과가 확실하면 분석 시각에 서버에서 한 번 돌려 트랙을 굽고, 웹앱은 그대로 둔다.
