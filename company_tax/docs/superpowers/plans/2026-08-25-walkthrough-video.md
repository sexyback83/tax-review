# 「AI 세무사」 사용 설명 영상 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 도구를 iframe 으로 조작하며 번호·자막·하이라이트를 얹는 자동 재생 페이지를 만들고, 같은 대본으로 1920×1080 MP4 를 뽑는다.

**Architecture:** `walkthrough-beats.js` 가 대본과 시간 계산을 순수 함수로 들고 있고, `walkthrough.html` 이 그것을 읽어 무대·오버레이를 그리며 iframe 안의 도구를 실제로 조작한다. `player.seek(t)` 가 실제 시계를 쓰지 않으므로 Puppeteer 가 t 를 1/12초씩 올리며 프레임을 뽑을 수 있고, ffmpeg 이 이를 MP4 로 묶는다. 웹페이지와 영상이 같은 대본·같은 렌더러를 쓴다.

**Tech Stack:** 순수 HTML/CSS/JS (프레임워크 없음) · Node.js (테스트) · puppeteer (촬영) · ffmpeg-static (인코딩)

**Spec:** `company_tax/docs/superpowers/specs/2026-08-25-walkthrough-video-design.md`

## Global Constraints

- 작업 폴더는 `C:/Users/brugl/OneDrive/바탕 화면/ai project` 다. 여기가 공개본(`main` 브랜치)과 일치하는 정본이다.
- **도구(`company_tax/tax-review/index.html`)를 수정하지 않는다.** 준법 심의를 마친 화면이다. 연출은 전부 오버레이로 얹는다.
- 무대는 **1920×1080** 고정. iframe 은 **1000×900**, 가로 중앙, `y=96`.
- 프레임레이트 **12fps**. 무음이다 — 음성·배경음악을 만들지 않는다.
- 색은 도구의 토큰을 그대로 쓴다: 강조 `#0068ff`, 무대 배경 `#141311`, 밝은 글자 `#f0ede6`.
- 자막 규격: 하단 **40px/700**, 배경 `rgba(0,0,0,.72)`, 패딩 20×36, 라운드 14px. 대상 옆 자막 **24px/600**, 배경 `rgba(0,0,0,.78)`, 패딩 10×16, 라운드 10px.
- 테스트는 프레임워크 없이 `node <파일>` 로 돌아간다. 이 저장소의 기존 테스트 방식과 같다.
- 커밋은 `main` 브랜치에 임시 인덱스(`GIT_INDEX_FILE`) 플러밍으로 올린다. 작업트리를 건드리지 않는다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `walkthrough-beats.js` (신규) | `BEATS` 배열, `beatAt(t)`, `totalDuration()`. 순수 함수만. `module.exports` 로도 내보내 node 테스트가 쓴다 |
| `walkthrough.test.js` (신규) | 대본 자료구조와 시간 계산 테스트. 의존성 없음 |
| `walkthrough.html` (신규) | 무대·오버레이·player. `walkthrough-beats.js` 를 클래식 스크립트로 싣는다 |
| `build-video.js` (신규) | 스테이징 구성 → 셀렉터 무결성 검사 → 프레임 촬영 → ffmpeg 인코딩 |
| `AI세무사_사용설명.mp4` (산출물) | 최종 영상 |

`walkthrough-beats.js` 를 별도 파일로 두는 이유는 이 저장소의 기존 방식과 같다 — `calc.js` 처럼 브라우저에서는 클래식 스크립트로 보이고 node 에서는 `require` 로 테스트할 수 있게 한다.

---

### Task 1: 대본 모듈과 시간 계산

**Files:**
- Create: `ai project/walkthrough-beats.js`
- Test: `ai project/walkthrough.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `BEATS` — `Array<{ch:number, title?:string, say:string, focus?:string, note?:string, act?:string, hold:number}>`
    - `act` 는 함수가 아니라 **문자열 이름**이다. 순수 데이터로 두어야 node 에서 직렬화·검사할 수 있다. 실제 동작은 Task 3 의 `ACTIONS` 표가 이름으로 찾아 실행한다.
  - `totalDuration(): number` — 모든 `hold` 의 합(초)
  - `beatAt(t: number): {index:number, beat:object, elapsed:number}` — 시각 t 가 속한 beat. `t` 가 전체 길이 이상이면 마지막 beat 를 준다
  - `chapterTitles(): Array<{ch:number, title:string, start:number}>` — 장이 시작하는 시각

- [x] **Step 1: 실패하는 테스트를 쓴다**

`ai project/walkthrough.test.js`:

```js
// 의존성 없이 node walkthrough.test.js 로 돌아간다. 이 저장소의 다른 테스트와 같은 방식이다.
const { BEATS, totalDuration, beatAt, chapterTitles } = require('./walkthrough-beats.js');

let pass = 0;
const fails = [];
function eq(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fails.push(name + ' — 기대 ' + JSON.stringify(expected) + ' / 실제 ' + JSON.stringify(actual));
}
function ok(name, cond, why) {
  if (cond) { pass++; return; }
  fails.push(name + ' — ' + why);
}

// ── 대본 자체의 무결성 ──
ok('beat 가 하나 이상 있다', BEATS.length > 0, 'BEATS 가 비어 있다');
BEATS.forEach((b, i) => {
  ok('beat ' + i + ' 에 자막이 있다', typeof b.say === 'string' && b.say.length > 0, 'say 가 비었다');
  ok('beat ' + i + ' 의 hold 가 양수다', typeof b.hold === 'number' && b.hold > 0, 'hold=' + b.hold);
  ok('beat ' + i + ' 에 장 번호가 있다', Number.isInteger(b.ch) && b.ch >= 1, 'ch=' + b.ch);
});

