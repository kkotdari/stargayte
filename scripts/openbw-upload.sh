#!/bin/sh
# 게임 자료를 운영 서버 볼륨에 올린다 — 서버를 세울 때 **한 번만** 한다.
#
#   scripts/openbw-upload.sh https://<서버> <토큰>
#
# 왜 수동인가: 이 자료는 주인 기계의 스타크래프트 설치본에서 뽑은 것이라 서버가 스스로
# 구할 데가 없다. 저작물이라 저장소에도 이미지에도 안 담기로 했으니(tools/openbw/README.md
# '자료 파일과 법') 배포 아티팩트에도 안 실린다. 자료를 가진 기계에서 한 번 밀어 넣는
# 수밖에 없고, 볼륨은 한 번 채우면 재배포에도 그대로 남는다.
#
# 순서:
#   1. 서버에 OPENBW_BOOTSTRAP_TOKEN을 채워 배포한다(영문·숫자로 — HTTP 헤더로 간다).
#   2. 이 스크립트를 돌린다.
#   3. OPENBW_BOOTSTRAP_TOKEN을 **비우고 다시 배포한다**. 문이 닫힌다.
set -e
cd "$(dirname "$0")/.."

SERVER="$1"
TOKEN="$2"
DATA="${OPENBW_DATA:-tools/openbw/data}"

if [ -z "$SERVER" ] || [ -z "$TOKEN" ]; then
  echo "쓰기: scripts/openbw-upload.sh https://<서버> <토큰>" >&2
  echo "  자료 폴더는 $DATA (OPENBW_DATA로 바꾼다)" >&2
  exit 2
fi
if [ ! -f "$DATA/arr/units.dat" ]; then
  echo "자료가 없다: $DATA/arr/units.dat" >&2
  echo "  먼저 뽑아라: tools/openbw/cascextract /Applications/StarCraft $DATA" >&2
  exit 2
fi

TGZ=$(mktemp -t bwdata).tgz
trap 'rm -f "$TGZ"' EXIT

# COPYFILE_DISABLE — 맥 tar는 파일마다 확장 속성을 ._이름으로 함께 넣는다(AppleDouble).
# 안 막으면 개수가 두 배가 된다. 받는 쪽에서도 거르지만 보낼 짐부터 줄인다.
echo "· 묶는 중 ($(find "$DATA" -type f | wc -l | tr -d ' ')개)"
COPYFILE_DISABLE=1 tar czf "$TGZ" -C "$DATA" .
echo "· ${SERVER%/}/api/openbw/data 로 $(du -h "$TGZ" | cut -f1) 보내는 중"

# set -e에 안 걸리게 — curl이 실패해도(호스트를 못 찾는 따위) 아래에서 말해 주려면
# 여기서 죽으면 안 된다.
OUT=$(curl -sS -X POST "${SERVER%/}/api/openbw/data" \
  -H "X-Bootstrap-Token: $TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary "@$TGZ" -w '\n%{http_code}') || OUT=""
CODE=$(printf '%s' "$OUT" | tail -1)
BODY=$(printf '%s' "$OUT" | sed '$d')

echo "$BODY"
case "$CODE" in
  200) ;;
  404) echo "" >&2
       echo "문이 안 열려 있다 — 서버의 OPENBW_BOOTSTRAP_TOKEN이 비었거나 토큰이 다르다." >&2
       echo "(열려 있다는 것조차 안 알리려고 403이 아니라 404다.)" >&2
       exit 1 ;;
  *)   echo "" >&2; echo "실패 (HTTP $CODE)" >&2; exit 1 ;;
esac

case "$BODY" in
  *'"ready":true'*)
    echo ""
    echo "됐다. 이제 OPENBW_BOOTSTRAP_TOKEN을 **비우고 다시 배포해서 문을 닫아라.**"
    echo "그 다음 경기를 재분석하면 참값 자취가 구워진다." ;;
  *)
    echo ""
    echo "자료는 깔렸지만 아직 못 굽는다 — 위 reason을 봐라." >&2
    exit 1 ;;
esac
