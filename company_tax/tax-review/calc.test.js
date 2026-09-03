'use strict';
// 세금진단 사전검토 — 8개 세목 계산 모듈 검증
// 실행: node company_tax/tax-review/calc.test.js   (프로젝트 원칙 제2조)
//
// 기대값 산출 근거 (원칙 제3조):
//   · 상속세 6건은 oracle/testcases.json(법정 산식 직접 도출, 26케이스 검증 완료)에서 전사했다.
//     동일 입력에 동일 결과를 요구함으로써 두 구현의 분기(divergence)를 잡는다.
//   · 나머지 7세목은 법정 산식을 "세율 × 과세표준 − 누진공제액" 형태로 직접 전개해 도출했다.
//     구현은 "구간별 한계세율 누적" 형태이므로 두 형태의 일치가 곧 교차검증이다.
//     각 케이스의 전개 과정은 단언 옆 주석에 남긴다.
//   · 구현을 실행해 얻은 값을 기대값으로 삼지 않았다.

const assert = require('node:assert/strict');
const {
  calculateTieredTax,
  calculateMinorYearsTotal,
  isMinorAge,
  lookupLifeExpectancy,
  LIFE_TABLE_YEAR,
  LIFE_EXPECTANCY_MALE,
  LIFE_EXPECTANCY_FEMALE,
  MINOR_AGE_LIMIT,
  INHERITANCE_TAX_BRACKETS,
  INCOME_TAX_BRACKETS,
  TRANSFER_SURCHARGE_OPTIONS,
  CORPORATE_TAX_RATE_OPTIONS,
  CORPORATE_TAX_RATE_OPTIONS_UNTIL_2025,
  CORPORATE_TAX_RATE_APPLIED_FROM,
  calculateInheritanceTax,
  calculateSecondaryInheritance,
  calculateGiftTax,
  calculateComprehensiveRealEstateTax,
  calculateTransferIncomeTax,
  calculateBusinessSuccession,
  calculateWeightedNetIncome,
  calculateUnlistedStockValue,
  calculateServiceYearsFromMonths,
  allocateServiceYears,
  calculateEarnedIncomeDeduction,
  calculateEarnedIncomeTaxCredit,
  calculateEarnedIncomeTax,
  calculateDividendTax,
  calculateSalaryDividendCompare,
  calculateExecutiveSeveranceTax,
  JONGBU_BURDEN_CAP_RATE,
} = require('./calc.js');

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

const 억 = 100000000;
const 만 = 10000;

// ══════════════════════════ 누진세율 (공통 기초) ══════════════════════════

test('calculateTieredTax: 과세표준 0 이하는 0원', () => {
  assert.equal(calculateTieredTax(0, INHERITANCE_TAX_BRACKETS), 0);
  assert.equal(calculateTieredTax(-1000, INHERITANCE_TAX_BRACKETS), 0);
});

test('calculateTieredTax: 상속세 구간별 경계값', () => {
  // 1억 이하 10%
  assert.equal(calculateTieredTax(1 * 억, INHERITANCE_TAX_BRACKETS), 1000 * 만);
  // 5억: 5억×20% − 누진공제 1천만 = 1억 − 1천만
  assert.equal(calculateTieredTax(5 * 억, INHERITANCE_TAX_BRACKETS), 9000 * 만);
  // 10억: 10억×30% − 6천만 = 3억 − 6천만
  assert.equal(calculateTieredTax(10 * 억, INHERITANCE_TAX_BRACKETS), 24000 * 만);
  // 30억: 30억×40% − 1.6억 = 12억 − 1.6억
  assert.equal(calculateTieredTax(30 * 억, INHERITANCE_TAX_BRACKETS), 104000 * 만);
  // 50억: 50억×50% − 4.6억 = 25억 − 4.6억
  assert.equal(calculateTieredTax(50 * 억, INHERITANCE_TAX_BRACKETS), 204000 * 만);
});

test('calculateTieredTax: 소득세 구간별 경계값', () => {
  // 1,400만 이하 6%
  assert.equal(calculateTieredTax(1400 * 만, INCOME_TAX_BRACKETS), 84 * 만);
  // 5,000만: 5,000만×15% − 126만 = 750만 − 126만
  assert.equal(calculateTieredTax(5000 * 만, INCOME_TAX_BRACKETS), 624 * 만);
  // 8,800만: ×24% − 576만 = 2,112만 − 576만
  assert.equal(calculateTieredTax(8800 * 만, INCOME_TAX_BRACKETS), 1536 * 만);
  // 1.5억: ×35% − 1,544만 = 5,250만 − 1,544만
  assert.equal(calculateTieredTax(15000 * 만, INCOME_TAX_BRACKETS), 3706 * 만);
  // 3억: ×38% − 1,994만 = 1억1,400만 − 1,994만
  assert.equal(calculateTieredTax(30000 * 만, INCOME_TAX_BRACKETS), 9406 * 만);
  // 10억: ×42% − 3,594만 = 4억2,000만 − 3,594만
  assert.equal(calculateTieredTax(100000 * 만, INCOME_TAX_BRACKETS), 38406 * 만);
});

test('선택지 세율표는 계산 모듈이 소유한다 (화면 계층에 세율 숫자를 두지 않는다)', () => {
  // 중과율은 적용 기준·연도에 따라 달라지므로 화면은 주택 수만 넘긴다.
  // 중과는 조정대상지역 다주택에만 적용되므로 "중과 없음"이 두 경우로 갈린다.
  // requiresExempt는 화면이 1세대1주택 비과세 선택과 짝을 맞추는 데 쓴다.
  assert.deepEqual(TRANSFER_SURCHARGE_OPTIONS, [
    { label: '없음 — 1세대1주택 비과세', houses: 0, requiresExempt: true },
    { label: '없음 — 중과 대상 아님', houses: 0, requiresExempt: false },
    { label: '2주택 중과', houses: 2, requiresExempt: false },
    { label: '3주택 이상 중과', houses: 3, requiresExempt: false },
  ]);
  // 비과세 전용 선택지는 정확히 하나여야 한다 — 화면이 그 하나만 열거나 닫는다.
  assert.equal(TRANSFER_SURCHARGE_OPTIONS.filter((o) => o.requiresExempt).length, 1);
  // 법인세법 제55조 제1항 — 2024.12.31. 개정으로 전 구간 1%p 인상
  // 2026.1.1. 이후 개시 사업연도부터 적용
  assert.equal(CORPORATE_TAX_RATE_APPLIED_FROM, '2026.1.1. 이후 개시 사업연도');
  assert.deepEqual(CORPORATE_TAX_RATE_OPTIONS, [
    { label: '10%', rate: 0.10, bracket: '과세표준 2억원 이하' },
    { label: '20%', rate: 0.20, bracket: '2억~200억원' },
    { label: '22%', rate: 0.22, bracket: '200억~3,000억원' },
    { label: '25%', rate: 0.25, bracket: '3,000억원 초과' },
  ]);
  // 2025 사업연도까지의 세율도 참고용으로 보관한다
  assert.deepEqual(CORPORATE_TAX_RATE_OPTIONS_UNTIL_2025.map((o) => o.rate), [0.09, 0.19, 0.21, 0.24]);
});

test('isMinorAge: 만 19세 미만이 미성년자다', () => {
  assert.equal(isMinorAge(0), true);
  assert.equal(isMinorAge(18), true);
  assert.equal(isMinorAge(19), false);   // 경계
  assert.equal(isMinorAge(25), false);
  assert.equal(isMinorAge(null), false); // 생년월일 미입력
});

// ══════════════════════════ 1. 상속세 ══════════════════════════
// 기대값 출처: oracle/testcases.json (26케이스 검증 완료분에서 전사)

test('상속세 시나리오1: 배우자+자녀2명, 부동산18억+현금2억', () => {
  const r = calculateInheritanceTax({ realEstate: 18 * 억, cash: 2 * 억, hasSpouse: true, numChildren: 2 });
  assert.equal(r.totalEstate, 2000000000);
  assert.equal(r.taxBase, 602857143);
  assert.equal(r.calculatedTax, 120857143);
  assert.equal(r.finalTax, 117231429);
  assert.equal(r.breakdown.standardDeduction, 500000000);
  assert.equal(r.breakdown.financialDeduction, 40000000);
});

test('상속세 시나리오A: 배우자 없이 자녀2명, 부동산10억', () => {
  const r = calculateInheritanceTax({ realEstate: 10 * 억, cash: 0, hasSpouse: false, numChildren: 2 });
  assert.equal(r.taxBase, 500000000);
  assert.equal(r.calculatedTax, 90000000);
  assert.equal(r.finalTax, 87300000);
});

test('상속세 시나리오B: 금융재산공제 2억 상한 적용', () => {
  const r = calculateInheritanceTax({ realEstate: 0, cash: 30 * 억, hasSpouse: false, numChildren: 1 });
  assert.equal(r.breakdown.financialDeduction, 200000000);
  assert.equal(r.taxBase, 2300000000);
  assert.equal(r.finalTax, 737200000);
});

test('상속세 시나리오C: 배우자 단독상속(자녀 없음)은 일괄공제 배제, 공제>재산이면 세액 0', () => {
  const r = calculateInheritanceTax({ realEstate: 10 * 억, cash: 0, hasSpouse: true, numChildren: 0 });
  assert.equal(r.breakdown.standardDeduction, 200000000);
  assert.equal(r.taxBase, 0);
  assert.equal(r.finalTax, 0);
});

test('상속세 시나리오D: 인적공제 합계가 일괄공제보다 크면 인적공제 적용', () => {
  const r = calculateInheritanceTax({ realEstate: 15 * 억, cash: 0, hasSpouse: true, numChildren: 2, minorYearsTotal: 25 });
  assert.equal(r.breakdown.standardDeduction, 550000000);
  assert.equal(r.taxBase, 307142857);
  assert.equal(r.finalTax, 49885714);
});

test('상속세 시나리오E: 채무·장례비·사전증여가 과세가액에 반영됨', () => {
  const r = calculateInheritanceTax({
    realEstate: 10 * 억, cash: 0, hasSpouse: false, numChildren: 1,
    debt: 1 * 억, funeralCost: 1000 * 만, priorGift: 5000 * 만,
  });
  assert.equal(r.taxableValue, 940000000);
  assert.equal(r.taxBase, 440000000);
  assert.equal(r.calculatedTax, 78000000);
  assert.equal(r.finalTax, 75660000);
});

test('calculateMinorYearsTotal: 나이별 19세까지의 잔여연수를 합산한다', () => {
  assert.equal(MINOR_AGE_LIMIT, 19);
  assert.equal(calculateMinorYearsTotal([]), 0);
  assert.equal(calculateMinorYearsTotal([10]), 9);          // 19 − 10
  assert.equal(calculateMinorYearsTotal([10, 7]), 21);      // 9 + 12
  assert.equal(calculateMinorYearsTotal([19]), 0);          // 경계 — 19세는 미성년자 아님
  assert.equal(calculateMinorYearsTotal([25, 30]), 0);      // 성년만 있으면 0
  assert.equal(calculateMinorYearsTotal([0]), 19);          // 0세
  assert.equal(calculateMinorYearsTotal([5, 22, 12]), 21);  // 14 + 0 + 7
});

// ── 장애인공제 기대여명 (완전생명표 1세별, DT_1B42, 2024년) ──
// 기대값은 통계표 원본에서 전사했다. 보도자료에 공개된 지점(0·40·60세)과도 대조한다.

test('생명표: 통계표 구조가 온전하다 (0~100세, 결측 없음, 단조감소)', () => {
  assert.equal(LIFE_TABLE_YEAR, 2024);
  assert.equal(LIFE_EXPECTANCY_MALE.length, 101);    // 0세 ~ 100세 이상
  assert.equal(LIFE_EXPECTANCY_FEMALE.length, 101);
  for (const table of [LIFE_EXPECTANCY_MALE, LIFE_EXPECTANCY_FEMALE]) {
    table.forEach((v, i) => {
      assert.equal(typeof v, 'number', i + '세 값이 숫자여야 한다');
      assert.ok(v > 0, i + '세 기대여명은 0보다 커야 한다');
      if (i > 0) assert.ok(v <= table[i - 1], i + '세 기대여명은 직전 나이보다 크지 않아야 한다');
    });
  }
});

test('생명표: 2024년 보도자료 공개 지점과 일치한다', () => {
  // 0세 기대수명 남 80.8년 / 여 86.6년
  assert.equal(lookupLifeExpectancy('남', 0), 80.80831);
  assert.equal(lookupLifeExpectancy('여', 0), 86.57869);
  // 40세 남 41.9년 / 여 47.4년
  assert.equal(lookupLifeExpectancy('남', 40), 41.88469);
  assert.equal(lookupLifeExpectancy('여', 40), 47.40789);
  // 60세 남 23.7년 / 여 28.4년
  assert.equal(lookupLifeExpectancy('남', 60), 23.72133);
  assert.equal(lookupLifeExpectancy('여', 60), 28.39179);
});

test('lookupLifeExpectancy: 성별에 따라 다른 값을 돌려준다', () => {
  assert.equal(lookupLifeExpectancy('남', 12), 69.10956);
  assert.equal(lookupLifeExpectancy('여', 12), 74.84786);
  // 성별 미지정·오타는 남자 표로 처리한다 (기본값)
  assert.equal(lookupLifeExpectancy('', 12), 69.10956);
});

test('lookupLifeExpectancy: 표 범위를 벗어난 나이는 양 끝 값으로 절단한다', () => {
  assert.equal(lookupLifeExpectancy('남', 100), 1.88532);   // 100세 이상 구간
  assert.equal(lookupLifeExpectancy('남', 130), 1.88532);
  assert.equal(lookupLifeExpectancy('여', -5), 86.57869);   // 0세로 절단
  assert.equal(lookupLifeExpectancy('남', 12.9), 69.10956); // 소수는 내림
});