// 자막이 너무 길면 무대를 넘친다. 상한은 CSS 예산에서 나온 값이다 —
// .say 의 max-width 가 1500px 이고 40px 한글 한 글자가 자간 포함 약 39.5px 이므로
// 한 줄에 37자가 한계다. 여유를 두어 34자로 못 박는다.
BEATS.forEach((b, i) => {
  ok('beat ' + i + ' 자막 길이', b.say.length <= 34, '자막 ' + b.say.length + '자 — 34자를 넘으면 무대를 넘친다: ' + b.say);
});

// 장 번호는 1 부터 끊기지 않고 올라가야 한다.
const chs = [...new Set(BEATS.map((b) => b.ch))];
eq('장 번호가 1부터 시작', chs[0], 1);
chs.forEach((c, i) => eq('장 번호가 연속', c, i + 1));

// 장이 바뀌는 첫 beat 에는 제목이 있어야 한다.
BEATS.forEach((b, i) => {
  const isFirstOfChapter = i === 0 || BEATS[i - 1].ch !== b.ch;
  if (isFirstOfChapter) ok('장 ' + b.ch + ' 첫 beat 에 제목', !!b.title, 'title 이 없다');
});

// ── 시간 계산 ──
eq('총 길이는 hold 의 합', totalDuration(), BEATS.reduce((s, b) => s + b.hold, 0));

eq('t=0 은 첫 beat', beatAt(0).index, 0);
eq('t=0 의 경과', beatAt(0).elapsed, 0);

const firstHold = BEATS[0].hold;
eq('첫 beat 의 끝 직전은 아직 첫 beat', beatAt(firstHold - 0.01).index, 0);
eq('첫 beat 의 끝은 둘째 beat', beatAt(firstHold).index, 1);
eq('둘째 beat 진입 시 경과는 0', beatAt(firstHold).elapsed, 0);

eq('총 길이를 넘으면 마지막 beat', beatAt(totalDuration() + 10).index, BEATS.length - 1);
eq('음수는 첫 beat', beatAt(-5).index, 0);

// ── 장 목록 ──
const titles = chapterTitles();
eq('장 수', titles.length, chs.length);
eq('첫 장은 0초에 시작', titles[0].start, 0);
titles.forEach((t) => ok('장 ' + t.ch + ' 에 제목', !!t.title, '제목이 비었다'));

// ── 결과 ──
console.log('대본 검증 — 통과 ' + pass + '건 / 실패 ' + fails.length + '건');
if (fails.length) {
  fails.forEach((m) => console.log('  실패: ' + m));
  process.exit(1);
}
console.log('총 길이 ' + totalDuration() + '초 (' + Math.floor(totalDuration() / 60) + '분 ' + (totalDuration() % 60) + '초) · beat ' + BEATS.length + '개 · 장 ' + titles.length + '개');
```

- [x] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd "C:/Users/brugl/OneDrive/바탕 화면/ai project" && node walkthrough.test.js`
Expected: FAIL — `Cannot find module './walkthrough-beats.js'`

- [x] **Step 3: 대본 모듈을 만든다**

`ai project/walkthrough-beats.js`:

