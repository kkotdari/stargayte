// 카카오톡 공유 카드의 썸네일(public/images/share/*.png)을 만드는 스크립트.
//
//   NODE_PATH=$(npm root -g) node scripts/make-share-thumbs.cjs
//
// 왜 스크립트로 두느냐: 그림 다섯 장이 로고 원본(public/images/logo/logo_black.png)과 아래
// 문구·치수에서 나온 결과물이라, 로고가 바뀌거나 포스트 종류가 늘면 다시 뽑아야 한다.
// 손으로 만든 PNG만 커밋해 두면 무엇으로 어떻게 만들었는지가 사라진다.
// 글꼴은 앱과 같은 Pretendard를 CDN에서 받아 쓰므로 실행에 네트워크가 필요하다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/images/share');

// 카카오 피드 템플릿의 그림 자리는 2:1이다(사용자 스크린샷 실측: 816×405). 800×400이
// 권장값이고, 여기서는 고해상도 화면을 위해 1.5배(1200×600)로 뽑는다.
const W = 1200, H = 600;
const LOGO = fs.readFileSync(path.join(ROOT, 'public/images/logo/logo_black.png')).toString('base64');

const KINDS = [
  { file: 'share_thumb_challenge_call.png',    label: '너 나와! 호출' },
  { file: 'share_thumb_challenge_reply.png',   label: '너 나와! 응답' },
  { file: 'share_thumb_game_result_list.png',  label: '게임결과 목록' },
  { file: 'share_thumb_game_result.png',       label: '게임결과' },
  { file: 'share_thumb_rank_shift.png',        label: '랭크 변동' },
  // 활동의 '알림' 갈래가 통째로 쓰는 한 장(요청: 카톡 미리보기를 알림으로 통일) — 칭호
  // 변경도 랭크 변동도 이제 같은 갈래라, 칭호가 바뀐 글에 '랭크 변동' 그림이 붙어 나갔다.
  { file: 'share_thumb_notice.png',            label: '알림' },
];

const page = (label) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>
  html,body{margin:0;padding:0}
  .card{
    width:${W}px;height:${H}px;box-sizing:border-box;
    background:#f2f4f7;
    display:flex;flex-direction:column;align-items:center;justify-content:space-between;
    padding:74px 80px 66px;
    font-family:'Pretendard Variable',Pretendard,sans-serif;
  }
  .logo{width:640px;display:block}
  .label{
    font-size:76px;font-weight:800;letter-spacing:-0.02em;color:#10151a;
    line-height:1;white-space:nowrap;
  }
  .rule{width:120px;height:6px;border-radius:3px;background:#f5a623}
</style></head><body>
<div class="card">
  <img class="logo" src="data:image/png;base64,${LOGO}">
  <div class="rule"></div>
  <div class="label">${label}</div>
</div></body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const k of KINDS) {
    await p.setContent(page(k.label), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const el = await p.$('.card');
    await el.screenshot({ path: path.join(OUT, k.file) });
    console.log('wrote', k.file);
  }
  await b.close();
})();