test('상속세: 조회한 기대여명이 장애인공제에 반영된다', () => {
  // 부동산 30억, 배우자 있음, 자녀 1명(30세 남 장애인)
  // 30세 남자 기대여명 51.4874년 → 장애인공제 1,000만원 × 51.4874 = 514,874,000원
  const life = lookupLifeExpectancy('남', 30);
  assert.equal(life, 51.4874);
  const r = calculateInheritanceTax({
    realEstate: 30 * 억, cash: 0, hasSpouse: true, numChildren: 1,
    disabledYearsTotal: life,
  });
  // 인적공제 = 기초 2억 + 자녀 5,000만 + 장애인 5억1,487.4만 = 7억6,487.4만
  assert.equal(r.breakdown.personalDeduction, 764874000);
  assert.equal(r.breakdown.standardDeduction, 764874000);   // 일괄공제 5억보다 크다
  // 배우자 법정상속분 = 30억 × 1.5/2.5 = 18억
  assert.equal(r.breakdown.spouseDeduction, 18 * 억);
  // 과세표준 = 30억 − 7억6,487.4만 − 18억 = 4억3,512.6만
  assert.equal(r.taxBase, 435126000);
  // 4억3,512.6만 → 1억×10% + 3억3,512.6만×20% = 1,000만 + 6,702.52만 = 7,702.52만
  assert.equal(r.calculatedTax, 77025200);
  assert.equal(r.finalTax, 77025200 - 2310756);
});

test('상속세: 자녀 나이로 산출한 미성년자 잔여연수가 시나리오D와 일치한다', () => {
  // 시나리오D의 minorYearsTotal 25는 예컨대 6세·7세 자녀(13 + 12)로 재현된다.
  assert.equal(calculateMinorYearsTotal([6, 7]), 25);
  const r = calculateInheritanceTax({
    realEstate: 15 * 억, cash: 0, hasSpouse: true, numChildren: 2,
    minorYearsTotal: calculateMinorYearsTotal([6, 7]),
  });
  assert.equal(r.breakdown.standardDeduction, 550000000);
  assert.equal(r.finalTax, 49885714);
});

test('상속세: 장례비용은 1,000만원을 초과해 인정되지 않는다', () => {
  // 장례비 3,000만원을 넣어도 1,000만원만 차감되므로 시나리오E와 동일한 결과여야 한다
  const r = calculateInheritanceTax({
    realEstate: 10 * 억, cash: 0, hasSpouse: false, numChildren: 1,
    debt: 1 * 억, funeralCost: 3000 * 만, priorGift: 5000 * 만,
  });
  assert.equal(r.taxableValue, 940000000);
  assert.equal(r.finalTax, 75660000);
});

// ── 2차 상속 (배우자 사망) ──
// 배우자상속공제로 배우자에게 이전된 재산이 2차 상속재산에 더해진다.
// 2차에는 배우자가 없으므로 배우자상속공제가 없고 상속인은 자녀뿐이다.