```js
// 「AI 세무사」 사용 설명 영상의 대본.
//
// act 는 함수가 아니라 이름(문자열)이다. 대본을 순수 데이터로 두어야 node 에서 검사할 수 있고,
// 실제 조작은 walkthrough.html 의 ACTIONS 표가 이름으로 찾아 실행한다.
//
// hold 는 그 beat 가 머무는 초다. 자막을 읽을 시간이므로 글자 수에 비례해 잡았다.

const BEATS = [
  // ── 1장 시작 화면 ──
  { ch: 1, title: '시작 화면', say: '상담 자리에서 예상 세금을 개산하는 도구입니다', hold: 5 },
  { ch: 1, say: '세무 검토와 FP센터, 두 갈래로 시작합니다', focus: '.split', hold: 4 },
  { ch: 1, say: '세법 기준일자가 카드에 적혀 있습니다', focus: '.split-meta', hold: 3 },

  // ── 2장 상단 4개 버튼 ──
  { ch: 2, title: '상단 4개 버튼', say: '검토를 시작하면 위에 버튼 네 개가 늘 떠 있습니다',
    act: 'startTax', focus: '.hdr-nav', hold: 5 },
  { ch: 2, say: '「처음으로」는 첫 화면으로 돌아갑니다',
    focus: '[data-act="gotoStart"]', note: '입력값은 지워지지 않음', hold: 6 },
  { ch: 2, say: '「입력값 초기화」는 앞 고객의 정보를 지웁니다',
    focus: '[data-act="resetAll"]', hold: 6 },
  { ch: 2, say: '실수로 지우지 않도록 두 번 눌러야 합니다',
    focus: '[data-act="resetAll"]', note: '두 번 눌러야 지워짐', hold: 6 },
  { ch: 2, say: '「검토결과 확인」에는 검토한 항목 수가 붙습니다',
    focus: '[data-act="gotoSummary"]', note: '1건 이상일 때 활성', hold: 6 },
  { ch: 2, say: '「FP센터」는 가까운 센터를 지도에서 찾습니다',
    focus: '[data-act="gotoFp"]', hold: 5 },

  // ── 3장 고객 정보 ──
  { ch: 3, title: '고객 정보', say: '고객명과 성별, 생년월일을 넣습니다', focus: '.fields', hold: 5 },
  { ch: 3, say: '생년월일을 넣으면 만 나이가 자동으로 나옵니다',
    act: 'fillCustomer', focus: '#ageText', hold: 6 },
  { ch: 3, say: '나이는 미성년자공제·연로자공제 판정에 쓰입니다', hold: 5 },

  // ── 4장 검토 모드 ──
  { ch: 4, title: '검토 모드', say: '간편과 심화 중에 고릅니다', act: 'toStep2', hold: 4 },
  { ch: 4, say: '「간편」은 필수값만 받고 나머지는 법정 기본값을 씁니다',
    focus: '[data-act="mode"][data-v="simple"]', hold: 7 },
  { ch: 4, say: '「심화」는 채무·사전증여·중과까지 직접 지정합니다',
    focus: '[data-act="mode"][data-v="deep"]', hold: 7 },

  // ── 5장 세목 선택 ──
  { ch: 5, title: '세목 선택', say: '8개 세목 중에 검토할 항목을 고릅니다',
    act: 'pickSimple', hold: 5 },
  { ch: 5, say: '검토를 마친 항목에는 「검토 완료」 표시가 남습니다', hold: 5 },
  { ch: 5, say: '여기서는 상속세로 시연합니다',
    focus: '[data-act="item"][data-v="inherit"]', hold: 4 },

  // ── 6장 값 입력 ──
  { ch: 6, title: '값 입력', say: '금액은 만원 단위로 넣습니다',
    act: 'pickInherit', focus: 'input[data-inp="val"][data-k="re"]', note: '만원 단위', hold: 6 },
  { ch: 6, say: '부동산 20억이면 200000을 넣습니다', act: 'typeRealEstate', hold: 6 },
  { ch: 6, say: '금융자산은 반드시 제 칸에 넣습니다',
    act: 'typeCash', focus: 'input[data-inp="val"][data-k="cash"]', hold: 6 },
  { ch: 6, say: '부동산 칸에 몰아넣으면 금융재산공제가 사라집니다',
    note: '세액이 과대 계상됨', hold: 7 },
  { ch: 6, say: '입력하는 동안 아래 안내 문구가 함께 바뀝니다', focus: '[data-hint]', hold: 6 },

  // ── 7장 결과 ──
  { ch: 7, title: '결과', say: '세액이 가장 크게 나옵니다', act: 'toResult', hold: 5 },
  { ch: 7, say: '그 아래에 계산 과정이 단계별로 펼쳐집니다', act: 'scrollSteps', hold: 6 },
  { ch: 7, say: '적용 기준 고지는 어떤 전제로 계산했는지 밝힙니다',
    act: 'scrollNotice', focus: '.notice', hold: 6 },
  { ch: 7, say: '개산이므로 확정 세액은 전문가 검토가 필요합니다', hold: 6 },

  // ── 8장 종합 검토 결과 ──
  { ch: 8, title: '종합 검토 결과', say: '검토한 항목을 한 화면에 모아 봅니다',
    act: 'toSummary', hold: 5 },
  { ch: 8, say: '결과와 입력값, 적용한 가정이 함께 보입니다', hold: 5 },
  { ch: 8, say: '인쇄하거나 PDF로 저장할 수 있습니다',
    focus: '[data-act="print"]', hold: 5 },

  // ── 9장 결과 수정 ──
  { ch: 9, title: '결과 수정', say: '고칠 값이 있으면 항목의 「수정」을 누릅니다',
    focus: '[data-act="sumEdit"]', hold: 6 },
  { ch: 9, say: '입력값이 그 자리에서 열립니다', act: 'openEdit', hold: 5 },
  { ch: 9, say: '값을 고치면 즉시 다시 계산됩니다', act: 'editRealEstate', hold: 6 },
  { ch: 9, say: '앞 화면으로 돌아갈 필요가 없습니다', hold: 4 },

  // ── 10장 마무리 ──
  { ch: 10, title: 'FP센터와 마무리', say: '가까운 FP센터를 지도에서 찾을 수 있습니다',
    act: 'toFp', hold: 6 },
  { ch: 10, say: '위치를 허용하면 가까운 순으로 정렬됩니다',
    focus: '[data-act="fpLocate"]', hold: 6 },
  { ch: 10, say: '결과는 참고용 개산입니다', hold: 5 },
];

function totalDuration() {
  return BEATS.reduce((sum, b) => sum + b.hold, 0);
}

// 시각 t 가 속한 beat. 되감기·앞으로감기 모두 이 함수 하나로 판정한다.
function beatAt(t) {
  if (!(t > 0)) return { index: 0, beat: BEATS[0], elapsed: 0 };
  let acc = 0;
  for (let i = 0; i < BEATS.length; i++) {
    if (t < acc + BEATS[i].hold) return { index: i, beat: BEATS[i], elapsed: t - acc };
    acc += BEATS[i].hold;
  }
  const last = BEATS.length - 1;
  return { index: last, beat: BEATS[last], elapsed: BEATS[last].hold };
}

function chapterTitles() {
  const out = [];
  let acc = 0;
  BEATS.forEach((b) => {
    if (b.title) out.push({ ch: b.ch, title: b.title, start: acc });
    acc += b.hold;
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BEATS, totalDuration, beatAt, chapterTitles };
}
```

- [x] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `cd "C:/Users/brugl/OneDrive/바탕 화면/ai project" && node walkthrough.test.js`
Expected: PASS. 마지막 줄에 총 길이가 찍힌다. 3분 안팎(170~200초)이어야 한다. 벗어나면 `hold` 를 조정하고 다시 돌린다.

