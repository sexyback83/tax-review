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
  SUCCESSION_CURRENT_LAW_INDUSTRIES,
  SUCCESSION_CURRENT_REMARKS,
  industryState,
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

test('현행 기준: 업종표가 비어 있으면 판정 불가로 낸다(비해당으로 오판하지 않는다)', () => {
  // 실제 표는 채워져 있으므로 빈 표를 주입해 이 방어 동작을 시험한다.
  const NO_TABLE = { current: [] };
  const r = checkSuccessionIndustry('62010', SUCCESSION_BASIS_CURRENT, NO_TABLE);
  assert.equal(r.unavailable, true);
  assert.equal(r.matched, false);
  assert.equal(r.basis, SUCCESSION_BASIS_CURRENT);
  // 입력이 없으면 표가 비어 있어도 미입력이다
  const empty = checkSuccessionIndustry('', SUCCESSION_BASIS_CURRENT, NO_TABLE);
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
  const NO_TABLE = { current: [] };
  const r = compareSuccessionIndustry('62010', NO_TABLE);
  assert.equal(r.change, 'unknown');
  assert.equal(r.currentState, 'unavailable');
  assert.equal(r.reformState, 'ok');
  // 현행 표를 모르는 채로 「개정 후 비해당 = 제외됨」이라고 말하면 안 된다
  const no = compareSuccessionIndustry('99999', NO_TABLE);
  assert.equal(no.change, 'unknown');
  assert.equal(no.reformState, 'no');
});

// ══════════ 현행 업종표 (국세청 안내 책자 수록 시행령 [별표] <개정 2023. 2. 28.>) ══════════
// 기대값은 구현을 돌려 얻은 값이 아니라 별표 원문(PDF 26~28쪽)을 눈으로 읽어 적었다.

test('현행 업종표: 별표 「1. 한국표준산업분류에 따른 업종」 71행, 형식·중복 점검', () => {
  // 가 1 · 나 4(05~08) · 다 24(10~33) · 라 3(37~39) · 마 2 · 바 3 · 사 3 · 아 1 · 자 7 · 차 5 · 카 8 · 타 1 · 파 4 · 하 1 · 거 3 · 너 1
  assert.equal(SUCCESSION_INDUSTRY_CODES_CURRENT.length, 71);
  const codes = SUCCESSION_INDUSTRY_CODES_CURRENT.map((row) => row[1]);
  assert.equal(new Set(codes).size, codes.length, '코드 중복');
  SUCCESSION_INDUSTRY_CODES_CURRENT.forEach((row) => {
    assert.ok(SUCCESSION_INDUSTRY_CATEGORIES[row[0]], `대분류 없음: ${row[0]} (${row[1]})`);
    assert.ok(/^[0-9]{2,5}$/.test(row[1]), `코드 형식: ${row[1]}`);
    assert.ok(row[2], `업종명 없음: ${row[1]}`);
    assert.ok(row[4] === undefined || row[4] === 'exclude', `구분 값: ${row[1]}`);
  });
  // 제외 행은 별표가 「다만 …은 제외한다」고 한 두 업종뿐이다
  assert.deepEqual(
    SUCCESSION_INDUSTRY_CODES_CURRENT.filter((row) => row[4] === 'exclude').map((row) => row[1]).sort(),
    ['59142', '90212']);
});

test('현행 업종표: 「2. 개별법률의 규정에 따른 업종」 17가지와 참고사항', () => {
  assert.equal(SUCCESSION_CURRENT_LAW_INDUSTRIES.length, 17);
  // 가~더 — 한글 순서 표기가 원문과 같아야 한다
  assert.deepEqual(SUCCESSION_CURRENT_LAW_INDUSTRIES.map((r) => r[0]).join(''), '가나다라마바사아자차카타파하거너더');
  assert.ok(SUCCESSION_CURRENT_LAW_INDUSTRIES.some((r) => r[1].indexOf('의료법') >= 0));
  assert.ok(SUCCESSION_CURRENT_LAW_INDUSTRIES.some((r) => r[1].indexOf('물류산업') >= 0));
  assert.ok(SUCCESSION_CURRENT_REMARKS.length >= 3);
});