test('2차 상속 N1: 21억·배우자·자녀2 — 1차 공제액 9억이 2차 상속재산이 된다', () => {
  const first = calculateInheritanceTax({
    realEstate: 21 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  // 1차: 법정상속분 21억 × 1.5/3.5 = 9억, 일괄공제 5억 (기초2억+자녀1억=3억보다 유리)
  // 과세표준 21억 − 5억 − 9억 = 7억 → ×30% − 6,000만 = 1.5억 → ×97% = 1억4,550만
  assert.equal(first.breakdown.spouseDeduction, 9 * 억);
  assert.equal(first.taxBase, 7 * 억);
  assert.equal(first.finalTax, 145500000);

  const s = calculateSecondaryInheritance({ first: first, numChildren: 2 });
  assert.equal(s.transferred, 9 * 억);
  assert.equal(s.secondEstate, 9 * 억);
  // 2차: 과세표준 9억 − 일괄공제 5억 = 4억 → ×20% − 1,000만 = 7,000만 → ×97% = 6,790만
  assert.equal(s.second.taxBase, 4 * 억);
  assert.equal(s.secondTax, 67900000);
  assert.equal(s.totalTax, 213400000);          // 1억4,550만 + 6,790만
});

test('2차 상속 N2: 배우자 고유재산 5억(금융 3억)이 합산되고 금융재산공제가 적용된다', () => {
  const first = calculateInheritanceTax({
    realEstate: 21 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  const s = calculateSecondaryInheritance({
    first: first, spouseOwnAsset: 5 * 억, spouseOwnFinancial: 3 * 억, numChildren: 2,
  });
  assert.equal(s.secondEstate, 14 * 억);        // 이전 9억 + 고유 5억
  // 금융재산 3억 → 순금융재산 3억 × 20% = 6,000만 (한도 2억 미달)
  assert.equal(s.second.breakdown.financialDeduction, 6000 * 만);
  // 과세표준 14억 − 5억 − 6,000만 = 8억4,000만 → ×30% − 6,000만 = 1억9,200만 → ×97%
  assert.equal(s.second.taxBase, 84000 * 만);
  assert.equal(s.secondTax, 186240000);
  assert.equal(s.totalTax, 331740000);
});

test('2차 상속 N3: 금융자산이 고유재산을 넘어설 수 없다', () => {
  const first = calculateInheritanceTax({
    realEstate: 21 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  const s = calculateSecondaryInheritance({
    first: first, spouseOwnAsset: 3 * 억, spouseOwnFinancial: 10 * 억, numChildren: 2,
  });
  assert.equal(s.spouseOwnFinancial, 3 * 억);   // 고유재산으로 절단
  assert.equal(s.secondEstate, 12 * 억);        // 이전 9억 + 고유 3억 (중복 계상 없음)
});

test('2차 상속 N4: 배우자상속공제가 없으면 이전 재산도 없다', () => {
  const first = calculateInheritanceTax({
    realEstate: 21 * 억, cash: 0, hasSpouse: false, numChildren: 2,
  });
  assert.equal(first.breakdown.spouseDeduction, 0);
  const s = calculateSecondaryInheritance({ first: first, spouseOwnAsset: 2 * 억, numChildren: 2 });
  assert.equal(s.transferred, 0);
  assert.equal(s.secondEstate, 2 * 억);         // 배우자 고유재산만
});

// ── 2차 상속재산의 기준은 "공제액"이 아니라 "배우자가 실제로 취득하는 재산"이다 ──
// 배우자상속공제액 = max(5억, min(실제취득액, 법정상속분, 30억)) 이므로
// 상한·하한에 걸리면 취득액과 어긋난다. 공제액을 이전 재산으로 쓰면 양방향으로 틀린다.

test('2차 상속 N5: 법정상속분이 공제 상한 30억을 넘으면 상한이 아니라 법정상속분이 이전된다', () => {
  const first = calculateInheritanceTax({
    realEstate: 100 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  // 법정상속분 = 100억 × 1.5 / (1.5+2) = 150억/3.5 = 42억 8,571만 4,285.71원
  assert.equal(Math.round(first.breakdown.statutoryShare), 4285714286);
  // 공제액은 상한 30억에서 잘린다
  assert.equal(first.breakdown.spouseDeduction, 30 * 억);

  const s = calculateSecondaryInheritance({ first: first, numChildren: 2 });
  // 배우자가 실제로 가져가는 재산은 42.86억이다. 공제 상한 30억은 세법상 공제 한도일 뿐이다.
  assert.equal(Math.round(s.transferred), 4285714286);
  assert.ok(s.transferred > s.spouseDeduction, '이전 재산이 공제액보다 커야 한다');
  assert.notEqual(Math.round(s.transferred), 30 * 억);   // 공제액을 쓰던 과거 동작 고정 방지

  // 2차: 과세가액 4,285,714,285.71 − 일괄공제 5억 → 과세표준 3,785,714,286
  assert.equal(s.second.taxBase, 3785714286);
  // 세액 = 1억×10% + 4억×20% + 5억×30% + 20억×40% + (37.857억−30억)×50%
  //      = 1,000만 + 8,000만 + 1억5,000만 + 8억 + 3억9,285만7,143 = 14억3,285만7,143
  assert.equal(s.second.calculatedTax, 1432857143);
  // 신고세액공제 3% = 4,298만5,714 → 13억8,987만1,429
  assert.equal(s.secondTax, 1389871429);

  // 공제액 30억을 이전 재산으로 쓰면 2차 세액이 8억1,480만원으로 5억7,507만원 과소계상된다.
  //   (과세표준 30억−5억=25억 → 세액 8억4,000만 → ×97% = 8억1,480만)
  assert.ok(s.secondTax - 814800000 > 5 * 억, '과거 동작보다 5억 이상 크다');
});

test('2차 상속 N6: 배우자 실제 상속액이 법정상속분을 넘으면 그 금액이 이전된다', () => {
  const first = calculateInheritanceTax({
    realEstate: 30 * 억, cash: 0, hasSpouse: true, numChildren: 2,
    actualSpouseShare: 20 * 억,
  });
  // 법정상속분 = 30억 × 1.5/3.5 = 12억 8,571만 4,285.71원. 공제는 여기서 잘린다.
  assert.equal(Math.round(first.breakdown.statutoryShare), 1285714286);
  assert.equal(Math.round(first.breakdown.spouseDeduction), 1285714286);

  const s = calculateSecondaryInheritance({
    first: first, spouseAcquired: 20 * 억, numChildren: 2,
  });
  assert.equal(s.transferred, 20 * 억);         // 실제 취득액
  assert.equal(s.usesStatutoryShare, false);
  // 2차: 과세표준 20억 − 5억 = 15억
  assert.equal(s.second.taxBase, 15 * 억);
  // 1억×10% + 4억×20% + 5억×30% + 5억×40% = 1,000만+8,000만+1억5,000만+2억 = 4억4,000만
  assert.equal(s.second.calculatedTax, 44000 * 만);
  assert.equal(s.secondTax, 426800000);         // ×97%
});

test('2차 상속 N7: 공제 하한 5억이 취득액을 부풀리지 않는다', () => {
  const first = calculateInheritanceTax({
    realEstate: 6 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  // 법정상속분 = 6억 × 1.5/3.5 = 2억 5,714만 2,857.14원 → 공제는 하한 5억으로 올라간다
  assert.equal(Math.round(first.breakdown.statutoryShare), 257142857);
  assert.equal(first.breakdown.spouseDeduction, 5 * 억);

  const s = calculateSecondaryInheritance({
    first: first, spouseOwnAsset: 10 * 억, numChildren: 2,
  });
  assert.equal(Math.round(s.transferred), 257142857);
  assert.ok(s.transferred < s.spouseDeduction, '이전 재산이 공제액보다 작아야 한다');
  // 2차 과세가액 = 고유 10억 + 이전 2억5,714만2,857.14 = 12억5,714만2,857.14
  //   → 과세표준 − 일괄공제 5억 = 757,142,857
  assert.equal(s.second.taxBase, 757142857);
  // 1억×10% + 4억×20% + (7.571억−5억)×30% = 1,000만 + 8,000만 + 7,714만2,857 = 1억6,714만2,857
  assert.equal(s.second.calculatedTax, 167142857);
  assert.equal(s.secondTax, 162128571);         // ×97%
  // 하한 5억을 이전 재산으로 쓰면 과세표준 10억, 세액 2억3,280만원으로 과대계상된다.
  assert.ok(s.secondTax < 232800000, '과거 동작보다 작다');
});

test('2차 상속 N8: 화면이 비교표를 그릴 수 있도록 두 기준 금액을 함께 반환한다', () => {
  const first = calculateInheritanceTax({
    realEstate: 100 * 억, cash: 0, hasSpouse: true, numChildren: 2,
  });
  const s = calculateSecondaryInheritance({ first: first, numChildren: 2 });
  assert.equal(s.spouseDeduction, first.breakdown.spouseDeduction);
  assert.equal(s.statutoryShare, first.breakdown.statutoryShare);
  assert.equal(s.usesStatutoryShare, true);
  // 배우자가 없으면 실제 상속액을 넘겨도 이전 재산은 0이다
  const none = calculateInheritanceTax({
    realEstate: 30 * 억, cash: 0, hasSpouse: false, numChildren: 2,
  });
  const s2 = calculateSecondaryInheritance({
    first: none, spouseAcquired: 10 * 억, numChildren: 2,
  });
  assert.equal(s2.transferred, 0);
});

// ══════════════════════════ 2. 증여세 (부담부증여) ══════════════════════════
// 증여재산공제: 배우자 6억 / 직계존비속 5,000만(미성년 2,000만) / 기타친족 1,000만
// 채무인수분은 유상양도로 보아 증여자에게 양도소득세가 과세된다.

test('증여세 G1: 순수증여 5억, 직계존비속 성년', () => {
  const r = calculateGiftTax({ giftValue: 5 * 억 });
  // 과세표준 5억 − 5,000만 = 4.5억 → 4.5억×20% − 1,000만 = 8,000만 → ×97% = 7,760만
  assert.equal(r.giftTaxBase, 450000000);
  assert.equal(r.giftTax, 77600000);
  assert.equal(r.transferTax, 0);
  assert.equal(r.total, 77600000);
});

test('증여세 G2: 부담부증여 10억(채무 3억, 취득가 4억) 간편', () => {
  const r = calculateGiftTax({ giftValue: 10 * 억, assumedDebt: 3 * 억, acquisitionCost: 4 * 억 });
  // 순수증여분 7억 − 5,000만 = 6.5억 → 6.5억×30% − 6,000만 = 1.35억 → ×97% = 1억3,095만
  assert.equal(r.giftTaxBase, 650000000);
  assert.equal(r.giftTax, 130950000);
  // 대응 취득가 = 4억 × 3억/10억 = 1.2억 → 양도차익 1.8억
  assert.equal(r.transferGain, 180000000);
  // 과세표준 1.8억 − 250만 = 1억7,750만 → ×38% − 1,994만 = 4,751만 → ×110% = 5,226.1만
  assert.equal(r.transferTaxBase, 177500000);
  assert.equal(r.transferTax, 52261000);
  assert.equal(r.total, 183211000);
});

test('증여세 G3: 배우자 증여 8억 (공제 6억)', () => {
  const r = calculateGiftTax({ giftValue: 8 * 억, relation: '배우자' });
  // 2억 × 20% − 1,000만 = 3,000만 → ×97% = 2,910만
  assert.equal(r.relativeDeduction, 600000000);
  assert.equal(r.giftTax, 29100000);
});

test('증여세 G4: 미성년 직계비속 1억 (공제 2,000만)', () => {
  const r = calculateGiftTax({ giftValue: 1 * 억, isMinorRecipient: true });
  // 8,000만 × 10% = 800만 → ×97% = 776만
  assert.equal(r.relativeDeduction, 20000000);
  assert.equal(r.giftTax, 7760000);
});

test('증여세 G5: 10년 내 사전증여 2억 합산과세 (금차 3억)', () => {
  const r = calculateGiftTax({ giftValue: 3 * 억, priorGift: 2 * 억 });
  // 합산 과세표준 (3억+2억) − 5,000만 = 4.5억 → 산출 8,000만
  // 사전증여분 상당액 (2억 − 5,000만) = 1.5억 → 1.5억×20% − 1,000만 = 2,000만
  // (8,000만 − 2,000만) × 97% = 5,820만
  assert.equal(r.giftTaxBase, 450000000);
  assert.equal(r.priorGiftTax, 20000000);
  assert.equal(r.giftTax, 58200000);
});

test('증여세 G6: 기타친족 1,000만원 (공제와 동액이면 세액 0)', () => {
  const r = calculateGiftTax({ giftValue: 1000 * 만, relation: '기타친족' });
  assert.equal(r.giftTaxBase, 0);
  assert.equal(r.total, 0);
});

test('증여세 G7: 심화 — 보유 10년 장기보유특별공제 20% 적용', () => {
  const r = calculateGiftTax({ giftValue: 6 * 억, assumedDebt: 2 * 억, acquisitionCost: 2 * 억, holdingYears: 10 });
  // 증여분: 4억 − 5,000만 = 3.5억 → 3.5억×20% − 1,000만 = 6,000만 → ×97% = 5,820만
  assert.equal(r.giftTax, 58200000);
  // 양도: 대응취득가 2억×2억/6억 = 6,666.67만 → 차익 1억3,333.33만
  assert.equal(r.transferGain, 133333333);
  assert.equal(r.longTermRate, 0.2);
  // 1억3,333.33만×80% − 250만 = 1억416.67만 → ×35% − 1,544만 = 2,101.83만 → ×110%
  assert.equal(r.transferTaxBase, 104166667);
  assert.equal(r.transferTax, 23120167);
  assert.equal(r.total, 81320167);
});

test('증여세: 증여재산공제를 적용하지 않으면 공제 없이 과세된다', () => {
  // 10년 내 동일 관계에서 공제 한도를 이미 소진한 경우
  const r = calculateGiftTax({ giftValue: 5 * 억, applyRelativeDeduction: false });
  assert.equal(r.fullRelativeDeduction, 5000 * 만);   // 원래 받을 수 있었던 금액은 계속 보여준다
  assert.equal(r.relativeDeduction, 0);
  assert.equal(r.giftTaxBase, 5 * 억);
  // 5억 × 20% − 1,000만 = 9,000만 → ×97% = 8,730만
  assert.equal(r.giftTax, 87300000);
});

test('증여세: 배우자도 공제 미적용을 선택할 수 있다', () => {
  const applied = calculateGiftTax({ giftValue: 8 * 억, relation: '배우자' });
  const notApplied = calculateGiftTax({ giftValue: 8 * 억, relation: '배우자', applyRelativeDeduction: false });
  assert.equal(applied.relativeDeduction, 6 * 억);
  assert.equal(notApplied.relativeDeduction, 0);
  assert.equal(notApplied.giftTaxBase, 8 * 억);
  // 8억 × 30% − 6,000만 = 1억8,000만 → ×97% = 1억7,460만
  assert.equal(notApplied.giftTax, 174600000);
});

// ══════════════════════════ 3. 종합부동산세 ══════════════════════════
// 기본공제 1세대1주택 단독명의 12억 / 그 외 9억, 공정시장가액비율 60%
// 농어촌특별세 = 종부세액 × 20%

test('종부세 J1: 1세대1주택 공시 20억 간편', () => {
  const r = calculateComprehensiveRealEstateTax({ publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true });
  // 과세표준 (20억 − 12억) × 60% = 4.8억
  // 3억×0.5% = 150만 + 1.8억×0.7% = 126만 → 276만 / 농특세 55.2만
  assert.equal(r.taxBase, 480000000);
  assert.equal(r.calculatedTax, 2760000);
  assert.equal(r.ruralTax, 552000);
  assert.equal(r.finalTax, 3312000);
});

test('종부세 J2: 3주택 공시 30억 간편 (중과세율)', () => {
  const r = calculateComprehensiveRealEstateTax({ publicPrice: 30 * 억, numHouses: 3, isSingleHouse: false });
  // 과세표준 (30억 − 9억) × 60% = 12.6억
  // 중과는 과세표준 12억 초과분부터 갈린다 (종부세법 제9조 제1항).
  // 3억×0.5%=150만 + 3억×0.7%=210만 + 6억×1.0%=600만 + 0.6억×2.0%=120만 = 1,080만
  assert.equal(r.taxBase, 1260000000);
  assert.equal(r.calculatedTax, 10800000);
  assert.equal(r.finalTax, 12960000);           // 1,080만 + 농특세 216만
});

test('종부세 J3: 1세대1주택 공시 12억 (기본공제 경계, 세액 0)', () => {
  const r = calculateComprehensiveRealEstateTax({ publicPrice: 12 * 억, numHouses: 1, isSingleHouse: true });
  assert.equal(r.taxBase, 0);
  assert.equal(r.finalTax, 0);
});

test('종부세 J4: 심화 — 만70세·보유15년 세액공제 합계 한도 80%', () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, ownerAge: 70, holdingYears: 15,
  });
  // 고령자 40% + 장기보유 50% = 90% → 한도 80% 적용 → 276만 × 20% = 55.2만
  assert.equal(r.ageCreditRate, 0.4);
  assert.equal(r.holdingCreditRate, 0.5);
  assert.equal(r.creditRate, 0.8);
  assert.equal(r.calculatedTax, 552000);
  assert.equal(r.finalTax, 662400);
});

test('종부세 J5: 심화 — 기납부 재산세 중복분 30만원 차감', () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, ownerAge: 70, holdingYears: 15, propertyTaxPaid: 30 * 만,
  });
  // 55.2만 − 30만 = 25.2만 / 농특세 5.04만
  assert.equal(r.calculatedTax, 252000);
  assert.equal(r.finalTax, 302400);
});

test('종부세 J6: 2주택 공시 15억 간편 (일반세율)', () => {
  const r = calculateComprehensiveRealEstateTax({ publicPrice: 15 * 억, numHouses: 2, isSingleHouse: false });
  // 과세표준 (15억 − 9억) × 60% = 3.6억 → 3억×0.5% + 0.6억×0.7% = 150만 + 42만 = 192만
  assert.equal(r.taxBase, 360000000);
  assert.equal(r.calculatedTax, 1920000);
  assert.equal(r.finalTax, 2304000);
});

// ══════════════════════════ 4. 양도소득세 ══════════════════════════
// 기본공제 250만원, 지방소득세 = 산출세액 × 10%
// 장기보유특별공제 표1(일반) 2%/년 한도 30% / 표2(1세대1주택) 보유4%+거주4%, 한도 80%

test('양도세 T1: 간편 — 양도 10억, 취득 5억, 보유 10년', () => {
  const r = calculateTransferIncomeTax({ salePrice: 10 * 억, purchasePrice: 5 * 억, holdingYears: 10 });
  // 차익 5억 → 장특공제 20% → 4억 → 과세표준 4억 − 250만 = 3억9,750만
  // ×40% − 2,594만 = 1억3,306만 / 지방세 1,330.6만
  assert.equal(r.taxableGain, 500000000);
  assert.equal(r.longTermRate, 0.2);
  assert.equal(r.taxBase, 397500000);
  assert.equal(r.calculatedTax, 133060000);
  assert.equal(r.finalTax, 146366000);
});

test('양도세 T7: 고가주택 과세대상은 양도차익 × (양도가−12억)÷양도가다 (시행령 제160조 제1항)', () => {
  // 12억원 초과 판정은 **양도가액** 기준이고, 과세되는 금액은 **양도차익에 안분비율을 곱한 값**이다.
  // 자주 나오는 두 오해를 함께 배제해 산식을 고정한다.
  const r = calculateTransferIncomeTax({
    salePrice: 20 * 억, purchasePrice: 10 * 억, holdingYears: 10, livingYears: 10,
    isOneHouseExempt: true,
  });
  assert.equal(r.transferGain, 10 * 억);
  assert.equal(r.exemptRatio, 0.4);              // (20억 − 12억) ÷ 20억
  assert.equal(r.taxableGain, 4 * 억);           // 10억 × 40%
  // 오해 ① "양도가액 − 12억원"이 과세대상 → 8억이 되면 안 된다
  assert.notEqual(r.taxableGain, 8 * 억);
  // 오해 ② "양도차익 − 12억원"이 과세대상 → 음수(0)가 되면 안 된다
  assert.ok(r.taxableGain > 0);
  // 장특공제도 같은 안분 후 금액에 걸린다 — 보유40% + 거주40% = 80%
  assert.equal(r.longTermRate, 0.8);
  assert.equal(r.longTermDeduction, 3.2 * 억);   // 4억 × 80%
  // 과세표준 4억 − 3.2억 − 250만 = 7,750만 → ×24% − 576만 = 1,284만 → ×110%
  assert.equal(r.taxBase, 7750 * 만);
  assert.equal(r.finalTax, 14124000);
});

test('양도세 T8: 안분비율은 양도가액에만 좌우된다 (취득가와 무관)', () => {
  // 같은 양도가액이면 취득가가 달라도 안분비율은 같고, 과세대상 양도차익만 비례해 달라진다.
  const a = calculateTransferIncomeTax({
    salePrice: 24 * 억, purchasePrice: 12 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  const b = calculateTransferIncomeTax({
    salePrice: 24 * 억, purchasePrice: 20 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  assert.equal(a.exemptRatio, 0.5);              // (24억 − 12억) ÷ 24억
  assert.equal(b.exemptRatio, 0.5);              // 취득가가 달라도 동일
  assert.equal(a.taxableGain, 6 * 억);           // 차익 12억 × 50%
  assert.equal(b.taxableGain, 2 * 억);           // 차익 4억 × 50%
  // 양도가액이 12억원 이하로 내려가면 안분비율 0 — 전액 비과세
  const under = calculateTransferIncomeTax({
    salePrice: 12 * 억, purchasePrice: 5 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  assert.equal(under.exemptRatio, 0);
  assert.equal(under.taxableGain, 0);
  assert.equal(under.finalTax, 0);
});

test('양도세 T2: 심화 — 1세대1주택 비과세, 12억 초과분만 과세', () => {
  const r = calculateTransferIncomeTax({
    salePrice: 20 * 억, purchasePrice: 10 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  // 과세대상 비율 (20억 − 12억)/20억 = 40% → 차익 10억 × 40% = 4억
  // 표2 공제 보유 40% + 거주 40% = 80% → 4억 × 20% = 8,000만
  // 과세표준 8,000만 − 250만 = 7,750만 → ×24% − 576만 = 1,284만 / 지방세 128.4만
  assert.equal(r.exemptRatio, 0.4);
  assert.equal(r.taxableGain, 400000000);
  assert.equal(r.longTermRate, 0.8);
  assert.equal(r.taxBase, 77500000);
  assert.equal(r.finalTax, 14124000);
});

test('양도세 T3: 보유 2년은 장기보유특별공제 없음', () => {
  const r = calculateTransferIncomeTax({ salePrice: 5 * 억, purchasePrice: 3 * 억, holdingYears: 2 });
  // 차익 2억 → 공제 0 → 과세표준 1억9,750만 → ×38% − 1,994만 = 5,511만
  assert.equal(r.longTermRate, 0);
  assert.equal(r.taxBase, 197500000);
  assert.equal(r.calculatedTax, 55110000);
  assert.equal(r.finalTax, 60621000);
});

test('양도세 T4: 심화 — 3주택 중과 +30%p, 필요경비 5,000만', () => {
  const r = calculateTransferIncomeTax({
    salePrice: 10 * 억, purchasePrice: 5 * 억, expenses: 5000 * 만, holdingYears: 10, surchargeHouses: 3,
  });
  assert.equal(r.surchargeRate, 0.3);
  // 중과 대상 자산은 장특공제가 배제된다 (소득세법 제95조 제2항 단서).
  assert.equal(r.longTermExcludedBySurcharge, true);
  assert.equal(r.longTermDeduction, 0);
  // 차익 4.5억 → 장특공제 0 → 과세표준 4.5억 − 기본공제 250만 = 4억4,750만
  // 기본 ×40% − 2,594만 = 1억5,306만 + 중과 4억4,750만×30% = 1억3,425만 → 2억8,731만
  assert.equal(r.taxBase, 447500000);
  assert.equal(r.calculatedTax, 287310000);
  assert.equal(r.finalTax, 316041000);          // + 지방소득세 10%
});

test('양도세 T5: 양도차손이면 세액 0', () => {
  const r = calculateTransferIncomeTax({ salePrice: 3 * 억, purchasePrice: 5 * 억, holdingYears: 10 });
  assert.equal(r.taxableGain, 0);
  assert.equal(r.finalTax, 0);
});

test('양도세 T6: 비과세 + 양도가 12억 (경계, 과세대상 0)', () => {
  const r = calculateTransferIncomeTax({
    salePrice: 12 * 억, purchasePrice: 6 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  assert.equal(r.exemptRatio, 0);
  assert.equal(r.finalTax, 0);
});

test('양도세: 1세대1주택 비과세와 다주택 중과는 동시에 성립하지 않는다', () => {
  // 비과세는 1주택자 전제이므로 중과 입력이 함께 들어오면 중과를 배제한다.
  const r = calculateTransferIncomeTax({
    salePrice: 20 * 억, purchasePrice: 10 * 억, holdingYears: 10, livingYears: 10,
    isOneHouseExempt: true, surchargeHouses: 3,
  });
  assert.equal(r.surchargeSuppressed, true);
  assert.equal(r.surchargeHouses, 0);
  assert.equal(r.surchargeRate, 0);
  // 중과가 배제되므로 T2(중과 미지정)와 완전히 동일한 결과여야 한다
  const t2 = calculateTransferIncomeTax({
    salePrice: 20 * 억, purchasePrice: 10 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true,
  });
  assert.equal(r.finalTax, t2.finalTax);
  assert.equal(r.finalTax, 14124000);
});

test('양도세: 비과세가 아니면 중과가 정상 적용된다 (배제 규칙이 과도하지 않다)', () => {
  const r = calculateTransferIncomeTax({
    salePrice: 10 * 억, purchasePrice: 5 * 억, expenses: 5000 * 만, holdingYears: 10,
    isOneHouseExempt: false, surchargeHouses: 3,
  });
  assert.equal(r.surchargeSuppressed, false);
  assert.equal(r.surchargeRate, 0.3);
  assert.equal(r.finalTax, 316041000);
});

// ══════════════════════════ 4-B. 양도소득세 — 2026 개편안 ══════════════════════════
// 중과 한시완화: '27 2주택 5%p·3주택 10%p / '28 2주택 10%p·3주택 15%p / '29 한시완화 종료
// 장특공제액 한도: '27 없음 / '28 20억 / '29 10억
// '29 1세대1주택 장특공제: 거주기간 단일공제 8%/년, 한도 80%
// 장기거주 기본공제: 거주 10년 이상 + 양도가액 30억원 이하 → 2,500만원

test("양도세 TR1: 개편안 '27년 3주택 중과 한시완화 +10%p", () => {
  const r = calculateTransferIncomeTax({
    salePrice: 10 * 억, purchasePrice: 5 * 억, expenses: 5000 * 만, holdingYears: 10,
    surchargeHouses: 3, basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.surchargeRate, 0.10);
  // 중과율이 완화되더라도 중과 대상 자산이라는 사실은 그대로이므로 장특공제는 배제된다.
  // 개편안 자료에 이 취급에 대한 별도 언급이 없어 현행 규정(제95조 제2항 단서)을 적용한다.
  assert.equal(r.longTermExcludedBySurcharge, true);
  assert.equal(r.taxBase, 447500000);
  // ×40% − 2,594만 = 1억5,306만 + 중과 4억4,750만×10% = 4,475만 → 1억9,781만
  assert.equal(r.calculatedTax, 197810000);
  assert.equal(r.finalTax, 217591000);
});

test("양도세 TR2: 개편안 '27년 2주택 중과 한시완화 +5%p", () => {
  const r = calculateTransferIncomeTax({
    salePrice: 10 * 억, purchasePrice: 5 * 억, expenses: 5000 * 만, holdingYears: 10,
    surchargeHouses: 2, basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.surchargeRate, 0.05);
  // ×40% − 2,594만 = 1억5,306만 + 중과 4억4,750만×5% = 2,237.5만 → 1억7,543.5만
  assert.equal(r.calculatedTax, 175435000);
  assert.equal(r.finalTax, 192978500);
});

test("양도세 TR3: 개편안 '29년 거주기간 단일공제 + 장기거주 기본공제 2,500만", () => {
  const r = calculateTransferIncomeTax({
    salePrice: 20 * 억, purchasePrice: 10 * 억, holdingYears: 10, livingYears: 10,
    isOneHouseExempt: true, basis: '2026개편안', basisYear: '2029',
  });
  assert.equal(r.usesResidenceOnlyRate, true);
  assert.equal(r.longTermRate, 0.8);            // 거주 10년 × 8%
  assert.equal(r.taxableGain, 400000000);
  assert.equal(r.longTermDeduction, 320000000); // 4억 × 80%
  assert.equal(r.hasLongResidenceDeduction, true);
  assert.equal(r.basicDeduction, 25000000);
  // 과세표준 4억 − 3.2억 − 2,500만 = 5,500만 → ×24% − 576만 = 744만
  assert.equal(r.taxBase, 55000000);
  assert.equal(r.finalTax, 8184000);
});

test("양도세 TR4: 개편안 '29년 장특공제 한도 10억 적용, 양도가 30억 초과로 기본공제 확대 배제", () => {
  const r = calculateTransferIncomeTax({
    salePrice: 100 * 억, purchasePrice: 20 * 억, holdingYears: 10, livingYears: 10,
    isOneHouseExempt: true, basis: '2026개편안', basisYear: '2029',
  });
  assert.equal(r.taxableGain, 7040000000);      // 차익 80억 × 과세대상 88%
  assert.equal(r.longTermDeduction, 10 * 억);   // 56.32억 → 한도 10억
  assert.equal(r.isLongTermCapped, true);
  assert.equal(r.hasLongResidenceDeduction, false);
  assert.equal(r.basicDeduction, 250 * 만);
  assert.equal(r.taxBase, 6037500000);
  assert.equal(r.finalTax, 2916028500);
});

test("양도세 TR5: 개편안 '28년은 한도 20억, 공제율은 첨부 자료 미수록으로 현행 적용", () => {
  const r = calculateTransferIncomeTax({
    salePrice: 100 * 억, purchasePrice: 20 * 억, holdingYears: 10, livingYears: 10,
    isOneHouseExempt: true, basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.usesResidenceOnlyRate, false);
  assert.equal(r.longTermRateFromCurrent, true);
  assert.equal(r.longTermRate, 0.8);            // 현행 표2 보유40% + 거주40%
  assert.equal(r.longTermDeduction, 20 * 억);
  assert.equal(r.taxBase, 5037500000);
  assert.equal(r.finalTax, 2421028500);
});

// ══════════════════════════ 3-B. 종합부동산세 — 2026 개편안 ══════════════════════════
// 기본공제: 1주택 거주 14억 / 1주택 비거주 12억 / 그 외 4억 + 5억 × 거주비중
//   거주비중 = 거주주택 공시가격 ÷ 주택 공시가격 합계.
//   개편안 자료 「③ 적용 사례」(2주택 1채 거주 = 4억 + 5억 × 1/2 = 6.5억,
//   3주택 1채 거주 = 4억 + 5억 × 1/3 ≒ 5.7억)는 채마다 공시가격이 같은 예라
//   주택 수로 읽어도 같은 값이 나온다 — 그 사례만으로는 기준이 가려지지 않는다.
//   기준이 갈리는 것은 채마다 가격이 다를 때이고, JR12 가 그 경우를 고정한다.
// 공정시장가액비율: '27 70% / '28 80%(3주택 이상·조정지역, 1세대1주택 제외), 그 외 70%
// 세액공제 금액 한도: '27 800만원 / '28 600만원
//
// 세율 (개편안 §(5) 종부법 제9조 제1항·제2항) — 아래 기대값은 이 표에서 손으로 전개했다.
//   '27년 2주택 이하 : 0.5 / 0.7 / 1.3 / 1.5 / 2.0 / 2.7 / 3.5 %
//   '27년 3주택 이상 : 0.5 / 0.7 / 1.3 / 2.0 / 3.0 / 4.0 / 5.0 %
//   '28년 이후(일원화): 0.5 / 0.7 / 1.3 / 2.0 / 3.0 / 4.0 / 5.0 %  ← 주택수 차등 폐지
//   구간 경계는 현행과 같다 (3 / 6 / 12 / 25 / 50 / 94억)
//
// 세액공제 (개편안 §(6) 종부법 제9조 제5항·제8항·제9항)
//   거주공제 : 5~10년 20% / 10~15년 40% / 15년 이상 50%
//   보유공제 : 거주공제의 1/2 — 10% / 20% / 25%
//   '27년   : 보유공제와 거주공제 중 높은 공제율
//   '28년 이후: 거주공제만

test("종부세 JR1: 개편안 '27년 1세대1주택 거주 — 기본공제 14억, FMV 70%", () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.basicDeduction, 14 * 억);
  assert.equal(r.fairMarketRatio, 0.7);
  assert.equal(r.taxBase, 420000000);           // (20억 − 14억) × 70%
  // 3억×0.5% = 150만 + 1.2억×0.7% = 84만 → 234만
  assert.equal(r.grossTax, 2340000);
  assert.equal(r.finalTax, 2808000);
  // 6억 이하 구간(0.5%·0.7%)은 개편안에서도 현행과 같아 세액이 변하지 않는다.
});

test("종부세 JR2: 개편안 '28년 3주택 조정대상지역 — FMV 80%, 기본공제 4억", () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 30 * 억, numHouses: 3, isSingleHouse: false, residentRatio: 0,
    isAdjustedArea: true, basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.basicDeduction, 4 * 억);
  assert.equal(r.usesHeavyRatio, true);
  assert.equal(r.fairMarketRatio, 0.8);
  assert.equal(r.taxBase, 2080000000);          // (30억 − 4억) × 80%
  // '28년 일원화표: 3억×0.5% + 3억×0.7% + 6억×1.3% + 8.8억×2.0%
  //               = 150 + 210 + 780 + 1,760만 = 2,900만
  assert.equal(r.grossTax, 29000000);
  assert.equal(r.finalTax, 34800000);           // 2,900만 + 농특세 580만
});

test("종부세 JR3: 개편안 '27년 1세대1주택 비거주 — 기본공제 12억으로 축소", () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, isResident: false,
    basis: '2026개편안', basisYear: '2027',
  });
  // 자료 「③ 적용 사례」 — 1세대1주택자 특례: 거주시 14억, 비거주시 12억.
  assert.equal(r.basicDeduction, 12 * 억);
  assert.equal(r.taxBase, 560000000);           // (20억 − 12억) × 70%
  // '27년 2주택 이하: 3억×0.5% + 2.6억×0.7% = 150+182만 = 332만
  assert.equal(r.grossTax, 3320000);
  assert.equal(r.finalTax, 3984000);            // 332만 + 농특세 66.4만
});

test("종부세 JR4: 개편안 — 세액공제 기준이 보유기간에서 거주기간으로 전환", () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
    ownerAge: 70, livingYears: 15, holdingYears: 0,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.creditBasisYears, 15);         // 보유 0년이어도 거주 15년으로 판정
  assert.equal(r.holdingCreditRate, 0.5);
  assert.equal(r.creditRate, 0.8);              // 40% + 50% → 한도 80%
  assert.equal(r.creditAmount, 1872000);        // 234만 × 80%
  assert.equal(r.isCreditCapped, false);        // 한도 800만원 미달
  assert.equal(r.calculatedTax, 468000);
  assert.equal(r.finalTax, 561600);
});

test('종부세 JR5: 개편안 다주택 기본공제 = 4억 + 5억 × 거주비중', () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 2, isSingleHouse: false, residentRatio: 60,
    isAdjustedArea: false, basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.basicDeduction, 7 * 억);       // 4억 + 5억 × 60%
  assert.equal(r.usesHeavyRatio, false);        // 3주택 미만·비조정 → 70%
  assert.equal(r.fairMarketRatio, 0.7);
  assert.equal(r.taxBase, 910000000);           // (20억 − 7억) × 70%
  // '28년 일원화표: 3억×0.5% + 3억×0.7% + 3.1억×1.3% = 150+210+403만 = 763만
  assert.equal(r.grossTax, 7630000);
  assert.equal(r.finalTax, 9156000);            // 763만 + 농특세 152.6만
});

test("종부세 JR6: 개편안 '28년 세액공제 금액 한도 600만원이 적용된다", () => {
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 80 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
    ownerAge: 70, livingYears: 15, basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.taxBase, 4620000000);          // (80억 − 14억) × 70%
  // '28년 일원화표: 3억×0.5% + 3억×0.7% + 6억×1.3% + 13억×2.0% + 21.2억×3.0%
  //               = 150 + 210 + 780 + 2,600 + 6,360만 = 1억 100만
  assert.equal(r.grossTax, 101000000);
  assert.equal(r.creditRate, 0.8);              // 공제율로는 8,080만이나
  assert.equal(r.creditAmount, 6000000);        // 금액 한도 600만원으로 절하
  assert.equal(r.isCreditCapped, true);
  assert.equal(r.calculatedTax, 95000000);
  assert.equal(r.finalTax, 114000000);          // 9,500만 + 농특세 1,900만
});

test("종부세 JR7: 개편안 '27년은 보유공제(거주공제의 1/2)와 거주공제 중 높은 쪽을 쓴다", () => {
  // 보유 15년·거주 0년 — 거주공제만 보면 0%지만, '27년은 보유공제 25%가 살아 있다.
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
    ownerAge: 0, holdingYears: 15, livingYears: 0,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.grossTax, 2340000);            // 과세표준 4.2억 → 150+84만
  assert.equal(r.holdingCreditRate, 0.25);      // 거주공제 50%의 1/2
  assert.equal(r.creditFromHoldingYears, true); // 보유공제가 이겼으므로 화면도 「보유기간」으로 적어야 한다
  assert.equal(r.creditBasisYears, 15);
  assert.equal(r.creditRate, 0.25);             // 연령공제 없음
  assert.equal(r.creditAmount, 585000);         // 234만 × 25%
  assert.equal(r.calculatedTax, 1755000);
  assert.equal(r.finalTax, 2106000);            // 175.5만 + 농특세 35.1만
});

test("종부세 JR8: 개편안 '28년 이후는 거주공제만 적용해 보유기간이 소용없다", () => {
  // JR7과 같은 입력. 연도만 '28로 바꾸면 보유 15년이 공제로 이어지지 않는다.
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
    ownerAge: 0, holdingYears: 15, livingYears: 0,
    basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.grossTax, 2340000);
  assert.equal(r.holdingCreditRate, 0);         // 거주 0년 → 공제 없음
  assert.equal(r.creditFromHoldingYears, false); // '28년 이후는 언제나 거주기간 기준
  assert.equal(r.creditAmount, 0);
  assert.equal(r.finalTax, 2808000);            // JR1과 같아진다
});

// 개편안 자료 「③ 적용 사례」를 그대로 옮긴 대조표.
// 공시가격이 채마다 같은 사례라 공시가격 비중으로 계산해도 우연히 같은 값이 나온다.
// 그래서 값이 갈리는 사례(JR11)를 따로 둔다 — 여기서 두 해석이 갈린다.
test('종부세 JR9: 자료 적용 사례 — 2주택자(각 10억) 중 1채 거주 → 공제 6.5억', () => {
  // 거주주택 10억 ÷ 합계 20억 = 50%
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 2, isSingleHouse: false, residentRatio: 50,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.basicDeduction, 6.5 * 억);     // 4억 + (5억 × 1/2)
});

test('종부세 JR10: 자료 적용 사례 — 소유 주택에 거주하지 않으면 공제 4억', () => {
  const r2 = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 2, isSingleHouse: false, residentRatio: 0,
    basis: '2026개편안', basisYear: '2027',
  });
  const r3 = calculateComprehensiveRealEstateTax({
    publicPrice: 30 * 억, numHouses: 3, isSingleHouse: false, residentRatio: 0,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r2.basicDeduction, 4 * 억);
  assert.equal(r3.basicDeduction, 4 * 억);
});

test('종부세 JR11: 자료 적용 사례 — 3주택자(각 10억) 중 1채 거주 → 공제 약 5.7억', () => {
  // 거주주택 10억 ÷ 합계 30억 = 1/3
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 30 * 억, numHouses: 3, isSingleHouse: false, residentRatio: 100 / 3,
    basis: '2026개편안', basisYear: '2027',
  });
  // 4억 + (5억 × 1/3) = 5억 6,666만 6,667원. 자료 표기는 「약 5.7억원」이다.
  assert.equal(Math.round(r.basicDeduction), 566666667);
});