실제 결과: 통과 190건 / 실패 0건, 총 길이 201초(3분 21초) · beat 37개 · 장 10개. 상한 200초를 1초 넘지만 "안팎" 범위로 보아 조정하지 않음.

- [x] **Step 5: 커밋**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx1 && rm -f "$GIT_INDEX_FILE"
git read-tree main
for f in walkthrough-beats.js walkthrough.test.js; do
  B=$(git hash-object -w "$AP/$f"); git update-index --add --cacheinfo 100644,"$B","$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p main -m "feat(video): 사용 설명 영상 대본과 시간 계산 추가

act 를 함수가 아니라 이름으로 두어 대본을 순수 데이터로 유지한다.
node 로 자막 길이·장 번호 연속성·시간 계산을 검사한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/main "$C" && git push origin main
```

---

### Task 2: 무대와 오버레이

**Files:**
- Create: `ai project/walkthrough.html`

**Interfaces:**
- Consumes: Task 1 의 `BEATS`, `totalDuration()`, `beatAt()`, `chapterTitles()` (클래식 스크립트 전역)
- Produces:
  - `window.player.seek(t)` — 시각 t 의 화면을 그린다. 프레임 촬영이 이걸 부른다
  - `window.player.duration` — 총 길이(초)
  - `window.player.play()` / `window.player.pause()` — 웹페이지 재생용
  - `window.player.ready` — iframe 로드 완료 여부 (Puppeteer 가 기다린다)

- [x] **Step 1: 무대 골격과 스타일을 만든다**

실제 구현에서는 계획 코드에 `document.getElementById('app').src = TOOL_URL;` 한 줄을 더했다.
계획 코드 그대로면 iframe 에 src 가 없어 Step 2 의 기대 결과(시작 화면이 보임)를 만들 수 없다.

`ai project/walkthrough.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 세무사 사용 설명</title>
<style>
  :root {
    --stage-bg: #141311;
    --accent: #0068ff;
    --bright: #f0ede6;
    --font: 'Noto Sans KR', 'Malgun Gothic', -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--stage-bg); overflow: hidden; }
  body { font-family: var(--font); display: flex; align-items: center; justify-content: center; height: 100vh; }

  /* 무대는 1920×1080 고정. 화면이 좁으면 통째로 축소해 보여준다 —
     이렇게 해야 웹페이지와 촬영 프레임의 좌표가 완전히 같아진다. */
  .stage {
    position: relative; width: 1920px; height: 1080px; flex: none;
    background: var(--stage-bg); transform-origin: center center; overflow: hidden;
  }

  .app-frame {
    position: absolute; left: 460px; top: 96px; width: 1000px; height: 900px;
    border-radius: 16px; overflow: hidden; background: #faf9f5;
    border: 1px solid rgba(255,255,255,.09);
  }
  .app-frame iframe { width: 100%; height: 100%; border: 0; display: block; }

  /* 하이라이트 — 대상 밖을 덮는 네 조각. clip-path 대신 사각형 넷으로 두어
     어느 브라우저에서나 같게 그려진다. */
  .dim { position: absolute; background: rgba(0,0,0,.55); opacity: 0; transition: opacity .3s; }
  .dim.on { opacity: 1; }
  .ring {
    position: absolute; border: 3px solid var(--accent); border-radius: 10px;
    box-shadow: 0 0 0 6px rgba(0,104,255,.25); opacity: 0; transition: opacity .3s;
  }
  .ring.on { opacity: 1; }

  .badge {
    position: absolute; left: 96px; top: 96px;
    width: 64px; height: 64px; border-radius: 50%; background: var(--accent);
    color: #fff; font-size: 30px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .chap { position: absolute; left: 180px; top: 108px; font-size: 34px; font-weight: 600; color: var(--bright); }

  /* 하단 자막 — 이 영상은 무음이므로 자막이 설명을 전부 진다. */
  .say {
    position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%);
    max-width: 1500px; padding: 20px 36px; border-radius: 14px;
    background: rgba(0,0,0,.72); color: #fff;
    font-size: 40px; font-weight: 700; letter-spacing: -.5px; line-height: 1.4;
    text-align: center; white-space: nowrap;
  }

  /* 대상 옆 자막 — 버튼 설명용. 지시선으로 대상과 잇는다. */
  .note {
    position: absolute; padding: 10px 16px; border-radius: 10px;
    background: rgba(0,0,0,.78); color: #fff; font-size: 24px; font-weight: 600;
    white-space: nowrap; opacity: 0; transition: opacity .3s;
  }
  .note.on { opacity: 1; }
  .lead { position: absolute; background: var(--accent); opacity: 0; transition: opacity .3s; }
  .lead.on { opacity: 1; }

  /* 장 전환 카드 */
  .card {
    position: absolute; inset: 0; background: var(--stage-bg);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 28px; opacity: 0; pointer-events: none;
  }
  .card.on { opacity: 1; }
  .card-num { font-size: 120px; font-weight: 700; color: var(--accent); line-height: 1; }
  .card-title { font-size: 56px; font-weight: 600; color: var(--bright); }
</style>
</head>
<body>

