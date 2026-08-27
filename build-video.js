#!/usr/bin/env node
/**
 * 사용 설명 영상 제작 — 스테이징 구성 → 대본 검사 → 프레임 촬영 → 인코딩.
 *
 *   node build-video.js --check    대본 검사까지만 (빠름)
 *   node build-video.js            전부
 *
 * 영상은 배포본과 똑같은 것을 찍어야 하므로 gh-pages 와 같은 구조의
 * 스테이징 폴더를 만들어 그 안에서 촬영한다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const STAGE = path.join(os.tmpdir(), 'aitax-video-stage');
const FRAMES = path.join(os.tmpdir(), 'aitax-video-frames');
const OUT = path.join(ROOT, 'AI세무사_사용설명.mp4');
const FPS = 12;

function buildStage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'AI세무사_단일파일.html'), path.join(STAGE, 'index.html'));
  for (const f of ['walkthrough.html', 'walkthrough-beats.js']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));
  }
  console.log('스테이징: ' + STAGE);
}

async function openStage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('file://' + STAGE.replace(/\\/g, '/') + '/walkthrough.html',
    { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.player && window.player.ready');
  return page;
}

// 대본을 처음부터 훑으며 focus 셀렉터가 실제로 요소를 찾는지 확인한다.
// 하나라도 없으면 촬영을 중단한다 — 조용히 엉뚱한 곳을 가리키는 영상이 나오는 것이 가장 나쁘다.
async function checkScript(page) {
  const { BEATS, beatAt, totalDuration } = require('./walkthrough-beats.js');
  const problems = [];
  let acc = 0;
  for (let i = 0; i < BEATS.length; i++) {
    const mid = acc + BEATS[i].hold / 2;
    acc += BEATS[i].hold;
    await page.evaluate((t) => window.player.seek(t), mid);
    if (!BEATS[i].focus) continue;
    const found = await page.evaluate(
      (sel) => !!document.getElementById('app').contentDocument.querySelector(sel),
      BEATS[i].focus);
    if (!found) problems.push('beat ' + i + ' (장 ' + BEATS[i].ch + ') focus 를 찾지 못함: ' + BEATS[i].focus);
  }
  console.log('대본 검사 — beat ' + BEATS.length + '개 / 길이 ' + totalDuration() + '초');
  if (problems.length) {
    problems.forEach((m) => console.log('  결함: ' + m));
    throw new Error('대본 검사 실패 — 도구가 바뀌어 셀렉터가 죽었을 수 있습니다');
  }
  console.log('모든 focus 셀렉터가 살아 있습니다');
}

// Task 4 에서 촬영·인코딩을 채운다. 그때까지 --check 외의 실행은 여기서 막는다 —
// 없는 함수를 부르다 알 수 없는 오류로 죽는 것보다 낫다.
async function capture() { throw new Error('촬영은 Task 4 에서 구현합니다. 지금은 --check 만 됩니다'); }
function encode() { throw new Error('인코딩은 Task 4 에서 구현합니다'); }

async function main() {
  buildStage();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--allow-file-access-from-files'] });
  try {
    const page = await openStage(browser);
    await checkScript(page);
    if (process.argv.includes('--check')) return;
    await capture(page);
  } finally {
    await browser.close();
  }
  encode();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