test('현행 기준 판정: 별표 원문을 읽어 확인한 사례 (해당·조건부·제외·비해당)', () => {
  // [입력, 기대 상태, 기대 매칭 코드]
  const cases = [
    ['62010', 'ok', '62'],         // 정보통신업 — 컴퓨터 프로그래밍(62) 전체
    ['10110', 'ok', '10'],         // 제조업(10~33) 전체
    ['33000', 'ok', '33'],         // 제조업 범위의 끝
    ['34011', 'no', undefined],    // 34 는 제조업 범위(10~33) 밖
    ['05100', 'ok', '05'],         // 광업(05~08) 전체 — 앞의 0
    ['41000', 'ok', '41'],         // 건설업(41~42) 전체
    ['47111', 'ok', '47'],         // 도매 및 소매업(45~47) 전체
    ['56111', 'ok', '561'],        // 음식점 및 주점업(56) 중 음식점업(561) — 별표엔 직접 조리 단서가 없다
    ['56229', 'no', undefined],    // 562(주점·비알코올 음료점업)는 열거되지 않았다
    ['55101', 'no', undefined],    // 숙박업(55)은 열거되지 않았다
    ['49211', 'cond', '49'],       // 운수업 — 여객운송업만
    ['52101', 'no', undefined],    // 창고업(52)은 열거되지 않았다(물류산업은 개별법률 쪽)
    ['59141', 'ok', '59'],         // 영상·오디오 기록물제작 및 배급업(59) 전체
    ['59142', 'excluded', '59142'],// 다만 비디오물 감상실 운영업(59142)은 제외
    ['61210', 'ok', '612'],        // 우편 및 통신업(61) 중 전기통신업(612)
    ['61110', 'no', undefined],    // 612 가 아닌 61 은 열거되지 않았다
    ['71310', 'ok', '713'],        // 전문서비스업(71) 중 광고업(713)
    ['71100', 'no', undefined],    // 713·714 외의 71 은 열거되지 않았다
    ['76400', 'cond', '764'],      // 무형재산권 임대업 — 지식재산 임대로 한정
    ['76110', 'no', undefined],    // 부동산 임대업은 제외
    ['85110', 'ok', '8511'],       // 교육 서비스업 중 유아 교육기관
    ['85200', 'no', undefined],    // 그 밖의 교육 서비스업
    ['87000', 'ok', '87'],         // 사회복지서비스업 전체
    ['90119', 'ok', '901'],        // 창작 및 예술관련 서비스업
    ['90211', 'ok', '902'],        // 도서관, 사적지 및 유사 여가관련 서비스업
    ['90212', 'excluded', '90212'],// 다만 독서실 운영업(90212)은 제외
    ['96993', 'ok', '96993'],      // 개인 간병인 및 유사 서비스업
    ['96991', 'no', undefined],    // 기타 개인 서비스업 중 간병인 외
    ['01123', 'cond', '01123'],    // 종자 및 묘목 생산업 — 토지·건물 비율 50% 미만 조건
    ['86101', 'no', undefined],    // 병원은 표준산업분류 목록엔 없다(의료기관은 개별법률 업종)
  ];
  cases.forEach(([code, state, matched]) => {
    const r = checkSuccessionIndustry(code, SUCCESSION_BASIS_CURRENT);
    assert.equal(industryState(r), state, `${code}: 상태 ${industryState(r)} (기대 ${state})`);
    assert.equal(r.matchedCode, matched, `${code}: 매칭 코드 ${r.matchedCode} (기대 ${matched})`);
  });
});

test('현행 기준 판정: 제외 업종은 비해당이지만 업종명·사유를 돌려준다', () => {
  const r = checkSuccessionIndustry('59142', SUCCESSION_BASIS_CURRENT);
  assert.equal(r.matched, false);
  assert.equal(r.excluded, true);
  assert.equal(r.name, '비디오물 감상실 운영업');
  assert.ok(r.note.indexOf('제외') >= 0);
  // 같은 중분류의 다른 코드는 그대로 해당이다 — 가장 긴 접두 행이 이긴다
  assert.equal(checkSuccessionIndustry('59149', SUCCESSION_BASIS_CURRENT).matched, true);
});