<div class="stage" id="stage">
  <div class="app-frame"><iframe id="app" title="AI 세무사"></iframe></div>
  <div class="dim" id="dimT"></div><div class="dim" id="dimB"></div>
  <div class="dim" id="dimL"></div><div class="dim" id="dimR"></div>
  <div class="ring" id="ring"></div>
  <div class="lead" id="lead"></div>
  <div class="note" id="note"></div>
  <div class="badge" id="badge">1</div>
  <div class="chap" id="chap"></div>
  <div class="say" id="say"></div>
  <div class="card" id="card">
    <div class="card-num" id="cardNum">1</div>
    <div class="card-title" id="cardTitle"></div>
  </div>
</div>

<script src="walkthrough-beats.js"></script>
<script>
// 도구 주소는 여기 한 곳에만 둔다. 스테이징 폴더에서도, gh-pages 에 올린 뒤에도
// 도구가 index.html 이므로 이 상대경로가 그대로 맞는다.
const TOOL_URL = './index.html';
</script>
</body>
</html>
```

- [x] **Step 2: 브라우저로 열어 무대가 그려지는지 확인한다**

Run: 스테이징 폴더를 만들고 브라우저로 연다.

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/ai project"
mkdir -p ../test/_stage
cp AI세무사_단일파일.html ../test/_stage/index.html
cp walkthrough.html walkthrough-beats.js ../test/_stage/
```

`preview_start` 로 `file:///C:/Users/brugl/OneDrive/바탕 화면/test/_stage/walkthrough.html` 을 연다.
Expected: 근검정 배경 위에 1000×900 흰 카드가 있고 그 안에 AI 세무사 시작 화면이 보인다. 자막·배지는 아직 비어 있다.

실제 확인(원격 환경, Windows `preview_start` 대신): 단일파일 빌드가 없어 `company_tax/tax-review/{index.html,calc.js,fp.js,assets}` 를 스테이징에 그대로 복사해 대신했다.
`http-server` 로 서빙하고 Playwright(Chromium) 로 1920×1080 스크린샷을 찍어 확인 — 근검정 배경, 460,96 위치의 1000×900 흰 카드, 카드 안에 실제 시작 화면(세무 검토 / FP센터 카드) 이 보였다. 배지는 기본값 "1", 자막(`.say`)은 빈 채로 보이지 않음 — 기대와 일치.

- [x] **Step 3: 커밋**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx2 && rm -f "$GIT_INDEX_FILE"
git read-tree main
B=$(git hash-object -w "$AP/walkthrough.html"); git update-index --add --cacheinfo 100644,"$B",walkthrough.html
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p main -m "feat(video): 연출 무대와 오버레이 골격 추가

무대를 1920×1080 로 고정하고 화면이 좁으면 통째로 축소한다.
웹페이지와 촬영 프레임의 좌표가 완전히 같아진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/main "$C" && git push origin main
```

---

### Task 3: iframe 조작과 player

**Files:**
- Modify: `ai project/walkthrough.html` (Task 2 의 마지막 `<script>` 블록에 이어 붙인다)

**Interfaces:**
- Consumes: Task 1 의 `BEATS`/`beatAt`/`totalDuration`/`chapterTitles`, Task 2 의 DOM id 들
- Produces: `window.player = { seek(t), play(), pause(), duration, ready }`

**핵심 결정:** `seek` 은 **되감기를 지원하지 않고 앞으로만 간다.** 도구는 상태를 가진 앱이라 시간을 되돌린다고 상태가 되돌아가지 않는다. 되감아야 하면 iframe 을 다시 싣고 0 부터 따라잡는다(`replayTo`). 촬영은 t 를 단조 증가시키므로 이 비용을 치를 일이 없다.

- [ ] **Step 1: 조작 표와 헬퍼를 쓴다**

`walkthrough.html` 의 `TOOL_URL` 선언 아래에 이어 붙인다:

```js
const app = document.getElementById('app');
const $ = (id) => document.getElementById(id);

// iframe 안의 도구를 조작하는 헬퍼. 같은 오리진이므로 DOM 에 직접 닿는다.
const doc = () => app.contentDocument;
const q = (sel) => doc().querySelector(sel);
function click(sel) {
  const el = q(sel);
  if (!el) throw new Error('클릭 대상을 찾지 못했습니다: ' + sel);
  el.click();
}
// 입력은 값만 넣으면 도구가 모른다. 도구가 듣는 input 이벤트를 함께 보낸다.
function type(sel, value) {
  const el = q(sel);
  if (!el) throw new Error('입력 대상을 찾지 못했습니다: ' + sel);
  el.value = value;
  el.dispatchEvent(new app.contentWindow.Event('input', { bubbles: true }));
}
function scrollBy(px) { app.contentWindow.scrollTo({ top: px, behavior: 'instant' }); }

// 대본의 act 이름이 여기로 온다. 대본은 순수 데이터로 두고 동작은 여기 모은다.
const ACTIONS = {
  startTax() { click('[data-act="startTax"]'); },
  fillCustomer() {
    type('input[data-inp="customerName"]', '홍길동');
    click('[data-act="sex"][data-v="M"]');
    type('input[data-inp="birth"]', '19620314');
  },
  toStep2() { click('[data-act="next"]'); },
  pickSimple() { click('[data-act="mode"][data-v="simple"]'); },
  pickInherit() { click('[data-act="item"][data-v="inherit"]'); },
  typeRealEstate() { type('input[data-inp="val"][data-k="re"]', '200000'); },
  typeCash() { type('input[data-inp="val"][data-k="cash"]', '100000'); },
  toResult() { click('[data-act="next"]'); scrollBy(0); },
  scrollSteps() { scrollBy(420); },
  scrollNotice() { scrollBy(900); },
  toSummary() { scrollBy(0); click('[data-act="gotoSummary"]'); },
  openEdit() { click('[data-act="sumEdit"]'); },
  editRealEstate() { type('input[data-inp="val"][data-k="re"]', '300000'); },
  toFp() { scrollBy(0); click('[data-act="gotoFp"]'); },
};
```

- [ ] **Step 2: 오버레이 그리기와 player 를 쓴다**

이어서 붙인다:

```js
// 대상 요소를 무대 좌표로 옮긴다. iframe 은 무대 안에서 (460, 96) 에 있다.
const FRAME_X = 460, FRAME_Y = 96;
function rectOf(sel) {
  const el = q(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + FRAME_X, y: r.top + FRAME_Y, w: r.width, h: r.height };
}