test('종부세 JR12: 거주비중은 주택 수가 아니라 공시가격으로 본다', () => {
  // 거주 주택 5억 + 비거주 주택 15억 = 합계 20억, 2주택 중 1채 거주.
  // 공시가격 기준 → 4억 + 5억 × (5억/20억) = 5.25억
  // 주택 수 기준이었다면 → 4억 + 5억 × 1/2 = 6.5억 이 되어 1.25억 차이가 난다.
  //
  // 개편안 자료의 적용 사례는 채마다 가격이 같아 두 기준이 같은 값을 낸다.
  // 기준을 가리는 것은 이 사례뿐이므로, 소유자 판단(공시가격 기준)을 여기에 고정해 둔다.
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 20 * 억, numHouses: 2, isSingleHouse: false, residentRatio: 25,
    basis: '2026개편안', basisYear: '2027',
  });
  assert.equal(r.basicDeduction, 5.25 * 억);
  assert.notEqual(r.basicDeduction, 6.5 * 억);
});

test('종부세 JR13: 세부담상한은 개편안에서도 현행과 같은 150%다', () => {
  // 자료: 당초 정부안 200% → 150% 로 수정. 현행과 같아졌다.
  // 이 도구는 직전연도 재산세·종부세를 입력받지 않아 상한 적용 자체를 계산하지 않는다.
  assert.equal(JONGBU_BURDEN_CAP_RATE, 1.5);
  const r = calculateComprehensiveRealEstateTax({
    publicPrice: 30 * 억, numHouses: 1, isSingleHouse: true,
    basis: '2026개편안', basisYear: '2028',
  });
  assert.equal(r.burdenCapRate, 1.5);
  assert.equal(r.burdenCapNotApplied, true);
});

