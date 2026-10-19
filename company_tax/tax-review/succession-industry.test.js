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
  SUCCESSION_INDUSTRY_CODES_CURRENT,
  SUCCESSION_BASIS_CURRENT,
  SUCCESSION_BASIS_REFORM,
  checkSuccessionIndustry,
  compareSuccessionIndustry,
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

// ══════════ 현행/개정 후 두 기준 판정 ══════════
// 아래 FIXTURE 는 판정 **로직**을 검증하기 위한 가짜 표다 — 법령 데이터가 아니다.
// 현행 별표 원문은 아직 SUCCESSION_INDUSTRY_CODES_CURRENT 에 들어 있지 않으므로(비어 있음)
// 실제 업종 판정의 정오는 이 테스트로 검증할 수 없고, 원문을 넣을 때 따로 대조해야 한다.
// 입력 코드는 숫자만 남기고 대조하므로 시험용 코드도 숫자여야 한다. 업종명에 「(시험용)」을 붙여
// 실데이터와 혼동되지 않게 했다.
const FIXTURE = {
  current: [
    ['C', '04', '(시험용) 중분류 전체 해당'],
    ['I', '09', '(시험용) 중분류 조건부', '(시험용) 조건이 있습니다'],
    ['I', '0911', '(시험용) 세분류 — 더 긴 접두 우선'],
  ],
  reform: [
    ['C', '04100', '(시험용) 개정 후에도 해당'],
    ['J', '05000', '(시험용) 개정 후에만 해당'],
  ],
};

test('현행 기준: 현행 업종표가 비어 있으면 판정 불가로 낸다(비해당으로 오판하지 않는다)', () => {
  assert.equal(SUCCESSION_INDUSTRY_CODES_CURRENT.length, 0, '현행 표를 채웠다면 이 테스트와 아래 비교 테스트를 실데이터 기준으로 다시 쓴다');
  const r = checkSuccessionIndustry('62010', SUCCESSION_BASIS_CURRENT);
  assert.equal(r.unavailable, true);
  assert.equal(r.matched, false);
  assert.equal(r.basis, SUCCESSION_BASIS_CURRENT);
  // 입력이 없으면 표가 비어 있어도 미입력이다
  const empty = checkSuccessionIndustry('', SUCCESSION_BASIS_CURRENT);
  assert.equal(empty.unavailable, false);
  assert.equal(empty.normalized, '');
});

test('기준 지정이 없으면 개정 후 기준이다 (기존 호출 호환)', () => {
  const a = checkSuccessionIndustry('62010');
  const b = checkSuccessionIndustry('62010', SUCCESSION_BASIS_REFORM);
  assert.equal(a.basis, SUCCESSION_BASIS_REFORM);
  assert.deepEqual(a, b);
  assert.equal(a.matched, true);
});

test('현행 기준: 중분류 같은 짧은 접두 행이 하위 코드 전체를 포괄한다', () => {
  const r = checkSuccessionIndustry('04123', SUCCESSION_BASIS_CURRENT, FIXTURE);
  assert.equal(r.matched, true);
  assert.equal(r.matchedCode, '04');
  assert.equal(r.approximate, false, '5자리 이하 입력은 접두 포괄이 정식 판정이다');
  // 6자리 국세청 업종코드는 앞 5자리로 대조했으므로 참고 판정
  assert.equal(checkSuccessionIndustry('041230', SUCCESSION_BASIS_CURRENT, FIXTURE).approximate, true);
});

test('현행 기준: 더 긴 접두 행이 짧은 행보다 우선하고 비고를 가져온다', () => {
  // '09100' 은 '09' 로만 시작한다('0911' 이 아니다) → 조건부 행
  assert.equal(checkSuccessionIndustry('09100', SUCCESSION_BASIS_CURRENT, FIXTURE).matchedCode, '09');
  assert.ok(checkSuccessionIndustry('09100', SUCCESSION_BASIS_CURRENT, FIXTURE).note.indexOf('조건') >= 0);
  // '09110' 은 '09' 와 '0911' 둘 다로 시작한다 → 더 긴 행이 이기고 비고도 그 행의 것(없음)
  const longer = checkSuccessionIndustry('09110', SUCCESSION_BASIS_CURRENT, FIXTURE);
  assert.equal(longer.matchedCode, '0911');
  assert.equal(longer.note, '');
});

test('현행 기준: 표에 없는 코드는 비해당이다', () => {
  const r = checkSuccessionIndustry('88888', SUCCESSION_BASIS_CURRENT, FIXTURE);
  assert.equal(r.matched, false);
  assert.equal(r.unavailable, false);
});

test('두 기준 비교: 변화 유형 — both · removed · added · neither', () => {
  const cmp = (code) => compareSuccessionIndustry(code, FIXTURE);
  assert.equal(cmp('04100').change, 'both');      // 현행 해당('04') · 개정 후 해당('04100')
  assert.equal(cmp('04200').change, 'removed');   // 현행 해당 · 개정 후 목록에 없음 — 2027.7.1. 이후 제외
  assert.equal(cmp('05000').change, 'added');     // 현행 비해당 · 개정 후 신규
  assert.equal(cmp('88888').change, 'neither');
  assert.equal(cmp('').change, 'empty');
  // 상태 값
  assert.equal(cmp('04200').currentState, 'ok');
  assert.equal(cmp('04200').reformState, 'no');
  assert.equal(cmp('09100').currentState, 'cond');
});

test('두 기준 비교: 현행 표가 없으면 변화 유형을 단정하지 않는다(unknown) — 개정 후 결과는 유효하다', () => {
  const r = compareSuccessionIndustry('62010');
  assert.equal(r.change, 'unknown');
  assert.equal(r.currentState, 'unavailable');
  assert.equal(r.reformState, 'ok');
  // 현행 표를 모르는 채로 「개정 후 비해당 = 제외됨」이라고 말하면 안 된다
  const no = compareSuccessionIndustry('99999');
  assert.equal(no.change, 'unknown');
  assert.equal(no.reformState, 'no');
});

if (failed) process.exitCode = 1;
