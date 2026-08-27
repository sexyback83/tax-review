'use strict';
// 가업상속공제 적용대상업종 확인 모듈 검증 — 실행: node succession-industry.test.js
//
// 기대값 산출 근거 (원칙 제3조):
//   · SUCCESSION_INDUSTRY_CODES는 FC가 보유한 상증법 시행령 제15조 [별표] 원문(엑셀 표기)을
//     그대로 전사한 데이터다. 총 개수(727)와 코드 중복 없음으로 전사가 맞는지 구조적으로
//     검증한다 — 세액 계산이 아니므로 oracle 교차검증·audit.test.js 대상에는 넣지 않았다.
//   · checkSuccessionIndustry()의 판정 결과는 위 데이터를 그대로 조회한 값이므로,
//     구현을 실행해 얻은 값이 아니라 데이터 자체에서 눈으로 확인한 값을 기대값으로 삼았다.

const assert = require('node:assert/strict');
const {
  SUCCESSION_INDUSTRY_CATEGORIES,
  SUCCESSION_INDUSTRY_CODES,
  SUCCESSION_DECEDENT_REQUIREMENTS,
  SUCCESSION_HEIR_REQUIREMENTS,
  checkSuccessionIndustry,
} = require('./succession-industry.js');

let failed = false;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL: ${name}`);
    console.error(err.message);
  }
}

test('가업상속공제 업종표: 별표 전체 727개, 코드 중복 없음', () => {
  assert.equal(SUCCESSION_INDUSTRY_CODES.length, 727);
  const codes = SUCCESSION_INDUSTRY_CODES.map((row) => row[1]);
  assert.equal(new Set(codes).size, codes.length);
  // 모든 코드는 SUCCESSION_INDUSTRY_CATEGORIES 에 정의된 대분류를 참조해야 한다.
  SUCCESSION_INDUSTRY_CODES.forEach((row) => {
    assert.ok(SUCCESSION_INDUSTRY_CATEGORIES[row[0]], `대분류 없음: ${row[0]} (${row[1]})`);
  });
});

test('업종 판정: 정확히 일치하는 코드는 적용대상으로 판정한다', () => {
  const r = checkSuccessionIndustry('62010');
  assert.equal(r.matched, true);
  assert.equal(r.approximate, false);
  assert.equal(r.category, 'J');
  assert.equal(r.name, '컴퓨터 프로그래밍 서비스업');
  assert.equal(r.note, '');
});

test('업종 판정: 목록에 없는 코드는 비대상으로 판정한다', () => {
  const r = checkSuccessionIndustry('99999');
  assert.equal(r.matched, false);
});

test('업종 판정: 사업자등록증 6자리 코드는 표준산업분류 코드를 접두로 보고 참고 판정한다', () => {
  const r = checkSuccessionIndustry('620100');
  assert.equal(r.matched, true);
  assert.equal(r.approximate, true);
  assert.equal(r.matchedCode, '62010');
});

test('업종 판정: 음식점업(56111~56199)은 직접 조리하지 않으면 제외된다는 단서가 붙는다', () => {
  const r = checkSuccessionIndustry('56111');
  assert.equal(r.matched, true);
  assert.ok(r.note.indexOf('직접') >= 0);
});

test('업종 판정: 빈 입력은 미확인으로 본다(비대상으로 오판하지 않는다)', () => {
  const r = checkSuccessionIndustry('');
  assert.equal(r.normalized, '');
  assert.equal(r.matched, false);
});

test('가업상속공제 요건 체크리스트: 피상속인 3항목 · 상속인 4항목 (상증법 제18조의2, 시행령 제15조 제3항)', () => {
  assert.equal(SUCCESSION_DECEDENT_REQUIREMENTS.length, 3);
  assert.equal(SUCCESSION_HEIR_REQUIREMENTS.length, 4);
  SUCCESSION_DECEDENT_REQUIREMENTS.concat(SUCCESSION_HEIR_REQUIREMENTS).forEach((r) => {
    assert.ok(r.id && r.label && r.basis);
  });
});

if (failed) process.exitCode = 1;