// ══════════════════════════ 5. 가업승계 ══════════════════════════
// 현행 공제한도: 경영 10년 300억 / 20년 400억 / 30년 600억
// 2026 개편안(입법 확정 전): 경영 30년 이상 요건, 경영연수 × 20억, 최대 1,000억

test('가업승계 S1: 현행 경영 15년, 가업 200억, 총상속 250억', () => {
  const r = calculateBusinessSuccession({ businessValue: 200 * 억, managementYears: 15, totalEstate: 250 * 억 });
  assert.equal(r.deductionCap, 300 * 억);
  assert.equal(r.deduction, 200 * 억);
  // 공제 전 과세표준 245억 → 245억×50% − 4.6억 = 117.9억 → ×97% = 114.363억
  assert.equal(r.taxWithout, 11436300000);
  // 공제 후 과세표준 45억 → 45억×50% − 4.6억 = 17.9억 → ×97% = 17.363억
  assert.equal(r.taxWith, 1736300000);
  assert.equal(r.saving, 9700000000);
  assert.equal(r.total, 1736300000);
});

test('가업승계 S2: 현행 경영 8년은 요건 미충족으로 공제 불가', () => {
  const r = calculateBusinessSuccession({ businessValue: 50 * 억, managementYears: 8, totalEstate: 60 * 억 });
  assert.equal(r.deductionCap, 0);
  assert.equal(r.deduction, 0);
  // 과세표준 55억 → 55억×50% − 4.6억 = 22.9억 → ×97% = 22.213억
  assert.equal(r.taxWith, 2221300000);
  assert.equal(r.saving, 0);
});

test('가업승계 S3: 2026 개편안 경영 35년 → 한도 700억', () => {
  const r = calculateBusinessSuccession({
    businessValue: 800 * 억, managementYears: 35, totalEstate: 900 * 억, basis: '2026개편안',
  });
  assert.equal(r.deductionCap, 700 * 억);
  assert.equal(r.deduction, 700 * 억);
  // 895억 → ×50% − 4.6억 = 442.9억 → ×97% = 429.613억
  assert.equal(r.taxWithout, 42961300000);
  // 195억 → ×50% − 4.6억 = 92.9억 → ×97% = 90.113억
  assert.equal(r.taxWith, 9011300000);
  assert.equal(r.saving, 33950000000);
});

test('가업승계 S4: 2026 개편안 경영 25년 → 한도 500억, 사후관리 연장 전제', () => {
  const r = calculateBusinessSuccession({ businessValue: 300 * 억, managementYears: 25, basis: '2026개편안' });
  // 개편안은 30년 이상이 원칙이나 20년 이상이면 사후관리기간 연장을 전제로 공제를 허용한다.
  assert.equal(r.deductionCap, 500 * 억);     // 25년 × 20억
  assert.equal(r.deduction, 300 * 억);        // min(가업 300억, 한도 500억)
  assert.equal(r.needsExtendedFollowUp, true);
  // totalEstate 미지정 시 가업자산가액을 총상속재산으로 본다 → 공제 전 295억
  assert.equal(r.taxWithout, 13861300000);
  // 공제 후 과세표준 max(0, 300억 − 5억 − 300억) = 0
  assert.equal(r.taxWith, 0);
  assert.equal(r.saving, 13861300000);
});

test('가업승계 S7: 2026 개편안 경영 19년은 요건 미충족으로 공제 0', () => {
  const r = calculateBusinessSuccession({ businessValue: 300 * 억, managementYears: 19, basis: '2026개편안' });
  assert.equal(r.deductionCap, 0);
  assert.equal(r.needsExtendedFollowUp, false);
  assert.equal(r.taxWith, 13861300000);
  assert.equal(r.saving, 0);
});

test('가업승계 S8: 2026 개편안 경영 30년 이상은 사후관리 연장 전제가 붙지 않는다', () => {
  const r = calculateBusinessSuccession({ businessValue: 800 * 억, managementYears: 35, totalEstate: 900 * 억, basis: '2026개편안' });
  assert.equal(r.needsExtendedFollowUp, false);
  assert.equal(r.deductionCap, 700 * 억);
});

test('가업승계 S5: 현행 경영 30년 → 한도 600억', () => {
  const r = calculateBusinessSuccession({ businessValue: 700 * 억, managementYears: 30, totalEstate: 800 * 억 });
  assert.equal(r.deductionCap, 600 * 억);
  assert.equal(r.taxWithout, 38111300000);
  assert.equal(r.taxWith, 9011300000);
  assert.equal(r.saving, 29100000000);
});

test('가업승계 S6: 증여세 과세특례 경로 (조특법 제30조의6)', () => {
  const r = calculateBusinessSuccession({ businessValue: 200 * 억, managementYears: 15, route: '증여세과세특례' });
  // 과세가액 min(200억, 한도 300억) − 10억 = 190억
  // 120억×10% = 12억 + 70억×20% = 14억 → 26억 → ×97% = 25.22억
  assert.equal(r.specialTaxBase, 19000000000);
  assert.equal(r.specialTax, 2522000000);
  assert.equal(r.total, 2522000000);
});

// ── 가업승계 토지 공제 축소 (2026 개편안 §3.4(1)) ──
// 공제대상 토지가액 = min(토지면적, 바닥면적 × 배율) × min(㎡당 평가액, 1,000만원)
// 배율: 수도권(인구감소지역 제외) 2배 / 그 외 3배

test('가업승계 SL1: 개편안 수도권 2배 — 개편안 자료의 적용 예시와 일치', () => {
  // 문서 예시: ㎡당 1,500만원, 바닥면적 1,000㎡, 토지면적 4,000㎡, 35년 경영
  //   현행 공제가능 4,000㎡·600억원 → 개정 공제가능 2,000㎡·200억원
  const r = calculateBusinessSuccession({
    businessValue: 800 * 억, managementYears: 35, totalEstate: 900 * 억, basis: '2026개편안',
    landUnitPrice: 1500 * 만, landArea: 4000, floorArea: 1000, isMetroArea: true,
  });
  assert.equal(r.landMultiple, 2);
  assert.equal(r.landValueBefore, 600 * 억);    // 4,000㎡ × 1,500만원
  assert.equal(r.landValueAfter, 200 * 억);     // min(4,000, 2,000)㎡ × min(1,500만, 1,000만)
  assert.equal(r.isLandReduced, true);
  assert.equal(r.adjustedBusinessValue, 400 * 억); // 800억 − 600억 + 200억
  assert.equal(r.deduction, 400 * 억);          // min(400억, 한도 700억)
  // 공제 후 과세표준 895억 − 400억 = 495억 → ×50% − 4.6억 = 242.9억 → ×97%
  assert.equal(r.taxWith, 23561300000);
  assert.equal(r.saving, 19400000000);
});

test('가업승계 SL2: 개편안 그 외 지역은 배율 3배', () => {
  const r = calculateBusinessSuccession({
    businessValue: 800 * 억, managementYears: 35, totalEstate: 900 * 억, basis: '2026개편안',
    landUnitPrice: 1500 * 만, landArea: 4000, floorArea: 1000, isMetroArea: false,
  });
  assert.equal(r.landMultiple, 3);
  assert.equal(r.landValueAfter, 300 * 억);     // min(4,000, 3,000)㎡ × 1,000만원
  assert.equal(r.adjustedBusinessValue, 500 * 억);
  // 895억 − 500억 = 395억 → ×50% − 4.6억 = 192.9억 → ×97%
  assert.equal(r.taxWith, 18711300000);
});

test('가업승계 SL3: 현행 기준에서는 토지 입력을 반영하지 않는다', () => {
  const r = calculateBusinessSuccession({
    businessValue: 800 * 억, managementYears: 35, totalEstate: 900 * 억,
    landUnitPrice: 1500 * 만, landArea: 4000, floorArea: 1000, isMetroArea: true,
  });
  assert.equal(r.isLandReduced, false);
  assert.equal(r.adjustedBusinessValue, 800 * 억);
  assert.equal(r.deduction, 600 * 억);          // 현행 한도 600억
  assert.equal(r.taxWith, 13861300000);
});

test('가업승계 SL4: 개편안 과세특례 경로 + 토지 축소 (경영 22년)', () => {
  const r = calculateBusinessSuccession({
    businessValue: 500 * 억, managementYears: 22, totalEstate: 600 * 억,
    basis: '2026개편안', route: '증여세과세특례',
    landUnitPrice: 1500 * 만, landArea: 2000, floorArea: 500, isMetroArea: true,
  });
  assert.equal(r.landValueBefore, 300 * 억);    // 2,000㎡ × 1,500만원
  assert.equal(r.landValueAfter, 100 * 억);     // min(2,000, 1,000)㎡ × 1,000만원
  assert.equal(r.adjustedBusinessValue, 300 * 억);
  assert.equal(r.deduction, 300 * 억);          // min(300억, 한도 440억)
  assert.equal(r.specialMinYears, 20);
  assert.equal(r.meetsSpecialRequirement, true);
  // 과세표준 300억 − 10억 = 290억 → 120억×10% + 170억×20% = 46억 → ×97%
  assert.equal(r.specialTaxBase, 290 * 억);
  assert.equal(r.specialTax, 4462000000);
  assert.equal(r.total, 4462000000);
  assert.equal(r.needsExtendedFollowUp, false); // 과세특례 경로에는 붙지 않는다
});

test('가업승계 SL5: 개편안 과세특례는 부모 경영 20년 미만이면 요건 미충족', () => {
  const r = calculateBusinessSuccession({
    businessValue: 200 * 억, managementYears: 15, basis: '2026개편안', route: '증여세과세특례',
  });
  assert.equal(r.specialMinYears, 20);
  assert.equal(r.meetsSpecialRequirement, false);
  assert.equal(r.specialTax, 0);
});

test('가업승계 SL6: 현행 과세특례는 부모 경영 10년 이상이면 충족', () => {
  const r = calculateBusinessSuccession({
    businessValue: 200 * 억, managementYears: 15, route: '증여세과세특례',
  });
  assert.equal(r.specialMinYears, 10);
  assert.equal(r.meetsSpecialRequirement, true);
  assert.equal(r.specialTax, 2522000000);
});