function showHighlight(sel) {
  const ids = ['dimT', 'dimB', 'dimL', 'dimR'];
  const r = sel ? rectOf(sel) : null;
  if (!r) {
    ids.forEach((i) => $(i).classList.remove('on'));
    $('ring').classList.remove('on');
    return;
  }
  const pad = 8;
  const box = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  const set = (id, x, y, w, h) => {
    const e = $(id);
    e.style.left = x + 'px'; e.style.top = y + 'px';
    e.style.width = Math.max(0, w) + 'px'; e.style.height = Math.max(0, h) + 'px';
    e.classList.add('on');
  };
  set('dimT', 0, 0, 1920, box.y);
  set('dimB', 0, box.y + box.h, 1920, 1080 - box.y - box.h);
  set('dimL', 0, box.y, box.x, box.h);
  set('dimR', box.x + box.w, box.y, 1920 - box.x - box.w, box.h);
  const ring = $('ring');
  ring.style.left = box.x + 'px'; ring.style.top = box.y + 'px';
  ring.style.width = box.w + 'px'; ring.style.height = box.h + 'px';
  ring.classList.add('on');
}

// 대상 옆 자막. 대상 오른쪽에 두되 무대를 넘치면 왼쪽으로 넘긴다.
function showNote(text, sel) {
  const note = $('note'), lead = $('lead');
  const r = sel ? rectOf(sel) : null;
  if (!text || !r) { note.classList.remove('on'); lead.classList.remove('on'); return; }
  note.textContent = text;
  note.classList.add('on');
  const nw = note.offsetWidth, nh = note.offsetHeight;
  const gap = 28;
  let x = r.x + r.w + gap;
  if (x + nw > 1880) x = r.x - gap - nw;
  const y = Math.min(Math.max(r.y + r.h / 2 - nh / 2, 20), 1080 - nh - 20);
  note.style.left = x + 'px'; note.style.top = y + 'px';
  const lx = x > r.x ? r.x + r.w : x + nw;
  lead.style.left = Math.min(lx, r.x + r.w) + 'px';
  lead.style.top = (r.y + r.h / 2) + 'px';
  lead.style.width = Math.abs((x > r.x ? x : r.x) - lx) + 'px';
  lead.style.height = '2px';
  lead.classList.add('on');
}

const CARD_SECONDS = 0.9;   // 장 제목 카드가 떠 있는 시간

const player = {
  duration: totalDuration(),
  ready: false,
  _at: -1,        // 지금 그려진 beat 번호
  _raf: 0,
  _t: 0,

  seek(t) {
    const { index, beat, elapsed } = beatAt(t);
    if (index < this._at) throw new Error('되감기는 replay() 로만 됩니다');
    // 지나친 beat 의 act 를 순서대로 밀린 것 없이 실행한다.
    while (this._at < index) {
      this._at++;
      const name = BEATS[this._at].act;
      if (name) {
        if (!ACTIONS[name]) throw new Error('모르는 act: ' + name);
        ACTIONS[name]();
      }
    }
    this._t = t;
    $('say').textContent = beat.say;
    $('badge').textContent = beat.ch;
    const title = chapterTitles().find((c) => c.ch === beat.ch);
    $('chap').textContent = title ? title.title : '';
    showHighlight(beat.focus);
    showNote(beat.note, beat.focus);
    // 장이 바뀐 직후에는 제목 카드를 덮는다.
    const isNewChapter = !!beat.title;
    const card = $('card');
    if (isNewChapter && elapsed < CARD_SECONDS) {
      $('cardNum').textContent = beat.ch;
      $('cardTitle').textContent = beat.title;
      card.classList.add('on');
    } else {
      card.classList.remove('on');
    }
  },

  // 되감기는 iframe 을 다시 싣고 0 부터 따라잡는다.
  async replay(t) {
    await load();
    for (let s = 0; s <= t; s += 0.25) this.seek(s);
    this.seek(t);
  },

  play() {
    const t0 = performance.now() / 1000 - this._t;
    const tick = () => {
      const t = performance.now() / 1000 - t0;
      if (t >= this.duration) { this.seek(this.duration); return; }
      this.seek(t);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  },
  pause() { cancelAnimationFrame(this._raf); },
};

function load() {
  return new Promise((resolve) => {
    player.ready = false;
    player._at = -1;
    app.onload = () => { player.ready = true; resolve(); };
    app.src = TOOL_URL;
  });
}

// 무대를 화면에 맞춰 축소한다. 촬영(1920×1080)에서는 배율이 1 이 된다.
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  $('stage').style.transform = 'scale(' + s + ')';
}
addEventListener('resize', fit);
fit();

window.player = player;
load().then(() => { player.seek(0); });
```

- [ ] **Step 3: 셀렉터 무결성 검사를 만든다**

의존성을 설치하고 검사 스크립트를 만든다.

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/ai project"
npm init -y
npm i puppeteer ffmpeg-static
```