test('코드 부족: 입력이 짧아 판정할 수 없으면 비해당이라 하지 않고 partial 로 낸다', () => {
  // '71' 은 713·714 만 해당이라 전체를 단정할 수 없다 (현행)
  const r = checkSuccessionIndustry('71', SUCCESSION_BASIS_CURRENT);
  assert.equal(r.partial, true);
  assert.equal(r.matched, false);
  assert.equal(industryState(r), 'partial');
  // 5자리 이상이면 코드가 모자란 게 아니다
  assert.equal(checkSuccessionIndustry('71100', SUCCESSION_BASIS_CURRENT).partial, false);
  // 어느 행의 앞자리도 아닌 짧은 입력은 그냥 비해당이다
  assert.equal(checkSuccessionIndustry('99', SUCCESSION_BASIS_CURRENT).partial, false);
  // 개정 후 표도 같은 규칙 — 4자리 '6201' 은 62010 등의 앞자리다
  assert.equal(checkSuccessionIndustry('6201').partial, true);
  assert.equal(compareSuccessionIndustry('6201').change, 'partial');
});

test('개정 후 표: 코드가 모두 5자리 숫자다 — 엑셀 전사 때 앞의 0이 잘린 9개 코드를 복원했다', () => {
  SUCCESSION_INDUSTRY_CODES.forEach((row) => {
    assert.ok(/^[0-9]{5}$/.test(row[1]), `5자리 아님: ${row[1]} ${row[2]}`);
  });
  // 대분류 A·B(01~08)는 코드가 0으로 시작한다. 잘렸던 코드를 사업자등록증 그대로 입력해도 맞아야 한다.
  ['01123', '05100', '06100', '06200', '07110', '07121', '07210', '07290', '08000'].forEach((code) => {
    const r = checkSuccessionIndustry(code, SUCCESSION_BASIS_REFORM);
    assert.equal(r.matched, true, `${code} 를 개정 후 표에서 찾지 못했다`);
    assert.equal(r.matchedCode, code);
    assert.equal(r.approximate, false);
  });
  // 6자리 국세청 코드도 앞 5자리로 대조된다
  assert.equal(checkSuccessionIndustry('051000', SUCCESSION_BASIS_REFORM).matchedCode, '05100');
});

test('두 기준 비교(실제 표): 두 표의 실제 차이 — both · removed · added · neither', () => {
  const cmp = (code) => compareSuccessionIndustry(code);
  // 양쪽 모두 해당 — 현행 62(전체), 개정 후 62010
  assert.equal(cmp('62010').change, 'both');
  // 현행 해당 → 개정 후 제외: 소매업(47)은 현행 전체인데 개정 후 표에는 4711x(종합소매업)가 없다
  assert.equal(cmp('47111').change, 'removed');
  assert.equal(cmp('47111').currentState, 'ok');
  assert.equal(cmp('47111').reformState, 'no');
  // 현행 비해당 → 개정 후 신규: 자동차 종합 수리업(95211). 현행에선 개별법률(자동차정비공장) 쪽으로만 인정된다
  assert.equal(cmp('95211').change, 'added');
  // 양쪽 비해당 — 병원(86101)·창고업(52101). 현행은 개별법률(의료기관·물류산업)로 해당할 수 있다
  assert.equal(cmp('86101').change, 'neither');
  assert.equal(cmp('52101').change, 'neither');
  // 한쪽만 조건이 붙는다: 음식점업은 현행 조건 없음, 개정 후 「직접 조리」 단서
  assert.equal(cmp('56111').currentState, 'ok');
  assert.equal(cmp('56111').reformState, 'cond');
  assert.equal(cmp('56111').change, 'both');
});

test('두 기준 비교(실제 표): 개정 후 727개 중 22개는 현행 표준산업분류 목록에 없다', () => {
  // 이 22개는 현행에서 별표 「2. 개별법률」(자동차정비·해운법·신재생에너지 등)로만 인정될 수 있다.
  // 개정 후 표가 바뀌거나 현행 표를 고치면 이 값도 다시 센다.
  const noCount = SUCCESSION_INDUSTRY_CODES
    .filter((row) => ['no', 'excluded'].indexOf(industryState(checkSuccessionIndustry(row[1], SUCCESSION_BASIS_CURRENT))) >= 0)
    .length;
  assert.equal(noCount, 22);
});

if (failed) process.exitCode = 1;