test('가업승계 SG1: 과세특례의 절감효과는 일반 증여세와의 차액이다', () => {
  // 검토 지분 30억, 경영 15년, 사업무관자산 없음 → 공제대상 가업재산 30억
  const r = calculateBusinessSuccession({
    businessValue: 30 * 억, managementYears: 15, route: '증여세과세특례',
  });
  assert.equal(r.meetsSpecialRequirement, true);
  // 특례: 과세표준 30억 − 10억 = 20억 → ×10% = 2억 → ×97% = 1.94억
  assert.equal(r.specialTaxBase, 20 * 억);
  assert.equal(r.specialGrossTax, 2 * 억);
  assert.equal(r.specialTax, 194000000);
  // 일반 증여세: 과세표준 30억 − 5,000만 = 29.5억 → 30억 이하 40% 구간, 누진공제 1.6억
  //   29.5억 × 40% − 1.6억 = 11.8억 − 1.6억 = 10.2억 → ×97% = 9.894억
  assert.equal(r.normalGiftDeduction, 5000 * 만);
  assert.equal(r.normalGiftTaxBase, 29.5 * 억);
  assert.equal(r.normalGiftTax, 989400000);
  // 절감 효과 = 9.894억 − 1.94억 = 7.954억
  assert.equal(r.specialSaving, 795400000);
  assert.equal(r.total, r.specialTax);
});

test('가업승계 SG2: 요건 미충족이면 특례 세액도 절감효과도 없다', () => {
  const r = calculateBusinessSuccession({
    businessValue: 30 * 억, managementYears: 8, route: '증여세과세특례',
  });
  assert.equal(r.meetsSpecialRequirement, false);   // 현행 요건 10년 미만
  assert.equal(r.specialTax, 0);
  assert.equal(r.specialSaving, 0);
  // 비교용 일반 증여세는 요건과 무관하게 계산된다
  assert.equal(r.normalGiftTax, 989400000);
});

test('가업승계 SG3: 사업무관자산 제외분은 일반 증여세 비교에도 반영된다', () => {
  const full = calculateBusinessSuccession({
    businessValue: 30 * 억, managementYears: 15, route: '증여세과세특례',
  });
  const part = calculateBusinessSuccession({
    businessValue: 30 * 억, managementYears: 15, route: '증여세과세특례', unrelatedAssetRate: 0.5,
  });
  assert.equal(part.qualifiedValue, 15 * 억);
  // 일반 증여세도 공제대상 가업재산(15억) 기준으로 계산된다
  // 과세표준 15억 − 5,000만 = 14.5억 → 30억 이하 40%, 누진공제 1.6억
  //   14.5억 × 40% − 1.6억 = 5.8억 − 1.6억 = 4.2억 → ×97% = 4.074억
  assert.equal(part.normalGiftTaxBase, 14.5 * 억);
  assert.equal(part.normalGiftTax, 407400000);
  assert.ok(part.normalGiftTax < full.normalGiftTax);
  assert.ok(part.specialSaving < full.specialSaving);
});

test('가업승계 SU1: 사업무관자산은 공제대상 가업재산에서 빠진다 (상증령 제15조 제5항)', () => {
  const r = calculateBusinessSuccession({
    businessValue: 200 * 억, managementYears: 15, totalEstate: 250 * 억,
    otherDeduction: 5 * 억, unrelatedAssetRate: 0.2,
  });
  assert.equal(r.unrelatedAssetValue, 40 * 억);   // 200억 × 20%
  assert.equal(r.qualifiedValue, 160 * 억);       // 200억 × (1 − 20%)
  assert.equal(r.deductionCap, 300 * 억);         // 현행 경영 15년
  assert.equal(r.deduction, 160 * 억);            // min(공제대상 가업재산, 한도)
  // 공제 미적용: 과세표준 245억 → 30억 초과 50% → ×50% − 4.6억 = 117.9억 → ×97%
  assert.equal(r.taxWithout, 11436300000);
  // 공제 적용: 과세표준 85억 → ×50% − 4.6억 = 37.9억 → ×97%
  assert.equal(r.taxWith, 3676300000);
  assert.equal(r.saving, 7760000000);
});

test('가업승계 SU2: 사업무관자산 비율 100%면 공제할 가업재산이 없다', () => {
  const r = calculateBusinessSuccession({
    businessValue: 200 * 억, managementYears: 30, totalEstate: 250 * 억,
    otherDeduction: 5 * 억, unrelatedAssetRate: 1,
  });
  assert.equal(r.qualifiedValue, 0);
  assert.equal(r.deductionCap, 600 * 억);         // 한도는 있으나 공제할 재산이 없다
  assert.equal(r.deduction, 0);
  assert.equal(r.taxWith, r.taxWithout);
  assert.equal(r.saving, 0);
});

test('가업승계 SU3: 사업무관자산 제외는 증여세 과세특례 과세표준에도 반영된다', () => {
  const r = calculateBusinessSuccession({
    businessValue: 200 * 억, managementYears: 15, route: '증여세과세특례',
    unrelatedAssetRate: 0.2,
  });
  // 과세표준 = 160억 − 10억 = 150억
  assert.equal(r.specialTaxBase, 150 * 억);
  // 120억×10% + 30억×20% = 12억 + 6억 = 18억 → ×97% = 17.46억
  assert.equal(r.specialTax, 1746000000);
  // 비율 0%인 SL6(2,522,000,000)보다 세액이 작다
  assert.ok(r.specialTax < 2522000000);
});

// ══════════════════════════ 6. 비상장주식 평가 ══════════════════════════
// 순손익가치 = 1주당 순손익액 ÷ 10%, 가중평균 순손익3:순자산2 (부동산과다법인 2:3)
// 순자산가치의 80%를 하한으로 하고, 최대주주는 20% 할증

test('비상장주식 K1: 순자산 100억 / 순손익 10억 / 10만주, 최대주주 할증', () => {
  const r = calculateUnlistedStockValue({ netAsset: 100 * 억, weightedIncome: 10 * 억, totalShares: 100000 });
  assert.equal(r.netAssetPerShare, 100000);   // 100억 ÷ 10만주
  assert.equal(r.incomePerShare, 100000);     // (10억 ÷ 10만주) ÷ 10%
  assert.equal(r.weightedValue, 100000);      // (10만×3 + 10만×2) ÷ 5
  assert.equal(r.pricePerShare, 120000);      // × 1.2
  assert.equal(r.totalValue, 12000000000);
});

test('비상장주식 K2: 순손익이 낮으면 순자산가치 80% 하한이 적용된다', () => {
  const r = calculateUnlistedStockValue({ netAsset: 100 * 억, weightedIncome: 1 * 억, totalShares: 100000 });
  assert.equal(r.incomePerShare, 10000);      // (1억 ÷ 10만주) ÷ 10%
  assert.equal(r.weightedValue, 46000);       // (1만×3 + 10만×2) ÷ 5
  assert.equal(r.floorValue, 80000);          // 10만 × 80%
  assert.equal(r.valuePerShare, 80000);       // 하한 적용
  assert.equal(r.pricePerShare, 96000);
  assert.equal(r.totalValue, 9600000000);
});

test('비상장주식 K3: 심화 — 부동산 과다보유 법인은 순손익2:순자산3, 할증 없음', () => {
  const r = calculateUnlistedStockValue({
    netAsset: 100 * 억, weightedIncome: 10 * 억, totalShares: 100000,
    isRealtyHeavy: true, hasMaxShareholderPremium: false,
  });
  assert.equal(r.weightedValue, 100000);      // (10만×2 + 10만×3) ÷ 5
  assert.equal(r.premiumRate, 1);
  assert.equal(r.pricePerShare, 100000);
  assert.equal(r.totalValue, 10000000000);
});

test('비상장주식 K4: 평가 대상은 발행주식 전체다 (법인 주식 총가액)', () => {
  // 이 세목의 산출물은 1주당 평가액이고, 총액은 발행주식 전체 기준이다.
  // 개인별 보유분 가액은 1주당 평가액 × 보유주식수로 상속세·증여세 항목에서 다룬다.
  const r = calculateUnlistedStockValue({
    netAsset: 100 * 억, weightedIncome: 10 * 억, totalShares: 100000,
  });
  assert.equal(r.totalShares, 100000);
  assert.equal(r.pricePerShare, 120000);
  assert.equal(r.totalValue, 12000000000);    // 12만 × 10만주
  // 주식수가 배로 늘면 1주당 가액은 반이 되고 총액은 같다
  const half = calculateUnlistedStockValue({
    netAsset: 100 * 억, weightedIncome: 10 * 억, totalShares: 200000,
  });
  assert.equal(half.pricePerShare, 60000);
  assert.equal(half.totalValue, 12000000000);
});

test('비상장주식 K5: 순손익 0(결손) — 하한이 평가액을 결정한다', () => {
  const r = calculateUnlistedStockValue({ netAsset: 50 * 억, weightedIncome: 0, totalShares: 10000 });
  assert.equal(r.netAssetPerShare, 500000);
  assert.equal(r.weightedValue, 200000);      // (0×3 + 50만×2) ÷ 5
  assert.equal(r.valuePerShare, 400000);      // 하한 50만 × 80%
  assert.equal(r.totalValue, 4800000000);     // 48만 × 1만주
});

test('비상장주식 K6: 최근 3년 순손익액의 가중평균 (상증령 제56조 — 3:2:1 ÷ 6)', () => {
  // (6억×3 + 3억×2 + 3억×1) ÷ 6 = (18 + 6 + 3)억 ÷ 6 = 27억 ÷ 6 = 4.5억
  assert.equal(calculateWeightedNetIncome([6 * 억, 3 * 억, 3 * 억]), 4.5 * 억);
  // 3년 모두 같으면 그 값 자체가 가중평균이다
  assert.equal(calculateWeightedNetIncome([2 * 억, 2 * 억, 2 * 억]), 2 * 억);
  // 최근 연도 가중치가 3이므로 최근 실적이 좋아지면 가중평균이 오른다
  // (12억×3 + 0 + 0) ÷ 6 = 6억
  assert.equal(calculateWeightedNetIncome([12 * 억, 0, 0]), 6 * 억);
  // 결측 연도는 0으로 본다 — (6억×3) ÷ 6 = 3억
  assert.equal(calculateWeightedNetIncome([6 * 억]), 3 * 억);
});

test('비상장주식 K7: 순자산가치 단독평가는 가중평균도 80% 하한도 쓰지 않는다', () => {
  // 상증령 제54조 제4항 — 사업개시 3년 미만·휴폐업·청산 중·부동산등 80% 이상
  const r = calculateUnlistedStockValue({
    netAsset: 100 * 억, weightedIncome: 10 * 억, totalShares: 100000, netAssetOnly: true,
  });
  assert.equal(r.netAssetPerShare, 100000);   // 100억 ÷ 10만주
  assert.equal(r.valuePerShare, 100000);      // 순자산가치 그대로
  assert.equal(r.isFloorApplied, false);      // 하한 개념이 적용되지 않는다
  assert.equal(r.pricePerShare, 120000);      // × 1.2 (최대주주 할증)
  assert.equal(r.totalValue, 12000000000);
});

test('비상장주식 K8: 단독평가는 순손익이 커도 순자산가치를 넘지 않는다', () => {
  // 가중평균을 썼다면 (100만×3 + 10만×2) ÷ 5 = 64만이 되지만, 단독평가는 10만이다.
  const base = { netAsset: 100 * 억, weightedIncome: 100 * 억, totalShares: 100000, hasMaxShareholderPremium: false };
  const weighted = calculateUnlistedStockValue(base);
  const only = calculateUnlistedStockValue(Object.assign({}, base, { netAssetOnly: true }));
  assert.equal(weighted.valuePerShare, 640000);
  assert.equal(only.valuePerShare, 100000);
});

// ══════════════════════════ 7. 급여 및 배당 ══════════════════════════
// 근로소득세 = (총급여 − 근로소득공제 − 본인 기본공제 150만) × 누진세율
//              − 근로소득세액공제, 지방소득세 10% 가산
// 배당소득세 = 2,000만원까지 15.4% 분리과세 + 초과분은 급여 과세표준에 얹은 증분
//              (비교과세 하한 15.4%)

test('근로소득공제: 구간 경계와 2,000만원 한도 (소득세법 제47조)', () => {
  assert.equal(calculateEarnedIncomeDeduction(500 * 만), 350 * 만);      // 500만 × 70%
  assert.equal(calculateEarnedIncomeDeduction(1500 * 만), 750 * 만);     // 350만 + 1,000만×40%
  assert.equal(calculateEarnedIncomeDeduction(4500 * 만), 1200 * 만);    // 750만 + 3,000만×15%
  assert.equal(calculateEarnedIncomeDeduction(10000 * 만), 1475 * 만);   // 1,200만 + 5,500만×5%
  // 1억 초과분은 2%씩 — 1,475만 + 2억6,250만×2% = 2,000만 (한도 도달점)
  assert.equal(calculateEarnedIncomeDeduction(36250 * 만), 2000 * 만);
  assert.equal(calculateEarnedIncomeDeduction(5 * 억), 2000 * 만);       // 한도로 절단
});

test('근로소득세액공제: 공제율과 총급여 구간별 한도 (소득세법 제59조)', () => {
  // 산출세액 130만원 이하는 55%
  assert.equal(calculateEarnedIncomeTaxCredit(130 * 만, 3000 * 만), 71.5 * 만);
  // 130만 초과분은 30% — 71.5만 + 370만×30% = 182.5만이나 3,300만 이하 한도 74만
  assert.equal(calculateEarnedIncomeTaxCredit(500 * 만, 3000 * 만), 74 * 만);
  // 3,300만~7,000만: 74만 − (5,000만−3,300만)×0.8% = 60.4만 → 최소 66만
  assert.equal(calculateEarnedIncomeTaxCredit(500 * 만, 5000 * 만), 66 * 만);
  // 7,000만~1.2억: 66만 − (1억−7,000만)×50% → 음수 → 최소 50만
  assert.equal(calculateEarnedIncomeTaxCredit(500 * 만, 1 * 억), 50 * 만);
  // 1.2억 초과: 50만 − (2억−1.2억)×50% → 음수 → 최소 20만
  assert.equal(calculateEarnedIncomeTaxCredit(500 * 만, 2 * 억), 20 * 만);
});