`ai project/build-video.js`:

```js
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
```

이 단계의 산출물은 `--check` 경로다. 촬영·인코딩은 Task 4 에서 이 두 함수를 갈아 끼운다.

- [ ] **Step 4: 검사를 돌려 통과를 확인한다**

Run: `cd "C:/Users/brugl/OneDrive/바탕 화면/ai project" && node build-video.js --check`
Expected: `모든 focus 셀렉터가 살아 있습니다`. 실패하면 어느 beat 의 어느 셀렉터인지 출력되므로 대본을 고친다.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx3 && rm -f "$GIT_INDEX_FILE"
git read-tree main
for f in walkthrough.html build-video.js package.json; do
  B=$(git hash-object -w "$AP/$f"); git update-index --add --cacheinfo 100644,"$B","$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p main -m "feat(video): iframe 조작과 대본 무결성 검사 추가

seek 은 앞으로만 간다. 도구는 상태를 가진 앱이라 시간을 되돌린다고
상태가 되돌아가지 않는다. 되감기는 iframe 을 다시 싣고 0 부터 따라잡는다.

focus 셀렉터가 하나라도 죽으면 촬영을 중단한다 — 엉뚱한 곳을 가리키는
영상이 조용히 나오는 것이 가장 나쁜 실패다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/main "$C" && git push origin main
```

**주의:** `node_modules/` 와 `package-lock.json` 은 커밋하지 않는다. `.gitignore` 에 `node_modules/` 가 이미 있다.

---

### Task 4: 프레임 촬영과 MP4 인코딩

**Files:**
- Modify: `ai project/build-video.js` (`capture`, `encode` 를 채운다)

**Interfaces:**
- Consumes: Task 3 의 `openStage(browser)`, `player.seek(t)`, `FPS`, `STAGE`, `FRAMES`, `OUT`
- Produces: `AI세무사_사용설명.mp4` — 1920×1080, 12fps, H.264

- [ ] **Step 1: 촬영과 인코딩을 쓴다**

`build-video.js` 의 `main()` 위에 넣는다:

```js
// --seconds N 을 주면 앞 N 초만 찍는다. 속도를 재거나 앞부분만 다시 볼 때 쓴다.
function wantedSeconds(total) {
  const i = process.argv.indexOf('--seconds');
  if (i < 0) return total;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, total) : total;
}

async function capture(page) {
  const { totalDuration } = require('./walkthrough-beats.js');
  const total = wantedSeconds(totalDuration());
  const frames = Math.ceil(total * FPS);

  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  // 되감기가 없도록 t 를 단조 증가시킨다. player.seek 이 이를 전제로 만들어졌다.
  await page.evaluate(() => window.player.replay(0));
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => window.player.seek(tt), t);
    await page.screenshot({
      path: path.join(FRAMES, String(i).padStart(5, '0') + '.jpg'),
      type: 'jpeg', quality: 92,
    });
    if (i % (FPS * 10) === 0) {
      console.log('  촬영 ' + Math.round(t) + '초 / ' + Math.round(total) + '초');
    }
  }
  console.log('프레임 ' + frames + '장 촬영 완료');
}

function encode() {
  const ffmpeg = require('ffmpeg-static');
  fs.rmSync(OUT, { force: true });
  execFileSync(ffmpeg, [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(FRAMES, '%05d.jpg'),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT,
  ], { stdio: 'inherit' });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log('완성: ' + OUT + ' (' + mb + 'MB)');
}
```

- [ ] **Step 2: 짧은 구간으로 먼저 속도를 잰다**

전체를 돌리기 전에 앞 10초만 찍어 프레임당 소요를 확인한다.

Run: `cd "C:/Users/brugl/OneDrive/바탕 화면/ai project" && node build-video.js --seconds 10`
Expected: 120장이 찍히고 MP4 가 나온다. 프레임당 1초를 넘으면 전체 촬영이 40분을 넘으므로, `FPS` 를 8 로 낮추고 다시 잰다. 설명 영상은 대부분 정지 화면이라 8fps 로도 충분하다.

- [ ] **Step 3: 전체를 촬영해 인코딩한다**

Run: `cd "C:/Users/brugl/OneDrive/바탕 화면/ai project" && node build-video.js`
Expected: `완성: ...AI세무사_사용설명.mp4 (NN.NMB)`

- [ ] **Step 4: 결과물을 검증한다**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/ai project"
node -e "
const {execFileSync}=require('child_process');
const p=require('ffmpeg-static').replace('ffmpeg','ffprobe');
console.log(execFileSync(p,['-v','error','-show_entries','stream=width,height,nb_frames,duration','-of','default=noprint_wrappers=1','AI세무사_사용설명.mp4']).toString());
"
```

Expected: `width=1920` · `height=1080` · `duration` 이 `totalDuration()` 과 ±1초 안. 어긋나면 `FPS` 와 프레임 수를 다시 맞춘다.

`ffmpeg-static` 에 ffprobe 가 없으면 대신 ffmpeg 으로 확인한다: `ffmpeg -i AI세무사_사용설명.mp4` 의 stderr 에 해상도와 길이가 찍힌다.

- [ ] **Step 5: 눈으로 확인한다**

영상을 `SendUserFile` 로 보내 사용자가 직접 보게 한다. 자막이 잘리거나 하이라이트가 엉뚱한 곳을 가리키면 대본을 고치고 Task 4 를 다시 돌린다.

