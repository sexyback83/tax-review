#!/usr/bin/env node
/**
 * tax-review/index.html 을 자기완결 단일 파일로 묶는다 (GitHub Pages 배포용).
 *
 * 원본을 재디자인하지 않는다 — 준법 심의를 마친 화면이라 외관이 바뀌면 심의가 무의미해진다.
 * 하는 일은 두 가지뿐이다: calc.js·fp.js 인라인, 이미지 data URI 화.
 *
 * **문서 껍데기(doctype·html·head·body)를 벗기지 않는다.**
 * 예전에 아티팩트 게시를 염두에 두고 벗겼다가 `<meta name="viewport">` 까지 날아가,
 * 모바일이 레이아웃 폭을 약 980px 로 잡는 바람에 `@media (max-width: 620px)` 가
 * 한 번도 발동하지 않았다(데스크톱 화면이 통째로 축소돼 보였다).
 * 아티팩트는 자기 head 를 씌워 주지만 GitHub Pages 는 씌워 주지 않는다 — 원본 그대로 내보낸다.
 *
 * 프로젝트 본체에 두지 않는다 — 「빌드도구를 쓰지 않는다」는 제약과 부딪히므로 배포용 스크래치다.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'company_tax', 'tax-review');
const OUT = path.join(__dirname, 'AI세무사_단일파일.html');

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const dataUri = (f) =>
  'data:image/png;base64,' + fs.readFileSync(path.join(SRC, 'assets', f)).toString('base64');

let html = read('index.html');
const before = html.length;

// 치환문에 함수를 쓴다 — calc.js 에 '$&' 같은 문자열이 있으면 String.replace 가 특수하게 해석한다.
const put = (haystack, needle, value) => {
  if (!haystack.includes(needle)) throw new Error('찾지 못함: ' + needle);
  return haystack.replace(needle, () => value);
};

html = put(html, '<script src="calc.js"></script>', '<script>\n' + read('calc.js') + '\n</script>');
html = put(html, '<script src="succession-industry.js"></script>', '<script>\n' + read('succession-industry.js') + '\n</script>');
html = put(html, '<script src="fp.js"></script>', '<script>\n' + read('fp.js') + '\n</script>');

// 이미지는 여러 번 나올 수 있으므로 split/join 으로 전부 바꾼다.
html = html.split('assets/samsunglife.png').join(dataUri('samsunglife.png'));
html = html.split('assets/bichumi.png').join(dataUri('bichumi.png'));

fs.writeFileSync(OUT, html);

// 내보낸 파일이 갖춰야 할 것과 남아 있으면 안 되는 것을 함께 본다.
// viewport 메타 검사가 이 스크립트의 존재 이유 절반이다 — 없으면 모바일이 데스크톱 폭으로 렌더한다.
const problems = [];
if (/<script src=/.test(html)) problems.push('외부 스크립트 참조가 남았다');
if (/src="assets\//.test(html)) problems.push('외부 이미지 참조가 남았다');
if (!/<!DOCTYPE html>/i.test(html)) problems.push('doctype 이 없다');
if (!/<meta\s+charset=/i.test(html)) problems.push('charset 메타가 없다');
if (!/<meta\s+name="viewport"[^>]*width=device-width/i.test(html)) problems.push('viewport 메타가 없다 — 모바일이 축소 렌더된다');
if (!/@media \(max-width: 620px\)/.test(html)) problems.push('반응형 미디어쿼리가 없다');

console.log('원본 ' + before.toLocaleString() + '자 → 단일 파일 ' + html.length.toLocaleString() + '자');
console.log('출력: ' + OUT);
if (problems.length) {
  problems.forEach((m) => console.log('  결함: ' + m));
  process.exit(1);
}
console.log('자기완결·반응형 확인 — 외부 참조 0건, viewport 메타 있음');