test('근로소득세 Q0: 총급여 1억의 결정세액', () => {
  const r = calculateEarnedIncomeTax(1 * 억);
  assert.equal(r.deduction, 1475 * 만);          // 1,200만 + 5,500만×5%
  assert.equal(r.incomeAmount, 8525 * 만);
  assert.equal(r.taxBase, 8375 * 만);            // − 본인 기본공제 150만
  // 8,375만은 8,800만 이하 구간 → ×24% − 576만 = 1,434만
  assert.equal(r.computedTax, 1434 * 만);
  assert.equal(r.credit, 50 * 만);               // 1억 → 한도 50만
  assert.equal(r.determinedTax, 1384 * 만);
  assert.equal(Math.round(r.totalTax), 15224000); // 1,384만 × 110%
});

test('급여배당 Q1: 급여 1억 · 배당 없음 (4대보험 미반영)', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 0, includeInsurance: false,
  });
  const x = r.withoutDividend;
  assert.equal(x.salaryTax, 15224000);
  assert.equal(x.insurance, 0);
  assert.equal(x.dividendTax, 0);
  assert.equal(x.totalTax, 15224000);
  assert.equal(x.netCash, 84776000);            // 1억 − 1,522.4만
  assert.equal(r.dividendCost, 0);
});

test('급여배당 Q2: 급여 1억 + 배당 2,000만 — 경계값은 전액 분리과세', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 2000 * 만, includeInsurance: false,
  });
  const x = r.withDividend;
  assert.equal(x.isSeparateTaxation, true);
  assert.equal(x.dividendExcess, 0);
  assert.equal(x.dividendTax, 3080000);         // 2,000만 × 15.4%
  assert.equal(x.salaryTax, 15224000);          // 급여 세액은 배당과 무관하게 고정
  assert.equal(x.totalTax, 18304000);
  assert.equal(r.dividendCost, 3080000);        // 배당 실행에 따른 추가 부담
  assert.equal(x.netCash, 101696000);           // 1억2,000만 − 1,830.4만
});

test('급여배당 Q3: 급여 1억 + 배당 5,000만 — 초과 3,000만은 급여에 합산', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 5000 * 만, includeInsurance: false,
  });
  const x = r.withDividend;
  assert.equal(x.isSeparateTaxation, false);
  assert.equal(x.dividendSeparateTax, 3080000);  // 2,000만 × 15.4%
  assert.equal(x.dividendExcess, 3000 * 만);
  // 과세표준 8,375만 + 3,000만 = 1억1,375만 → ×35% − 1,544만 = 2,437.25만
  // 증분 = 2,437.25만 − 1,434만 = 1,003.25만 → ×110% = 1,103.575만
  assert.equal(x.dividendExcessTax, 11035750);
  assert.equal(x.isComparativeFloor, false);     // 누진세액이 15.4%보다 크다
  assert.equal(x.dividendTax, 14115750);
  assert.equal(x.totalTax, 29339750);
  assert.equal(x.netCash, 120660250);            // 1억5,000만 − 2,933.975만
});

test('급여배당 Q4: 급여가 없으면 비교과세 하한 15.4%가 초과분에 적용된다', () => {
  const r = calculateSalaryDividendCompare({
    salary: 0, dividend: 3000 * 만, includeInsurance: false,
  });
  const x = r.withDividend;
  assert.equal(x.salaryTax, 0);
  assert.equal(x.dividendSeparateTax, 3080000);
  // 누진으로는 1,000만×6% = 60만 → ×110% = 66만이지만, 하한 1,000만×15.4% = 154만
  assert.equal(x.dividendExcessTax, 1540000);
  assert.equal(x.isComparativeFloor, true);
  assert.equal(x.dividendTax, 4620000);          // 3,000만 전체가 15.4%
  assert.equal(x.totalTax, 4620000);
});

test('급여배당 Q5: 4대보험을 반영하면 총 부담과 세후 수령액이 함께 움직인다', () => {
  const r = calculateSalaryDividendCompare({ salary: 1 * 억, dividend: 0 });
  const x = r.withDividend;
  assert.equal(x.insurance, 900 * 만);           // 1억 × 9%
  assert.equal(x.totalTax, 15224000);            // 세금은 보험과 별개
  assert.equal(x.burden, 24224000);              // 세금 + 보험료
  assert.equal(x.netCash, 75776000);             // 1억 − 2,422.4만
  assert.equal(Number(x.effectiveRate.toFixed(5)), 0.24224);
});

test('급여배당 Q6: 급여 수준별 비교표는 증감폭 기준 5단계다', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 0, includeInsurance: false, stepPercent: 20,
  });
  assert.equal(r.salaryScale.length, 5);
  assert.deepEqual(r.salaryScale.map((x) => x.salary),
    [6000 * 만, 8000 * 만, 1 * 억, 12000 * 만, 14000 * 만]);
  assert.deepEqual(r.salaryScale.map((x) => x.isCurrent), [false, false, true, false, false]);
  // 6,000만: 공제 1,275만 → 과세표준 4,575만 → ×15% − 126만 = 560.25만
  //          세액공제 한도 66만 → 494.25만 → ×110% = 543.675만
  assert.equal(r.salaryScale[0].salaryTax, 5436750);
  // 1억4,000만: 공제 1,555만 → 과세표준 1억2,295만 → ×35% − 1,544만 = 2,759.25만
  //             세액공제 한도 20만 → 2,739.25만 → ×110% = 3,013.175만
  assert.equal(r.salaryScale[4].salaryTax, 30131750);
  // 현재 급여 행은 표1의 배당 미실행 시나리오와 같은 값이어야 한다
  assert.equal(r.salaryScale[2].salaryTax, r.withoutDividend.salaryTax);
});

test('급여배당 Q7: 증감폭 0%면 현재 급여 한 줄만 비교한다', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 0, includeInsurance: false, stepPercent: 0,
  });
  assert.equal(r.salaryScale.length, 1);
  assert.equal(r.salaryScale[0].isCurrent, true);
  assert.equal(r.salaryScale[0].salary, 1 * 억);
});

test('급여배당 Q8: 증감폭이 커서 급여가 0 이하가 되는 단계는 표에서 제외한다', () => {
  const r = calculateSalaryDividendCompare({
    salary: 1 * 억, dividend: 0, includeInsurance: false, stepPercent: 50,
  });
  // 1 + (−2×0.5) = 0 → 제외, 나머지 4단계만 남는다
  assert.deepEqual(r.salaryScale.map((x) => x.salary),
    [5000 * 만, 1 * 억, 15000 * 만, 2 * 억]);
});

test('배당소득세: 2,000만원 경계 (소득세법 제14조 제3항)', () => {
  const under = calculateDividendTax(2000 * 만, 0);
  assert.equal(under.isSeparateTaxation, true);
  assert.equal(under.total, 3080000);
  const over = calculateDividendTax(2000 * 만 + 1, 0);
  assert.equal(over.isSeparateTaxation, false);
  assert.equal(over.excess, 1);
  assert.equal(calculateDividendTax(0, 0).total, 0);
});

// ══════════════════════════ 8. 임원퇴직금 ══════════════════════════
// 퇴직소득 인정한도: 2011년 이전 한도 없음 / 2012~2019년 3배수 / 2020년 이후 2배수
// 한도 초과분은 근로소득으로 과세되므로 §7의 근로소득세 함수로 계산한다
//   (총급여에 합산 → 근로소득공제·근로소득세액공제 재계산 → 증분).
// severanceTax·excessTax·totalTax는 모두 지방소득세 10%를 포함한 금액이다.
// 퇴직소득세는 환산급여 방식(연분연승).

test('임원퇴직금 R1: 간편 — 연평균 2억, 근속 15년, 3배수', () => {
  const r = calculateExecutiveSeveranceTax({ averagePay: 2 * 억, serviceYears: 15, payMultiple: 3 });
  assert.equal(r.paidAmount, 900000000);       // 2,000만 × 15 × 3
  assert.equal(r.limitAmount, 600000000);      // 2,000만 × 15 × 2
  assert.equal(r.excess, 300000000);
  assert.equal(r.yearsDeduction, 27500000);    // 1,500만 + 5×250만
  assert.equal(r.convertedIncome, 458000000);  // (6억 − 2,750만) ÷ 15 × 12
  assert.equal(r.convertedDeduction, 207000000); // 1억5,170만 + (4.58억−3억)×35%
  // 환산과세표준 2억5,100만 → ×38% − 1,994만 = 7,544만 → ÷12×15 = 9,430만 → ×110%
  assert.equal(r.severanceTax, 103730000);
  // 초과분 3억이 근로소득 → 근로소득공제 1,875만, 과세표준 2억7,975만
  // ×38% − 1,994만 = 8,636.5만, 세액공제 한도 20만 → 8,616.5만 → ×110% = 9,478.15만
  assert.equal(r.excessTax, 94781500);
  assert.equal(r.totalTax, 198511500);
});

test('임원퇴직금 R2: 2배수는 한도 내이므로 초과분 없음', () => {
  const r = calculateExecutiveSeveranceTax({ averagePay: 2 * 억, serviceYears: 15, payMultiple: 2 });
  assert.equal(r.excess, 0);
  assert.equal(r.excessTax, 0);
  assert.equal(r.severanceTax, 103730000);
  assert.equal(r.totalTax, 103730000);
});

test('임원퇴직금 R3: 심화 — 2011년 이전 근속 5년은 한도 계산에서 제외된다', () => {
  const r = calculateExecutiveSeveranceTax({
    averagePay: 2 * 억, serviceYears: 15, payMultiple: 3, yearsUntil2011: 5,
  });
  assert.deepEqual([r.yearsPre, r.yearsTriple, r.yearsDouble], [5, 0, 10]);
  // 2011년 이전 5년분 지급액 2,000만×5×3 = 3억은 한도 없이 전액 인정된다.
  // 2020년 이후 10년분 한도는 2,000만×10×2 = 4억. 인정 합계 7억.
  assert.equal(r.paidUntil2011, 300000000);
  assert.equal(r.limitAfter2012, 400000000);
  assert.equal(r.limitAmount, 700000000);
  // 초과분은 2012년 이후 구간에서만 난다 — 지급 6억 − 한도 4억 = 2억
  assert.equal(r.excess, 200000000);
  assert.equal(r.convertedIncome, 538000000);
  assert.equal(r.severanceTax, 130982500);     // 1억1,907.5만 × 110%
  // 초과분 2억 → 근로소득공제 1,675만, 과세표준 1억8,175만
  // ×38% − 1,994만 = 4,912.5만, 세액공제 한도 20만 → 4,892.5만 → ×110% = 5,381.75만
  assert.equal(r.excessTax, 53817500);
  assert.equal(r.totalTax, 184800000);
});

test('임원퇴직금 R4: 간편 — 연평균 1.2억, 근속 3년, 3배수', () => {
  const r = calculateExecutiveSeveranceTax({ averagePay: 1.2 * 억, serviceYears: 3, payMultiple: 3 });
  assert.equal(r.paidAmount, 108000000);
  assert.equal(r.limitAmount, 72000000);
  assert.equal(r.yearsDeduction, 3000000);     // 3년 × 100만
  assert.equal(r.convertedIncome, 276000000);  // (7,200만 − 300만) ÷ 3 × 12
  assert.equal(r.convertedDeduction, 140900000); // 6,170만 + (2.76억−1억)×45%
  assert.equal(r.severanceTax, 8757375);         // 796.125만 × 110%
  // 초과분 3,600만 → 근로소득공제 1,065만, 과세표준 2,385만
  // ×15% − 126만 = 231.75만, 세액공제 71.6만 → 160.15만 → ×110% = 176.165만
  assert.equal(r.excessTax, 1761650);
  assert.equal(r.totalTax, 10519025);
});

test('임원퇴직금 R5: 심화 — 다른 근로소득 8,000만원과 합산되어 초과분 세부담 증가', () => {
  const r = calculateExecutiveSeveranceTax({
    averagePay: 1.2 * 억, serviceYears: 3, payMultiple: 3, otherIncome: 8000 * 만,
  });
  // 총급여 1억1,600만: 공제 1,507만 → 과세표준 9,943만 → ×35% − 1,544만 = 1,936.05만
  //   세액공제 50만 → 1,886.05만 → ×110% = 2,074.655만
  // 총급여 8,000만: 공제 1,375만 → 과세표준 6,475만 → ×24% − 576만 = 978만
  //   세액공제 50만 → 928만 → ×110% = 1,020.8만
  // 증분 = 2,074.655만 − 1,020.8만 = 1,053.855만
  assert.equal(r.excessTax, 10538550);
  assert.equal(r.severanceTax, 8757375);
  assert.equal(r.totalTax, 19295925);
});

test('임원퇴직금 R6: 근속 전체가 2011년 이전이면 한도초과분이 없다', () => {
  // 지급배수를 5배로 올려도 2011년 이전 근무분에는 한도가 없으므로 초과분이 생기지 않는다.
  const r = calculateExecutiveSeveranceTax({
    averagePay: 2 * 억, serviceYears: 10, payMultiple: 5, yearsUntil2011: 10,
  });
  assert.deepEqual([r.yearsPre, r.yearsTriple, r.yearsDouble], [10, 0, 0]);
  assert.equal(r.paidAmount, 1000000000);      // 2,000만 × 10년 × 5배
  assert.equal(r.limitAfter2012, 0);
  assert.equal(r.excess, 0);
  assert.equal(r.severanceIncome, 1000000000);
  // 근속연수공제 10년 = 500만 + 5×200만 = 1,500만
  // 환산급여 = (10억 − 1,500만) ÷ 10 × 12 = 11억8,200만
  // 환산급여공제 = 1억5,170만 + (11억8,200만 − 3억)×35% = 4억6,040만
  // 과세표준 7억2,160만 → ×42% − 3,594만 = 2억6,713.2만 → 연분연승 ÷12×10 = 2억2,261만
  assert.equal(r.convertedIncome, 1182000000);
  assert.equal(r.severanceTax, 244871000);     // 2억2,261만 + 지방소득세 10%
  assert.equal(r.totalTax, 244871000);         // 초과분이 없어 퇴직소득세가 전부다
});

