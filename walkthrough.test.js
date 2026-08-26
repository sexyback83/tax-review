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