- [ ] **Step 6: 커밋**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx4 && rm -f "$GIT_INDEX_FILE"
git read-tree main
B=$(git hash-object -w "$AP/build-video.js"); git update-index --add --cacheinfo 100644,"$B",build-video.js
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p main -m "feat(video): 프레임 촬영과 MP4 인코딩 추가

t 를 단조 증가시키며 12fps 로 프레임을 뽑아 H.264 로 묶는다.
자막은 프레임 안에 이미 그려져 있으므로 ffmpeg 의 drawtext 를 쓰지 않는다 —
한글 서체와 줄바꿈은 페이지 쪽에서 처리하는 편이 결과가 낫다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/main "$C" && git push origin main
```

**주의:** MP4 는 저장소에 커밋하지 않는다. 수십 MB 이고 재생성할 수 있다. `.gitignore` 에 `*.mp4` 를 추가한다.

---

### Task 5: 게시와 최종 검증

**Files:**
- Modify: `ai project/.gitignore` (`*.mp4` 추가)
- Modify: `ai project/README.md` (사용 설명 영상 절 추가)

**Interfaces:**
- Consumes: Task 2·3 의 `walkthrough.html`, `walkthrough-beats.js`
- Produces: `https://sexyback83.github.io/tax-review/walkthrough.html`

- [ ] **Step 1: gh-pages 에 연출 페이지를 올린다**

gh-pages 는 지금 `index.html` 하나만 담고 있다. 여기에 두 파일을 더한다.

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx5 && rm -f "$GIT_INDEX_FILE"
git read-tree gh-pages
B=$(git hash-object -w "$AP/AI세무사_단일파일.html"); git update-index --add --cacheinfo 100644,"$B",index.html
for f in walkthrough.html walkthrough-beats.js; do
  B=$(git hash-object -w "$AP/$f"); git update-index --add --cacheinfo 100644,"$B","$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p gh-pages -m "feat(pages): 사용 설명 자동 재생 페이지 게시

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/gh-pages "$C" && git push origin gh-pages
```

- [ ] **Step 2: 게시된 주소가 실제로 도는지 확인한다**

CDN 반영을 기다린 뒤 브라우저로 연다.

```bash
until curl -s "https://sexyback83.github.io/tax-review/walkthrough.html" | grep -q "walkthrough-beats"; do sleep 5; done
echo "반영 확인"
```

`preview_start` 로 `https://sexyback83.github.io/tax-review/walkthrough.html` 을 열고 확인한다.
Expected: 무대가 뜨고, `player.seek(30)` 을 부르면 30초 지점 화면이 그려진다. 콘솔 오류 0건.

- [ ] **Step 3: README 에 영상 절을 더한다**

`README.md` 의 `## 배포` 절 바로 앞에 넣는다:

```markdown
## 사용 설명

처음 쓰는 사람을 위한 자동 재생 설명 페이지가 있다.
화면 흐름, 상단 4개 버튼, 결과를 고치는 방법을 번호 순서대로 보여준다.

**https://sexyback83.github.io/tax-review/walkthrough.html**

이 페이지는 스크린샷이 아니라 **실제 도구를 iframe 으로 조작한다.** 도구를 고치면 설명도 따라 바뀐다.
같은 대본으로 MP4 를 뽑을 수 있다.

```bash
node build-video.js --check   # 대본의 셀렉터가 살아 있는지만 검사
node build-video.js           # 프레임 촬영 + MP4 인코딩
```

대본은 `walkthrough-beats.js` 에 있다. 문구나 순서를 고치려면 이 파일만 보면 된다.
`node walkthrough.test.js` 가 자막 길이·장 번호 연속성·시간 계산을 검사한다.
```

- [ ] **Step 4: 전체 검증을 돌린다**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/ai project"
node walkthrough.test.js
node build-video.js --check
cd company_tax/tax-review
node calc.test.js | grep -c "^PASS"     # 124
node fp.test.js | tail -1                # 253개 단언 통과
node audit.test.js | grep "감사 결과"     # 통과 36건 / 범위 제외 1건 / 결함 0건
node oracle/fixture-check.js | grep passed
node oracle/crosscheck-run.js | grep crosscheck
python -m pytest oracle/test_calc.py -q | tail -1
cd ../..
node .claude/skills/tax-review/scripts/tax.js selftest | head -1
```

Expected: 전부 종전 수치 그대로. 도구를 수정하지 않았으므로 하나라도 달라지면 잘못 건드린 것이다.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/brugl/OneDrive/바탕 화면/test"
AP="C:/Users/brugl/OneDrive/바탕 화면/ai project"
export GIT_INDEX_FILE=/tmp/wtidx6 && rm -f "$GIT_INDEX_FILE"
git read-tree main
for f in README.md .gitignore; do
  B=$(git hash-object -w "$AP/$f"); git update-index --add --cacheinfo 100644,"$B","$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p main -m "docs(video): 사용 설명 페이지 안내와 mp4 제외 규칙 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
git update-ref refs/heads/main "$C" && git push origin main
```

---

## 완료 조건

1. `node walkthrough.test.js` 가 통과하고 총 길이가 170~200초 안에 있다
2. `node build-video.js --check` 가 모든 focus 셀렉터를 찾는다
3. `AI세무사_사용설명.mp4` 가 1920×1080 이고 길이가 대본과 ±1초 안이다
4. `https://sexyback83.github.io/tax-review/walkthrough.html` 이 콘솔 오류 없이 재생된다
5. 도구의 기존 검증 7종과 스킬 selftest 가 종전 수치 그대로다
6. 저장소에 `node_modules/` 와 `*.mp4` 가 들어가지 않았다