test('임원퇴직금 R7: 2012~2019년 근속분에는 3배수 한도가 적용된다', () => {
  const base = { averagePay: 2 * 억, serviceYears: 10, payMultiple: 3 };
  // 전 기간이 3배수 구간이면 정관 3배수가 한도와 같아 초과분이 없다.
  const triple = calculateExecutiveSeveranceTax(Object.assign({}, base, { years2012to2019: 10 }));
  assert.deepEqual([triple.yearsPre, triple.yearsTriple, triple.yearsDouble], [0, 10, 0]);
  assert.equal(triple.limitAmount, 600000000);   // 2,000만 × 10 × 3
  assert.equal(triple.excess, 0);
  // 같은 입력에서 구간 지정만 빼면 2020년 이후로 보아 2배수 한도가 걸린다.
  const double = calculateExecutiveSeveranceTax(base);
  assert.deepEqual([double.yearsPre, double.yearsTriple, double.yearsDouble], [0, 0, 10]);
  assert.equal(double.limitAmount, 400000000);   // 2,000만 × 10 × 2
  assert.equal(double.excess, 200000000);        // 지급 6억 − 한도 4억
});

test('임원퇴직금: 구간 연수 합계가 근속연수를 넘으면 앞 구간부터 채운다', () => {
  const r = calculateExecutiveSeveranceTax({
    averagePay: 2 * 억, serviceYears: 8, payMultiple: 3, yearsUntil2011: 6, years2012to2019: 10,
  });
  assert.deepEqual([r.yearsPre, r.yearsTriple, r.yearsDouble], [6, 2, 0]);
  assert.equal(r.yearsPre + r.yearsTriple + r.yearsDouble, 8);
});

test('임원퇴직금 R8: 3배수 구간 한도는 2019년 기준 평균급여로 계산한다', () => {
  // 소득세법 제22조 제3항 — 2012~2019년 근속분의 한도는 2019.12.31.부터 소급 3년 평균급여,
  // 2020년 이후 근속분의 한도는 퇴직일부터 소급 3년 평균급여로 각각 계산한다.
  const r = calculateExecutiveSeveranceTax({
    averagePay: 2 * 억, averagePay2019: 1 * 억,
    serviceYears: 15, payMultiple: 3, years2012to2019: 8,
  });
  assert.deepEqual([r.yearsPre, r.yearsTriple, r.yearsDouble], [0, 8, 7]);
  assert.equal(r.usesSeparate2019Pay, true);
  assert.equal(r.annualBase, 2000 * 만);        // 2억 ÷ 10
  assert.equal(r.annualBase2019, 1000 * 만);    // 1억 ÷ 10
  assert.equal(r.limitTriple, 2.4 * 억);        // 1,000만 × 8년 × 3배 = 2.4억
  assert.equal(r.limitDouble, 2.8 * 억);        // 2,000만 × 7년 × 2배 = 2.8억
  assert.equal(r.limitAmount, 5.2 * 억);        // 합계 5.2억
  // 정관상 지급액은 최종 급여 기준이다 — 2,000만 × 15년 × 3배 = 9억
  assert.equal(r.paidAmount, 9 * 억);
  assert.equal(r.excess, 3.8 * 억);             // 9억 − 5.2억
});

test('임원퇴직금 R9: 2019년 급여를 넣지 않으면 최종 급여로 갈음한다', () => {
  const base = { averagePay: 2 * 억, serviceYears: 15, payMultiple: 3, years2012to2019: 8 };
  const fallback = calculateExecutiveSeveranceTax(base);
  const same = calculateExecutiveSeveranceTax(Object.assign({}, base, { averagePay2019: 2 * 억 }));
  assert.equal(fallback.usesSeparate2019Pay, false);
  assert.equal(fallback.annualBase2019, fallback.annualBase);
  assert.equal(fallback.limitAmount, same.limitAmount);
  // 2,000만 × (8×3 + 7×2) = 2,000만 × 38 = 7.6억
  assert.equal(fallback.limitAmount, 7.6 * 억);
  // 급여가 그동안 올랐다면 최종 급여로 갈음한 한도가 더 크다 → 초과분이 과소 계상된다
  const correct = calculateExecutiveSeveranceTax(Object.assign({}, base, { averagePay2019: 1 * 억 }));
  assert.ok(fallback.limitAmount > correct.limitAmount);
  assert.ok(fallback.excess < correct.excess);
});

test('근속연수: 1년 미만의 기간은 1년으로 본다 (소득세법 제48조 제1항)', () => {
  assert.equal(calculateServiceYearsFromMonths(0), 0);       // 근무 없음
  assert.equal(calculateServiceYearsFromMonths(1), 1);       // 1개월 → 1년
  assert.equal(calculateServiceYearsFromMonths(12), 1);      // 정확히 1년
  assert.equal(calculateServiceYearsFromMonths(13), 2);      // 1년 1개월 → 2년
  assert.equal(calculateServiceYearsFromMonths(180), 15);    // 15년
  assert.equal(calculateServiceYearsFromMonths(183), 16);    // 15년 3개월 → 16년
  assert.equal(calculateServiceYearsFromMonths(-5), 0);      // 역순 입력 방어
});

test('근속 구간 배분: 남는 기간은 2020년 이후 구간으로 본다', () => {
  // 2010.1.~2026.1. 192개월 = 16년. 2011년 이전 24개월, 2012~2019년 96개월,
  // 남는 72개월(2020.1.~2026.1.)은 2배수 구간.
  assert.deepEqual(allocateServiceYears({ totalMonths: 192, monthsUntil2011: 24, months2012to2019: 96 }),
    { serviceYears: 16, yearsUntil2011: 2, years2012to2019: 8, yearsAfter2020: 6 });
  // 2012년 이후 입사자는 2011년 이전 구간이 0이다.
  assert.deepEqual(allocateServiceYears({ totalMonths: 120, months2012to2019: 96 }),
    { serviceYears: 10, yearsUntil2011: 0, years2012to2019: 8, yearsAfter2020: 2 });
  // 전 기간이 2020년 이후면 전부 2배수 구간이다.
  assert.deepEqual(allocateServiceYears({ totalMonths: 60 }),
    { serviceYears: 5, yearsUntil2011: 0, years2012to2019: 0, yearsAfter2020: 5 });
  // 근속연수를 1년으로 올린 만큼 구간 합계가 근속연수를 넘지 않는다.
  const s = allocateServiceYears({ totalMonths: 15, monthsUntil2011: 15, months2012to2019: 0 });
  assert.equal(s.serviceYears, 2);              // 15개월 → 2년
  assert.equal(s.yearsUntil2011 + s.years2012to2019 + s.yearsAfter2020, 2);
});

// ══════════════════════════ 세대생략 할증 ══════════════════════════
// 상증법 제27조(상속)·제57조(증여). 자녀를 건너뛴 직계비속이 취득하면 30%,
// 그 취득자가 미성년자이고 취득재산이 20억원을 초과하면 40%를 산출세액에 가산한다.
// 신고세액공제는 할증액을 포함한 금액을 기준으로 계산한다 (제69조).
//
// 아래 기대값의 공통 전제 — 부동산 30억, 배우자 없음, 자녀 1명, 현금 0
//   과세가액 30억 / 일괄공제 5억(인적공제 2.5억보다 크다) / 과세표준 25억
//   산출세액 = 25억 × 40% − 1.6억 = 8억4,000만
const SKIP_BASE = { realEstate: 30 * 억, cash: 0, hasSpouse: false, numChildren: 1 };

test('세대생략 상속 GS1: 손자 성년 10억 취득 — 비율 1/3 × 30%', () => {
  const r = calculateInheritanceTax(Object.assign({}, SKIP_BASE, {
    generationSkipShare: 10 * 억,
  }));
  assert.equal(r.taxBase, 2500000000);
  assert.equal(r.calculatedTax, 840000000);
  // 8억4,000만 × (10억/30억) × 30% = 8억4,000만 × 0.1 = 8,400만
  assert.equal(r.generationSkipRate, 0.3);
  assert.equal(r.generationSkipSurcharge, 84000000);
  // 신고세액공제 = (8억4,000만 + 8,400만) × 3% = 9억2,400만 × 3% = 2,772만
  assert.equal(r.reportDeduction, 27720000);
  assert.equal(r.finalTax, 896280000);         // 9억2,400만 − 2,772만
});

test('세대생략 상속 GS2: 손자 미성년 25억 취득 — 20억 초과이므로 40%', () => {
  const r = calculateInheritanceTax(Object.assign({}, SKIP_BASE, {
    generationSkipShare: 25 * 억, isGenerationSkipMinor: true,
  }));
  // 8억4,000만 × (25억/30억) × 40% = 8억4,000만 × 1/3 = 2억8,000만
  assert.equal(r.generationSkipRate, 0.4);
  assert.equal(r.generationSkipSurcharge, 280000000);
  // (8억4,000만 + 2억8,000만) × 3% = 11억2,000만 × 3% = 3,360만
  assert.equal(r.reportDeduction, 33600000);
  assert.equal(r.finalTax, 1086400000);
});

test('세대생략 상속 GS3: 미성년이지만 20억 이하 취득이면 30%', () => {
  const r = calculateInheritanceTax(Object.assign({}, SKIP_BASE, {
    generationSkipShare: 15 * 억, isGenerationSkipMinor: true,
  }));
  // 8억4,000만 × (15억/30억) × 30% = 8억4,000만 × 0.15 = 1억2,600만
  assert.equal(r.generationSkipRate, 0.3);
  assert.equal(r.generationSkipSurcharge, 126000000);
  assert.equal(r.finalTax, 937020000);         // 9억6,600만 − 2,898만
});

test('세대생략 상속 GS4: 미입력이면 할증이 없고 기존 결과가 유지된다', () => {
  const without = calculateInheritanceTax(SKIP_BASE);
  const zero = calculateInheritanceTax(Object.assign({}, SKIP_BASE, { generationSkipShare: 0 }));
  assert.equal(without.generationSkipSurcharge, 0);
  assert.equal(without.generationSkipRate, 0);
  assert.equal(zero.finalTax, without.finalTax);
  // 8억4,000만 − 3% = 8억1,480만
  assert.equal(without.finalTax, 814800000);
});

test('세대생략 상속 GS5: 취득분이 과세가액을 넘어도 비율은 1을 넘지 않는다', () => {
  const r = calculateInheritanceTax(Object.assign({}, SKIP_BASE, {
    generationSkipShare: 100 * 억,
  }));
  assert.equal(r.generationSkipRatio, 1);
  // 전부 세대생략이면 할증은 산출세액 × 30% = 2억5,200만
  assert.equal(r.generationSkipSurcharge, 252000000);
});

test('세대생략 증여 GS6: 조부 → 성년 손자 5억 순수증여 — 30% 가산', () => {
  const r = calculateGiftTax({ giftValue: 5 * 억, isGenerationSkip: true });
  // 과세표준 5억 − 증여재산공제 5,000만 = 4.5억
  // 산출세액 = 4.5억 × 20% − 1,000만 = 8,000만
  assert.equal(r.giftTaxBase, 450000000);
  assert.equal(r.generationSkipRate, 0.3);
  assert.equal(r.generationSkipSurcharge, 24000000);   // 8,000만 × 30%
  // (8,000만 + 2,400만) × 97% = 1억400만 × 97% = 1억88만
  assert.equal(r.giftTax, 100880000);
});

test('세대생략 증여 GS7: 조부 → 미성년 손자 25억 — 20억 초과이므로 40%', () => {
  const r = calculateGiftTax({
    giftValue: 25 * 억, isGenerationSkip: true, isMinorRecipient: true,
  });
  // 증여재산공제 2,000만(미성년 직계존비속) → 과세표준 24억8,000만
  // 산출세액 = 24억8,000만 × 40% − 1.6억 = 8억3,200만
  assert.equal(r.giftTaxBase, 2480000000);
  assert.equal(r.generationSkipRate, 0.4);
  assert.equal(r.generationSkipSurcharge, 332800000);  // 8억3,200만 × 40%
  // (8억3,200만 + 3억3,280만) × 97% = 11억6,480만 × 97% = 11억2,985.6만
  assert.equal(r.giftTax, 1129856000);
});

test('세대생략 증여 GS8: 세대생략이 아니면 기존 결과가 유지된다', () => {
  const plain = calculateGiftTax({ giftValue: 5 * 억 });
  const skip = calculateGiftTax({ giftValue: 5 * 억, isGenerationSkip: true });
  assert.equal(plain.generationSkipSurcharge, 0);
  assert.equal(plain.giftTax, 77600000);              // 8,000만 × 97%
  assert.ok(skip.giftTax > plain.giftTax);
});

test('세대생략 증여 GS9: 부담부증여는 채무인수분을 뺀 증여분으로 20억 기준을 판정한다', () => {
  // 증여재산 25억 중 채무 6억을 인수하면 증여분은 19억 — 20억 이하이므로 30%
  const r = calculateGiftTax({
    giftValue: 25 * 억, assumedDebt: 6 * 억, isGenerationSkip: true, isMinorRecipient: true,
  });
  assert.equal(r.giftPortion, 1900000000);
  assert.equal(r.generationSkipRate, 0.3);
});

if (failed) process.exitCode = 1;
