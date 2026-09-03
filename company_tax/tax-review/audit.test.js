'use strict';
// 세무엔진 감사 테스트 — 외부 1차 출처(법령 조문·국세청 공표 세율표)로 구현을 대조한다.
// 실행: node company_tax/tax-review/audit.test.js
//
// 기존 calc.test.js와 역할이 다르다.
//   · calc.test.js  — 구현이 "설계한 대로" 동작하는지 확인한다 (회귀 방지)
//   · audit.test.js — 설계 자체가 "법령대로"인지 확인한다 (법 해석 오류 검출)
//
// 그래서 이 파일의 기대값은 구현도, 기존 테스트도, 프로젝트 문서도 참조하지 않았다.
// 법령 조문과 국세청이 공표한 세율표에서만 가져왔고 출처를 단언 옆에 남긴다.
// 조사일: 2026-08-20
//
// 이 파일의 FAIL은 "테스트가 깨졌다"가 아니라 "구현이 법령과 다르다"는 뜻이다.

const assert = require('node:assert/strict');
const current = require('./calc.js');
const legacy = require('./oracle/calc.js');

const {
  INHERITANCE_TAX_BRACKETS,
  INCOME_TAX_BRACKETS,
  JONGBU_TAX_BRACKETS_GENERAL,
  JONGBU_TAX_BRACKETS_MULTI,
  JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL,
  JONGBU_TAX_BRACKETS_REFORM_2027_MULTI,
  JONGBU_TAX_BRACKETS_REFORM_2028,
  JONGBU_BURDEN_CAP_RATE,
  calculateTieredTax,
  calculateInheritanceTax,
  calculateGiftTax,
  calculateComprehensiveRealEstateTax,
  calculateTransferIncomeTax,
  calculateBusinessSuccession,
  calculateUnlistedStockValue,
  calculateSalaryDividendCompare,
  calculateDividendTax,
  calculateExecutiveSeveranceTax,
} = current;

const 억 = 100000000;
const 만 = 10000;

// ══════════════════════════ 하네스 ══════════════════════════
// 발견 사항을 심각도별로 모아 마지막에 요약한다.

const findings = [];
let passCount = 0;

function audit(id, name, source, fn) {
  try {
    fn();
    passCount += 1;
    console.log(`PASS  ${id}  ${name}`);
  } catch (err) {
    findings.push({ id, name, source, message: err.message.split('\n')[0] });
    console.error(`FAIL  ${id}  ${name}`);
    console.error(`      근거: ${source}`);
    console.error(`      ${err.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

// 소유자가 범위에서 제외한 항목. 미구현이지만 "고칠 결함"이 아니라 "받아들인 결정"이다.
// 결함으로 계속 세면 「36/1」이 정상 상태가 되어 진짜 결함이 그 속에 묻힌다.
// 그래서 따로 세지만, 매 실행마다 결정 근거와 함께 출력해 잊히지 않게 한다.
//
// 검사 자체는 그대로 돌린다 — 나중에 구현되면 통과할 것이고, 그때는 제외 목록에서
// 빼야 하므로 오히려 그것을 결함으로 보고한다. 목록이 양방향으로 낡지 않게 하는 장치다.
const exclusions = [];
function excludedByOwner(id, name, source, decision, fn) {
  try {
    fn();
    findings.push({
      id, name, source,
      message: '범위 제외 항목인데 검사가 통과한다 — 구현된 것으로 보이므로 제외 목록에서 빼야 한다.',
    });
    console.error(`FAIL  ${id}  ${name} (제외 목록이 낡음)`);
  } catch (err) {
    exclusions.push({ id, name, source, decision, message: err.message.split('\n')[0] });
    console.log(`SKIP  ${id}  ${name} — 범위 제외`);
  }
}

// ══════════════════════════ A. 법령 상수 대조 ══════════════════════════
// 세율표·공제액을 법령 조문 및 국세청 공표표와 1:1로 맞춰 본다.
// 구현의 표를 읽어 기대값을 만들면 대조가 성립하지 않으므로, 기대값을 여기에 직접 적었다.

audit('A-1', '상속·증여세 세율표가 상증법 제26조와 일치한다',
  '상속세및증여세법 제26조 (1억 10%, 5억 20%, 10억 30%, 30억 40%, 초과 50%)', () => {
    assert.deepEqual(INHERITANCE_TAX_BRACKETS, [
      { upTo: 1 * 억, rate: 0.10 },
      { upTo: 5 * 억, rate: 0.20 },
      { upTo: 10 * 억, rate: 0.30 },
      { upTo: 30 * 억, rate: 0.40 },
      { upTo: Infinity, rate: 0.50 },
    ]);
  });

audit('A-2', '종합소득세 세율표가 소득세법 제55조 8단계와 일치한다',
  '소득세법 제55조 제1항 (1,400만 6% / 5,000만 15% / 8,800만 24% / 1.5억 35% / 3억 38% / 5억 40% / 10억 42% / 초과 45%)', () => {
    assert.deepEqual(INCOME_TAX_BRACKETS, [
      { upTo: 1400 * 만, rate: 0.06 },
      { upTo: 5000 * 만, rate: 0.15 },
      { upTo: 8800 * 만, rate: 0.24 },
      { upTo: 15000 * 만, rate: 0.35 },
      { upTo: 30000 * 만, rate: 0.38 },
      { upTo: 50000 * 만, rate: 0.40 },
      { upTo: 100000 * 만, rate: 0.42 },
      { upTo: Infinity, rate: 0.45 },
    ]);
  });

audit('A-3', '종부세 2주택 이하 세율표가 국세청 공표표와 일치한다',
  '종합부동산세법 제9조 제1항 / 국세청 「종합부동산세 세율」(2023년 이후 개인) — 50억~94억 구간 2.0%가 별도로 존재한다', () => {
    assert.deepEqual(JONGBU_TAX_BRACKETS_GENERAL, [
      { upTo: 3 * 억, rate: 0.005 },
      { upTo: 6 * 억, rate: 0.007 },
      { upTo: 12 * 억, rate: 0.010 },
      { upTo: 25 * 억, rate: 0.013 },
      { upTo: 50 * 억, rate: 0.015 },
      { upTo: 94 * 억, rate: 0.020 },
      { upTo: Infinity, rate: 0.027 },
    ]);
  });

audit('A-4', '종부세 3주택 이상 중과 세율표가 국세청 공표표와 일치한다',
  '종합부동산세법 제9조 제1항 / 국세청 「종합부동산세 세율」 — 중과는 과세표준 12억 초과분부터 갈리고, 3억~6억 0.7% / 6억~12억 1.0%는 일반과 동일하다', () => {
    assert.deepEqual(JONGBU_TAX_BRACKETS_MULTI, [
      { upTo: 3 * 억, rate: 0.005 },
      { upTo: 6 * 억, rate: 0.007 },
      { upTo: 12 * 억, rate: 0.010 },
      { upTo: 25 * 억, rate: 0.020 },
      { upTo: 50 * 억, rate: 0.030 },
      { upTo: 94 * 억, rate: 0.040 },
      { upTo: Infinity, rate: 0.050 },
    ]);
  });

audit('A-4R', "2026 개편안 '27년 종부세 세율표가 개편안 자료와 일치한다",
  "기획재정부 2026 세제개편안 (5) 주택분 종합부동산세 세율 일원화 / 종부법 §9①·② — '27년은 주택수 차등을 남기되 6~12억 구간을 1.0%→1.3% 로 올리고, 12억 초과 각 구간을 인상한다", () => {
    assert.deepEqual(JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL, [
      { upTo: 3 * 억, rate: 0.005 },
      { upTo: 6 * 억, rate: 0.007 },
      { upTo: 12 * 억, rate: 0.013 },
      { upTo: 25 * 억, rate: 0.015 },
      { upTo: 50 * 억, rate: 0.020 },
      { upTo: 94 * 억, rate: 0.027 },
      { upTo: Infinity, rate: 0.035 },
    ], "'27년 2주택 이하");
    assert.deepEqual(JONGBU_TAX_BRACKETS_REFORM_2027_MULTI, [
      { upTo: 3 * 억, rate: 0.005 },
      { upTo: 6 * 억, rate: 0.007 },
      { upTo: 12 * 억, rate: 0.013 },
      { upTo: 25 * 억, rate: 0.020 },
      { upTo: 50 * 억, rate: 0.030 },
      { upTo: 94 * 억, rate: 0.040 },
      { upTo: Infinity, rate: 0.050 },
    ], "'27년 3주택 이상");
    // 구간 경계는 현행과 같다. 경계가 흔들리면 세액이 통째로 어긋난다.
    const 경계 = (t) => t.map((b) => b.upTo);
    assert.deepEqual(경계(JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL), 경계(JONGBU_TAX_BRACKETS_GENERAL));
    assert.deepEqual(경계(JONGBU_TAX_BRACKETS_REFORM_2027_MULTI), 경계(JONGBU_TAX_BRACKETS_MULTI));
  });

audit('A-4S', "2026 개편안 '28년 이후 종부세 세율표가 주택수와 무관한 단일 표다",
  "기획재정부 2026 세제개편안 (5) — '28년 이후 주택 수 기준 차등세율 폐지. 0.5 / 0.7 / 1.3 / 2.0 / 3.0 / 4.0 / 5.0%", () => {
    assert.deepEqual(JONGBU_TAX_BRACKETS_REFORM_2028, [
      { upTo: 3 * 억, rate: 0.005 },
      { upTo: 6 * 억, rate: 0.007 },
      { upTo: 12 * 억, rate: 0.013 },
      { upTo: 25 * 억, rate: 0.020 },
      { upTo: 50 * 억, rate: 0.030 },
      { upTo: 94 * 억, rate: 0.040 },
      { upTo: Infinity, rate: 0.050 },
    ]);
    // 차등 폐지는 표를 적어 두는 것만으로는 성립하지 않는다.
    // 같은 과세표준이면 2주택과 3주택의 산출세액이 실제로 같아야 한다.
    // 공정시장가액비율은 세율과 별개로 '28년에도 주택수·조정지역에 따라 갈리므로
    // (3주택 이상 80% / 그 외 70%), 조정대상지역을 켜 양쪽을 80%로 맞추고 세율만 견준다.
    const gross = (houses) => calculateComprehensiveRealEstateTax({
      publicPrice: 40 * 억, numHouses: houses, isSingleHouse: false, residentRatio: 0,
      isAdjustedArea: true, basis: '2026개편안', basisYear: '2028',
    });
    const 이주택 = gross(2);
    const 삼주택 = gross(3);
    assert.equal(이주택.taxBase, 삼주택.taxBase, '공정시장가액비율까지 같아야 비교가 성립한다');
    assert.equal(이주택.grossTax, 삼주택.grossTax, "'28년 이후에는 주택 수로 세율이 갈리지 않는다");
    assert.equal(삼주택.usesUnifiedRateTable, true);

    // 반대로 '27년에는 아직 갈린다. 폐지 시점을 한 해 당겨 잡지 않았는지 확인한다.
    const gross27 = (houses) => calculateComprehensiveRealEstateTax({
      publicPrice: 40 * 억, numHouses: houses, isSingleHouse: false, residentRatio: 0,
      isAdjustedArea: true, basis: '2026개편안', basisYear: '2027',
    }).grossTax;
    assert.notEqual(gross27(2), gross27(3), "'27년은 주택수 차등이 남아 있다");
  });

// 세율표가 틀렸다면 세액도 틀린다. 표와 무관하게 세액 자체로 한 번 더 확인한다.
audit('A-5', '종부세 3주택·과세표준 10억의 산출세액이 법정 세율로 계산한 값과 같다',
  '종합부동산세법 제9조 — 3억×0.5% + 3억×0.7% + 4억×1.0% = 150만 + 210만 + 400만 = 760만원', () => {
    assert.equal(Math.round(calculateTieredTax(10 * 억, JONGBU_TAX_BRACKETS_MULTI)), 7600000);
  });

audit('A-6', '종부세 2주택·과세표준 60억의 산출세액이 법정 세율로 계산한 값과 같다',
  '종합부동산세법 제9조 — 3억×0.5%+3억×0.7%+6억×1.0%+13억×1.3%+25억×1.5%+10억×2.0% = 150만+210만+600만+1,690만+3,750만+2,000만 = 8,400만원', () => {
    assert.equal(Math.round(calculateTieredTax(60 * 억, JONGBU_TAX_BRACKETS_GENERAL)), 84000000);
  });

audit('A-7', '상속세 각종 공제액이 상증법 제18~23조 금액과 일치한다',
  '상증법 제20조(자녀 5,000만·미성년 1,000만×연수·연로자 5,000만·장애인 1,000만×기대여명), 제21조(일괄공제 5억), 제19조(배우자 5억~30억), 제22조(금융재산 한도 2억)', () => {
    // 일괄공제 5억 — 배우자 없이 자녀 1명, 재산 5억이면 과세표준 0
    const a = calculateInheritanceTax({ realEstate: 5 * 억, cash: 0, hasSpouse: false, numChildren: 1 });
    assert.equal(a.breakdown.standardDeduction, 5 * 억, '일괄공제 5억');
    // 자녀공제 5,000만 — 기초 2억 + 자녀 7명 × 5,000만 = 5.5억 > 일괄공제 5억
    const b = calculateInheritanceTax({ realEstate: 20 * 억, cash: 0, hasSpouse: false, numChildren: 7 });
    assert.equal(b.breakdown.personalDeduction, 2 * 억 + 7 * 5000 * 만, '기초 2억 + 자녀 5,000만/인');
    // 배우자공제 최저 5억 — 법정상속분이 5억 미만이어도 5억
    const c = calculateInheritanceTax({ realEstate: 3 * 억, cash: 0, hasSpouse: true, numChildren: 2 });
    assert.equal(c.breakdown.spouseDeduction, 5 * 억, '배우자공제 하한 5억');
    // 배우자공제 상한 30억
    const d = calculateInheritanceTax({ realEstate: 200 * 억, cash: 0, hasSpouse: true, numChildren: 1 });
    assert.equal(d.breakdown.spouseDeduction, 30 * 억, '배우자공제 상한 30억');
    // 금융재산공제 상한 2억
    const e = calculateInheritanceTax({ realEstate: 0, cash: 50 * 억, hasSpouse: false, numChildren: 1 });
    assert.equal(e.breakdown.financialDeduction, 2 * 억, '금융재산공제 상한 2억');
  });

audit('A-8', '증여재산공제액이 상증법 제53조 금액과 일치한다',
  '상증법 제53조 — 배우자 6억, 직계존비속 5,000만(미성년 2,000만), 기타친족 1,000만', () => {
    assert.equal(calculateGiftTax({ giftValue: 10 * 억, relation: '배우자' }).relativeDeduction, 6 * 억);
    assert.equal(calculateGiftTax({ giftValue: 10 * 억, relation: '직계존비속' }).relativeDeduction, 5000 * 만);
    assert.equal(calculateGiftTax({ giftValue: 10 * 억, relation: '직계존비속', isMinorRecipient: true }).relativeDeduction, 2000 * 만);
    assert.equal(calculateGiftTax({ giftValue: 10 * 억, relation: '기타친족' }).relativeDeduction, 1000 * 만);
  });

audit('A-9', '종부세 기본공제·공정시장가액비율이 법령 수치와 일치한다',
  '종부세법 제8조 제1항(1세대1주택 12억, 그 외 9억), 동법 시행령 제2조의4(개인 주택분 공정시장가액비율 60%)', () => {
    const single = calculateComprehensiveRealEstateTax({ publicPrice: 20 * 억, isSingleHouse: true });
    assert.equal(single.basicDeduction, 12 * 억, '1세대1주택 기본공제 12억');
    assert.equal(single.fairMarketRatio, 0.6, '공정시장가액비율 60%');
    const general = calculateComprehensiveRealEstateTax({ publicPrice: 20 * 억, isSingleHouse: false, numHouses: 2 });
    assert.equal(general.basicDeduction, 9 * 억, '그 외 기본공제 9억');
    // 과세표준 = (20억 − 12억) × 60% = 4.8억
    assert.equal(single.taxBase, 4.8 * 억);
  });

audit('A-10', '가업상속공제 한도가 상증법 제18조의2 금액과 일치한다',
  '상증법 제18조의2 제1항 — 경영 10년 이상 300억, 20년 이상 400억, 30년 이상 600억', () => {
    const at10 = calculateBusinessSuccession({ businessValue: 1000 * 억, managementYears: 10 });
    const at20 = calculateBusinessSuccession({ businessValue: 1000 * 억, managementYears: 20 });
    const at30 = calculateBusinessSuccession({ businessValue: 1000 * 억, managementYears: 30 });
    const at9 = calculateBusinessSuccession({ businessValue: 1000 * 억, managementYears: 9 });
    assert.equal(at10.deductionCap, 300 * 억);
    assert.equal(at20.deductionCap, 400 * 억);
    assert.equal(at30.deductionCap, 600 * 억);
    assert.equal(at9.deductionCap, 0, '10년 미만은 요건 미충족');
  });

audit('A-11', '퇴직소득 근속연수공제·환산급여공제가 소득세법 제48조 표와 일치한다',
  '소득세법 제48조 제1항(근속연수공제)·제3항(환산급여공제)', () => {
    // 근속연수공제: 근속 20년 = 1,500만 + 10년×250만 = 4,000만
    // 근속 20년, 한도 내 지급이면 severanceIncome = paidAmount
    const r = calculateExecutiveSeveranceTax({ averagePay: 10 * 억, serviceYears: 20, payMultiple: 2 });
    assert.equal(r.yearsDeduction, 4000 * 만, '근속 20년 → 근속연수공제 4,000만');
    // 근속 5년 = 100만 × 5 = 500만
    const r5 = calculateExecutiveSeveranceTax({ averagePay: 10 * 억, serviceYears: 5, payMultiple: 2 });
    assert.equal(r5.yearsDeduction, 500 * 만, '근속 5년 → 500만');
  });

// ══════════════════════════ B. 법정 규칙 준수 ══════════════════════════
// 세율·공제액은 맞아도 "적용 규칙"이 틀리면 세액이 틀린다.

audit('B-1', '1세대1주택 장특공제는 보유분·거주분 각각 40%가 한도다',
  '소득세법 제95조 제5항 — "공제율이 100분의 40보다 큰 경우에는 100분의 40으로 한다". 표2는 보유 최대 40% + 거주 최대 40% = 합계 최대 80%', () => {
    // 보유 20년 / 거주 0년: 보유분 40%가 한도. 거주 2년 미만이면 표2 자체가 적용되지 않으므로
    // 어떤 해석을 취하더라도 공제율이 40%를 넘을 수는 없다.
    const r = calculateTransferIncomeTax({
      salePrice: 50 * 억, purchasePrice: 10 * 억, holdingYears: 20, livingYears: 0, isOneHouseExempt: true,
    });
    assert.ok(r.longTermRate <= 0.40 + 1e-9,
      `보유 20년·거주 0년의 장특공제율이 ${(r.longTermRate * 100).toFixed(0)}%로 산출됐다. 보유분 한도 40%를 넘을 수 없다.`);

    // 보유 12년 / 거주 3년: 법정 = 보유 40%(10년에서 상한) + 거주 12% = 52%
    const r2 = calculateTransferIncomeTax({
      salePrice: 50 * 억, purchasePrice: 10 * 억, holdingYears: 12, livingYears: 3, isOneHouseExempt: true,
    });
    assert.equal(Number(r2.longTermRate.toFixed(4)), 0.52,
      `보유 12년·거주 3년 → 법정 52%(보유 40% + 거주 12%)여야 한다. 산출값 ${(r2.longTermRate * 100).toFixed(0)}%`);
  });

audit('B-2', '다주택 중과 대상 자산은 장기보유특별공제가 배제된다',
  '소득세법 제95조 제2항 단서 — 장기보유특별공제 대상에서 "제104조 제7항 각 호에 따른 자산"(조정대상지역 다주택 중과 대상)을 제외한다', () => {
    const r = calculateTransferIncomeTax({
      salePrice: 20 * 억, purchasePrice: 5 * 억, holdingYears: 15, surchargeHouses: 3,
    });
    assert.equal(r.longTermDeduction, 0,
      `3주택 중과 대상인데 장특공제 ${(r.longTermDeduction / 억).toFixed(2)}억원이 적용됐다. 법 제95조 제2항 단서로 배제 대상이다.`);
  });

audit('B-3', '임원퇴직금 한도에서 2011.12.31. 이전 근무기간은 한도 계산 대상이 아니다',
  '소득세법 제22조 제3항 — 2011.12.31. 이전 근무분은 한도 적용 제외(전액 퇴직소득), 2012.1.1.~2019.12.31. 근무분은 3배, 2020.1.1. 이후 근무분은 2배', () => {
    // 근속 전체가 2011년 이전이면 정관상 지급액이 얼마든 한도초과분이 없어야 한다.
    const r = calculateExecutiveSeveranceTax({
      averagePay: 20 * 억, serviceYears: 10, payMultiple: 10, yearsUntil2011: 10,
    });
    assert.equal(r.excess, 0,
      `근속 전체가 2011년 이전인데 한도초과분 ${(r.excess / 억).toFixed(2)}억원이 발생했다. `
      + '법은 이 기간에 한도 적용 자체를 제외한다.');

    // 2012~2019년 구간은 3배, 2020년 이후는 2배다. 같은 근속연수라도 구간 배분에 따라 한도가 달라야 한다.
    const triple = calculateExecutiveSeveranceTax({
      averagePay: 20 * 억, serviceYears: 10, payMultiple: 3, years2012to2019: 10,
    });
    const double = calculateExecutiveSeveranceTax({
      averagePay: 20 * 억, serviceYears: 10, payMultiple: 3,
    });
    assert.equal(triple.excess, 0, '2012~2019년 10년 · 정관 3배수면 한도와 같아 초과분이 없어야 한다');
    assert.ok(double.limitAmount < triple.limitAmount,
      '2020년 이후 근무분(2배)의 한도가 2012~2019년 근무분(3배)보다 작아야 한다. '
      + `현재 3배 구간 ${triple.limitAmount} / 2배 구간 ${double.limitAmount}`);
  });

audit('B-4', '금융재산상속공제의 차감 대상은 금융채무뿐이다',
  '상증법 제22조 제1항 — "순금융재산의 가액"은 금융재산에서 금융채무를 뺀 값이다. 부동산 담보대출·임대보증금 등 비금융채무는 과세가액에서 차감되지만 순금융재산에서는 빼지 않는다', () => {
    // 임대보증금 3억이 있는 경우: 과세가액은 3억 줄지만 금융재산공제는 그대로여야 한다.
    const base = calculateInheritanceTax({
      realEstate: 20 * 억, cash: 5 * 억, hasSpouse: false, numChildren: 2,
    });
    const withDeposit = calculateInheritanceTax({
      realEstate: 20 * 억, cash: 5 * 억, hasSpouse: false, numChildren: 2, debt: 3 * 억, financialDebt: 0,
    });
    assert.equal(withDeposit.breakdown.financialDeduction, base.breakdown.financialDeduction,
      '계산 모듈은 debt/financialDebt를 분리해 두었으므로 이 단언은 통과해야 한다. '
      + '실제 문제는 화면 계층(index.html)이 두 인자에 같은 값을 넘기는 데 있다.');
  });

audit('B-5', '화면 계층이 채무를 과세가액과 순금융재산에 이중으로 차감하지 않는다',
  '상증법 제22조 — index.html의 상속세 run()이 debt와 financialDebt에 동일 필드를 넘기고 있다', () => {
    const fs = require('node:fs');
    const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
    const doubled = /debt:\s*g\.won\('debt'\)\s*,\s*financialDebt:\s*g\.won\('debt'\)/.test(html);
    assert.ok(!doubled,
      "index.html이 debt와 financialDebt에 같은 필드('debt')를 넘긴다. "
      + '금융채무 입력란이 없어 임대보증금·부동산 담보대출을 넣으면 금융재산상속공제가 함께 줄어든다.');
  });

audit('A-9R', '2026 개편안 종부세 기본공제가 자료의 적용 사례와 일치한다',
  '기획재정부 2026 세제개편안 「주택분 종합부동산세 과세대상 및 기본공제금액 조정 — ③ 적용 사례」 — 1세대1주택자 특례 거주 14억/비거주 12억, 다주택은 4억 + 5억 × 거주비중(거주주택 공시가격 ÷ 주택 공시가격 합계)', () => {
    const ded = (houses, residentRatio, single, isResident) =>
      calculateComprehensiveRealEstateTax({
        publicPrice: 30 * 억, numHouses: houses, isSingleHouse: single,
        isResident: isResident, residentRatio: residentRatio,
        basis: '2026개편안', basisYear: '2027',
      }).basicDeduction;

    // 1세대1주택자 특례 — 거주 14억 / 비거주 12억
    assert.equal(ded(1, 0, true, true), 14 * 억, '1주택 거주');
    assert.equal(ded(1, 0, true, false), 12 * 억, '1주택 비거주');

    // 자료 적용 사례 — 2주택자(각 10억) 중 1채 거주: 거주주택 10억 ÷ 합계 20억 = 50%
    //   4억 + (5억 × 1/2) = 6.5억
    assert.equal(ded(2, 50, false, false), 6.5 * 억, '2주택 1채 거주');
    // 3주택자(각 10억) 중 1채 거주: 10억 ÷ 30억 = 1/3 → 4억 + (5억 × 1/3) ≒ 5.7억
    assert.equal(Math.round(ded(3, 100 / 3, false, false)), 566666667, '3주택 1채 거주');
    // 소유 주택에 거주하지 않으면 4억
    assert.equal(ded(2, 0, false, false), 4 * 억, '2주택 비거주');
    assert.equal(ded(3, 0, false, false), 4 * 억, '3주택 비거주');

    // 안분 기준이 공시가격 비중이라는 것을 고정한다.
    // 자료의 적용 사례는 채마다 가격이 같아 주택 수로 읽어도 같은 값이 나오므로 기준을 가리지 못한다.
    // 가격이 다른 사례(거주 5억 + 비거주 15억, 2주택 중 1채 거주)에서만 갈린다.
    assert.equal(ded(2, 25, false, false), 5.25 * 억, '공시가격 비중 25% → 4억 + 1.25억');
    assert.notEqual(ded(2, 25, false, false), 6.5 * 억, '주택 수 기준(1/2)이었다면 6.5억이 된다');

    // 비율은 0~100%로 잘린다 — 거주주택이 합계보다 클 수는 없다.
    assert.equal(ded(2, 140, false, false), 9 * 억, '100% 초과는 100%로 절단');
    assert.equal(ded(2, -20, false, false), 4 * 억, '음수는 0%로 절단');
  });

audit('A-9S', '종부세 세부담상한이 현행·개편안 모두 150%다',
  '종합부동산세법 제10조·제15조 — 직전연도 총 보유세상당액(재산세 + 종부세)의 150%. 2026 세제개편안은 당초 정부안 200%에서 150%로 수정돼 현행과 같아졌다', () => {
    assert.equal(JONGBU_BURDEN_CAP_RATE, 1.5);
    // 이 도구는 직전연도 보유세를 입력받지 않아 상한을 적용하지 않는다.
    // 적용하지 않는다는 사실이 결과에 드러나야 화면이 고지할 수 있다.
    for (const basis of ['현행', '2026개편안']) {
      const r = calculateComprehensiveRealEstateTax({
        publicPrice: 30 * 억, numHouses: 1, isSingleHouse: true, basis: basis, basisYear: '2028',
      });
      assert.equal(r.burdenCapRate, 1.5, basis + ' 세부담상한율');
      assert.equal(r.burdenCapNotApplied, true, basis + ' 상한 미적용 고지');
    }
  });

audit('B-6', '종부세 중과 판정과 1세대1주택 기본공제가 동시에 성립하지 않는다',
  '종부세법 제8조·제9조 — 1세대1주택 기본공제(12억)와 3주택 이상 중과세율은 양립할 수 없는 상태다', () => {
    const r = calculateComprehensiveRealEstateTax({
      publicPrice: 50 * 억, numHouses: 3, isSingleHouse: true,
    });
    const contradictory = r.basicDeduction === 12 * 억 && r.isMultiHouse;
    assert.ok(!contradictory,
      '주택수 3 + 1세대1주택 "예"를 함께 넣으면 기본공제 12억과 3주택 중과세율이 동시에 적용된다. '
      + '양도세는 이런 모순을 surchargeSuppressed로 막지만 종부세는 막지 않는다.');
  });

// ══════════════════════════ C. 불변식 ══════════════════════════
// 개별 기대값이 아니라 "어떤 입력에서도 성립해야 하는 성질"을 확인한다.
// 기대값을 손으로 만들 수 없는 넓은 입력 공간을 훑는 데 쓴다.

function assertMonotone(label, values, direction) {
  for (let i = 1; i < values.length; i += 1) {
    const [prevIn, prev] = values[i - 1];
    const [curIn, cur] = values[i];
    if (direction === 'nondecreasing') {
      assert.ok(cur >= prev - 1,
        `${label}: 입력 ${prevIn}→${curIn}에서 세액이 ${prev}→${cur}로 감소했다.`);
    } else {
      assert.ok(cur <= prev + 1,
        `${label}: 입력 ${prevIn}→${curIn}에서 세액이 ${prev}→${cur}로 증가했다.`);
    }
  }
}

audit('C-1', '상속재산이 늘면 상속세는 줄지 않는다', '단조성 불변식', () => {
  const pts = [];
  for (let n = 0; n <= 60; n += 1) {
    const re = n * 억;
    pts.push([`${n}억`, calculateInheritanceTax({
      realEstate: re, cash: 2 * 억, hasSpouse: true, numChildren: 2,
    }).finalTax]);
  }
  assertMonotone('상속세 / 부동산', pts, 'nondecreasing');
});

audit('C-2', '채무·장례비가 늘면 상속세는 늘지 않는다', '단조성 불변식', () => {
  const debtPts = [];
  for (let n = 0; n <= 30; n += 1) {
    debtPts.push([`채무 ${n}억`, calculateInheritanceTax({
      realEstate: 40 * 억, cash: 5 * 억, hasSpouse: true, numChildren: 2, debt: n * 억,
    }).finalTax]);
  }
  assertMonotone('상속세 / 채무', debtPts, 'nonincreasing');

  const funeralPts = [];
  for (let n = 0; n <= 3000; n += 100) {
    funeralPts.push([`장례비 ${n}만`, calculateInheritanceTax({
      realEstate: 40 * 억, cash: 5 * 억, hasSpouse: true, numChildren: 2, funeralCost: n * 만,
    }).finalTax]);
  }
  assertMonotone('상속세 / 장례비', funeralPts, 'nonincreasing');
});

audit('C-3', '공시가격이 오르면 종부세는 줄지 않는다', '단조성 불변식', () => {
  for (const houses of [1, 2, 3, 5]) {
    const pts = [];
    for (let n = 0; n <= 120; n += 2) {
      pts.push([`${n}억`, calculateComprehensiveRealEstateTax({
        publicPrice: n * 억, numHouses: houses, isSingleHouse: houses === 1,
      }).finalTax]);
    }
    assertMonotone(`종부세 / ${houses}주택`, pts, 'nondecreasing');
  }
});

audit('C-4', '보유기간이 길어지면 종부세·양도세는 늘지 않는다', '단조성 불변식 (세액공제·장특공제는 기간에 비례해 커진다)', () => {
  const jongbuPts = [];
  for (let y = 0; y <= 30; y += 1) {
    jongbuPts.push([`보유 ${y}년`, calculateComprehensiveRealEstateTax({
      publicPrice: 30 * 억, numHouses: 1, isSingleHouse: true, holdingYears: y,
    }).finalTax]);
  }
  assertMonotone('종부세 / 보유기간', jongbuPts, 'nonincreasing');

  const transferPts = [];
  for (let y = 0; y <= 30; y += 1) {
    transferPts.push([`보유 ${y}년`, calculateTransferIncomeTax({
      salePrice: 20 * 억, purchasePrice: 5 * 억, holdingYears: y,
    }).finalTax]);
  }
  assertMonotone('양도세 / 보유기간', transferPts, 'nonincreasing');
});

audit('C-5', '취득가액이 오르면 양도세는 늘지 않는다', '단조성 불변식', () => {
  const pts = [];
  for (let n = 0; n <= 25; n += 1) {
    pts.push([`취득 ${n}억`, calculateTransferIncomeTax({
      salePrice: 20 * 억, purchasePrice: n * 억, holdingYears: 10,
    }).finalTax]);
  }
  assertMonotone('양도세 / 취득가액', pts, 'nonincreasing');
});

audit('C-6', '급여·배당이 커지면 총세부담은 줄지 않는다', '단조성 불변식', () => {
  // 급여 축과 배당 축을 따로 훑는다.
  for (const fixedSalary of [0, 1 * 억, 3 * 억]) {
    const pts = [];
    for (let n = 0; n <= 30; n += 1) {
      pts.push([`배당 ${n}억`, calculateSalaryDividendCompare({
        salary: fixedSalary, dividend: n * 억,
      }).withDividend.burden]);
    }
    assertMonotone(`급여배당 / 급여 ${fixedSalary / 억}억 고정, 배당 증가`, pts, 'nondecreasing');
  }
  for (const fixedDividend of [0, 1 * 억, 3 * 억]) {
    const pts = [];
    for (let n = 0; n <= 30; n += 1) {
      pts.push([`급여 ${n}억`, calculateSalaryDividendCompare({
        salary: n * 억, dividend: fixedDividend,
      }).withDividend.burden]);
    }
    assertMonotone(`급여배당 / 배당 ${fixedDividend / 억}억 고정, 급여 증가`, pts, 'nondecreasing');
  }
});

audit('C-7', '경영연수가 길어지면 가업승계 세액은 늘지 않는다', '단조성 불변식', () => {
  const pts = [];
  for (let y = 0; y <= 40; y += 1) {
    pts.push([`경영 ${y}년`, calculateBusinessSuccession({
      businessValue: 500 * 억, managementYears: y, totalEstate: 600 * 억,
    }).taxWith]);
  }
  assertMonotone('가업승계 / 경영연수', pts, 'nonincreasing');
});

audit('C-8', '세액 구성 항목의 합이 최종세액과 일치한다', '출력 정합성 (반올림 1회 원칙)', () => {
  const inh = calculateInheritanceTax({ realEstate: 33.7 * 억, cash: 4.1 * 억, hasSpouse: true, numChildren: 3 });
  assert.equal(inh.finalTax, inh.calculatedTax - inh.reportDeduction, '상속세: 산출 − 신고세액공제');

  const jb = calculateComprehensiveRealEstateTax({ publicPrice: 37.3 * 억, numHouses: 2, isSingleHouse: false });
  assert.equal(jb.finalTax, jb.calculatedTax + jb.ruralTax, '종부세: 세액 + 농특세');

  const tr = calculateTransferIncomeTax({ salePrice: 23.7 * 억, purchasePrice: 6.1 * 억, holdingYears: 7 });
  assert.equal(tr.finalTax, tr.calculatedTax + tr.localTax, '양도세: 세액 + 지방소득세');

  const gf = calculateGiftTax({ giftValue: 13.3 * 억, assumedDebt: 4.1 * 억, acquisitionCost: 5.7 * 억 });
  assert.equal(gf.total, gf.giftTax + gf.transferTax, '증여세: 증여세 + 양도세');
});

audit('C-9', '어떤 입력에서도 음수 세액이 나오지 않는다', '방어 불변식', () => {
  const cases = [
    ['상속세', () => calculateInheritanceTax({ realEstate: 1 * 억, cash: 0, hasSpouse: true, numChildren: 0, debt: 5 * 억 }).finalTax],
    ['증여세', () => calculateGiftTax({ giftValue: 1000 * 만, relation: '기타친족' }).total],
    ['종부세', () => calculateComprehensiveRealEstateTax({ publicPrice: 1 * 억, isSingleHouse: true, ownerAge: 75, holdingYears: 20, propertyTaxPaid: 5 * 억 }).finalTax],
    ['양도세', () => calculateTransferIncomeTax({ salePrice: 5 * 억, purchasePrice: 20 * 억, holdingYears: 10 }).finalTax],
    ['가업승계', () => calculateBusinessSuccession({ businessValue: 10 * 억, managementYears: 30, totalEstate: 10 * 억 }).total],
    ['비상장주식', () => calculateUnlistedStockValue({ netAsset: 0, weightedIncome: 0, totalShares: 10000 }).totalValue],
    ['급여배당', () => calculateSalaryDividendCompare({ salary: 0, dividend: 0 }).withDividend.burden],
    ['임원퇴직금', () => calculateExecutiveSeveranceTax({ averagePay: 0, serviceYears: 0, payMultiple: 2 }).totalTax],
  ];
  for (const [name, fn] of cases) {
    const v = fn();
    assert.ok(Number.isFinite(v) && v >= 0, `${name}: ${v}`);
  }
});

audit('C-10', '급여·배당 조합을 훑어도 세부담이 소득을 넘지 않고 실수령액이 음수가 되지 않는다',
  '방어 불변식', () => {
    for (let s = 0; s <= 10; s += 1) {
      for (let d = 0; d <= 10; d += 1) {
        const gross = (s + d) * 억;
        const r = calculateSalaryDividendCompare({ salary: s * 억, dividend: d * 억 }).withDividend;
        assert.ok(Number.isFinite(r.burden), `급여 ${s}억·배당 ${d}억에서 비유한값`);
        assert.ok(r.burden <= gross,
          `급여 ${s}억·배당 ${d}억에서 세부담 ${r.burden}이 소득 ${gross}을 넘었다`);
        assert.ok(r.netCash >= 0,
          `급여 ${s}억·배당 ${d}억에서 실수령액이 음수(${r.netCash})다`);
      }
    }
  });

// ══════════════════════════ D. 경계값 ══════════════════════════
// 누진 구간·공제 한도의 경계에서 ±1원을 넣어 불연속(점프)이 없는지 본다.

audit('D-1', '누진세율 구간 경계에서 세액이 튀지 않는다', '연속성 — 한계세율 방식은 경계에서 연속이어야 한다', () => {
  for (const brackets of [INHERITANCE_TAX_BRACKETS, INCOME_TAX_BRACKETS, JONGBU_TAX_BRACKETS_GENERAL, JONGBU_TAX_BRACKETS_MULTI]) {
    for (const { upTo } of brackets) {
      if (!Number.isFinite(upTo)) continue;
      const below = calculateTieredTax(upTo - 1, brackets);
      const at = calculateTieredTax(upTo, brackets);
      const above = calculateTieredTax(upTo + 1, brackets);
      assert.ok(at - below < 1, `경계 ${upTo}: ${upTo - 1}원→${upTo}원에서 ${at - below}원 점프`);
      assert.ok(above - at < 1, `경계 ${upTo}: ${upTo}원→${upTo + 1}원에서 ${above - at}원 점프`);
    }
  }
});

audit('D-2', '금융재산상속공제의 2,000만원 경계가 상증법 제22조대로 동작한다',
  '상증법 제22조 제1항 — 순금융재산 2,000만원 이하는 전액, 초과분은 max(20%, 2,000만) 한도 2억', () => {
    const at = calculateInheritanceTax({ realEstate: 0, cash: 2000 * 만, hasSpouse: false, numChildren: 1 });
    assert.equal(at.breakdown.financialDeduction, 2000 * 만, '순금융재산 2,000만 → 전액');
    const below = calculateInheritanceTax({ realEstate: 0, cash: 1500 * 만, hasSpouse: false, numChildren: 1 });
    assert.equal(below.breakdown.financialDeduction, 1500 * 만, '순금융재산 1,500만 → 전액');
    const mid = calculateInheritanceTax({ realEstate: 0, cash: 5000 * 만, hasSpouse: false, numChildren: 1 });
    assert.equal(mid.breakdown.financialDeduction, 2000 * 만, '5,000만의 20%=1,000만 < 2,000만 → 2,000만');
    const cap = calculateInheritanceTax({ realEstate: 0, cash: 10 * 억, hasSpouse: false, numChildren: 1 });
    assert.equal(cap.breakdown.financialDeduction, 2 * 억, '10억의 20%=2억 → 상한 2억');
    const overCap = calculateInheritanceTax({ realEstate: 0, cash: 20 * 억, hasSpouse: false, numChildren: 1 });
    assert.equal(overCap.breakdown.financialDeduction, 2 * 억, '20억의 20%=4억 → 상한 2억');
  });

audit('D-3', '1세대1주택 양도세 비과세 12억 경계가 연속이다',
  '소득세법 제89조 제1항 제3호 / 동법 시행령 제160조 — 12억 초과분만 과세', () => {
    const at = calculateTransferIncomeTax({ salePrice: 12 * 억, purchasePrice: 5 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true });
    assert.equal(at.finalTax, 0, '양도가 12억 정확히 → 과세대상 0');
    const above = calculateTransferIncomeTax({ salePrice: 12 * 억 + 100 * 만, purchasePrice: 5 * 억, holdingYears: 10, livingYears: 10, isOneHouseExempt: true });
    assert.ok(above.finalTax >= 0 && above.finalTax < 100 * 만,
      `12억+100만에서 세액 ${above.finalTax}원. 초과분 100만원에 대한 세액이 초과분보다 클 수 없다.`);
  });

audit('D-4', '가업상속공제 경영연수 경계(10·20·30년)에서 ±1년이 정상 동작한다',
  '상증법 제18조의2 제1항', () => {
    const caps = {};
    for (const y of [9, 10, 19, 20, 29, 30, 31]) {
      caps[y] = calculateBusinessSuccession({ businessValue: 1000 * 억, managementYears: y }).deductionCap;
    }
    assert.equal(caps[9], 0);
    assert.equal(caps[10], 300 * 억);
    assert.equal(caps[19], 300 * 억);
    assert.equal(caps[20], 400 * 억);
    assert.equal(caps[29], 400 * 억);
    assert.equal(caps[30], 600 * 억);
    assert.equal(caps[31], 600 * 억);
  });

audit('D-5', '종부세 고령자·장기보유 세액공제 경계에서 공제율이 법정 표와 일치한다',
  '종부세법 제9조의2 — 고령자 60세 20%/65세 30%/70세 40%, 장기보유 5년 20%/10년 40%/15년 50%, 합계 한도 80%', () => {
    const rate = (age, hold) => calculateComprehensiveRealEstateTax({
      publicPrice: 30 * 억, numHouses: 1, isSingleHouse: true, ownerAge: age, holdingYears: hold,
    });
    assert.equal(rate(59, 0).ageCreditRate, 0);
    assert.equal(rate(60, 0).ageCreditRate, 0.2);
    assert.equal(rate(64, 0).ageCreditRate, 0.2);
    assert.equal(rate(65, 0).ageCreditRate, 0.3);
    assert.equal(rate(69, 0).ageCreditRate, 0.3);
    assert.equal(rate(70, 0).ageCreditRate, 0.4);
    assert.equal(rate(0, 4).holdingCreditRate, 0);
    assert.equal(rate(0, 5).holdingCreditRate, 0.2);
    assert.equal(rate(0, 10).holdingCreditRate, 0.4);
    assert.equal(rate(0, 15).holdingCreditRate, 0.5);
    assert.equal(rate(70, 15).creditRate, 0.8, '40% + 50% = 90% → 한도 80%');
  });

audit('D-5R', '2026 개편안 종부세 세액공제가 보유기간에서 거주기간으로 전환된다',
  "기획재정부 2026 세제개편안 (6) 1세대1주택 세액공제 개편 / 종부법 §9⑤·⑧·⑨ — 거주공제 5년 20%/10년 40%/15년 50%, 보유공제는 그 1/2(10%/20%/25%), '27년은 둘 중 높은 공제율, '28년 이후는 거주공제만. 연령공제와 합계 한도 80%는 좌동", () => {
    const at = (year, hold, live, age = 0) => calculateComprehensiveRealEstateTax({
      publicPrice: 30 * 억, numHouses: 1, isSingleHouse: true, isResident: true,
      ownerAge: age, holdingYears: hold, livingYears: live,
      basis: '2026개편안', basisYear: year,
    });

    // 거주공제 — 현행 보유공제와 같은 구간·같은 공제율이다.
    assert.equal(at('2028', 0, 4).holdingCreditRate, 0);
    assert.equal(at('2028', 0, 5).holdingCreditRate, 0.2);
    assert.equal(at('2028', 0, 10).holdingCreditRate, 0.4);
    assert.equal(at('2028', 0, 15).holdingCreditRate, 0.5);

    // 보유공제 = 거주공제의 1/2. '27년에만 살아 있다.
    assert.equal(at('2027', 5, 0).holdingCreditRate, 0.1);
    assert.equal(at('2027', 10, 0).holdingCreditRate, 0.2);
    assert.equal(at('2027', 15, 0).holdingCreditRate, 0.25);

    // '27년은 둘 중 높은 쪽. 거주 5년(20%)이 보유 15년의 1/2(25%)보다 낮으면 보유 쪽이 이긴다.
    assert.equal(at('2027', 15, 5).holdingCreditRate, 0.25, "'27년은 높은 공제율을 적용한다");
    assert.equal(at('2027', 0, 15).holdingCreditRate, 0.5, '거주공제가 높으면 거주공제');

    // '28년 이후는 거주공제만 — 보유기간이 길어도 공제로 이어지지 않는다.
    assert.equal(at('2028', 15, 0).holdingCreditRate, 0, "'28년 이후 보유공제는 폐지된다");
    assert.equal(at('2028', 15, 0).usesResidenceCreditOnly, true);

    // 연령공제는 좌동이고, 합계 한도 80%도 그대로다.
    assert.equal(at('2028', 0, 0, 70).ageCreditRate, 0.4);
    assert.equal(at('2028', 0, 15, 70).creditRate, 0.8, '40% + 50% = 90% → 한도 80%');
  });

// ══════════════════════════ E. 미구현 항목 노출 ══════════════════════════
// "결과가 틀렸다"가 아니라 "법에 있는데 계산에 없다"를 드러낸다.
// 상담 사전검토라도 금액이 큰 항목이 빠지면 결론이 뒤집힌다.

audit('E-1', '세대생략 상속·증여 할증이 법정 할증률로 반영된다',
  '상증법 제27조(상속 — 산출세액 × 취득비율 × 30%, 미성년자가 20억원 초과 취득 시 40%), '
  + '제57조(증여 — 산출세액의 30%/40%), 제69조(신고세액공제는 할증액을 포함한 금액 기준)', () => {
    // 상속 — 재산 전부를 세대생략으로 취득하면 할증은 산출세액의 30%가 된다.
    const base = { realEstate: 30 * 억, cash: 0, hasSpouse: false, numChildren: 1 };
    const plain = calculateInheritanceTax(base);
    const all = calculateInheritanceTax(Object.assign({}, base, { generationSkipShare: 30 * 억 }));
    assert.equal(all.generationSkipRatio, 1, '취득분이 과세가액 전부면 비율 1');
    assert.equal(all.generationSkipSurcharge, Math.round(plain.calculatedTax * 0.3),
      '세대생략 할증이 산출세액의 30%가 아니다');

    // 취득비율만큼만 가산된다 — 절반이면 할증도 절반이다.
    const half = calculateInheritanceTax(Object.assign({}, base, { generationSkipShare: 15 * 억 }));
    assert.equal(half.generationSkipSurcharge * 2, all.generationSkipSurcharge,
      '할증액이 세대생략 취득비율에 비례하지 않는다');

    // 미성년자 20억원 초과 취득이면 40%
    const minorOver = calculateInheritanceTax(Object.assign({}, base, {
      generationSkipShare: 25 * 억, isGenerationSkipMinor: true,
    }));
    const minorUnder = calculateInheritanceTax(Object.assign({}, base, {
      generationSkipShare: 20 * 억, isGenerationSkipMinor: true,
    }));
    assert.equal(minorOver.generationSkipRate, 0.4, '미성년자 20억원 초과 취득은 40%');
    assert.equal(minorUnder.generationSkipRate, 0.3, '20억원 이하(경계 포함)는 30%');

    // 신고세액공제는 할증액을 포함한 금액의 3%다 (제69조 제1항).
    assert.equal(all.reportDeduction, Math.round((all.calculatedTax + all.generationSkipSurcharge) * 0.03),
      '신고세액공제가 할증액을 포함하지 않았다');
    assert.equal(all.finalTax, all.calculatedTax + all.generationSkipSurcharge - all.reportDeduction);

    // 미지정이면 할증이 없어야 한다 — 기존 결과를 바꾸지 않는다.
    assert.equal(plain.generationSkipSurcharge, 0);

    // 증여 — 산출세액의 30%, 미성년자 20억원 초과는 40%
    const gPlain = calculateGiftTax({ giftValue: 5 * 억 });
    const gSkip = calculateGiftTax({ giftValue: 5 * 억, isGenerationSkip: true });
    assert.equal(gPlain.generationSkipSurcharge, 0);
    assert.equal(gSkip.generationSkipSurcharge, Math.round(gSkip.giftComputedTax * 0.3),
      '증여세 세대생략 할증이 산출세액의 30%가 아니다');
    const gMinor = calculateGiftTax({
      giftValue: 25 * 억, isGenerationSkip: true, isMinorRecipient: true,
    });
    assert.equal(gMinor.generationSkipRate, 0.4);

    // 배우자·기타친족에는 제57조가 적용되지 않는다 — 호출측이 세대생략으로 넘기지 않아야 하지만,
    // 넘어와도 20억원 판정 기준이 증여분이라는 계약은 지켜져야 한다.
    const gBurden = calculateGiftTax({
      giftValue: 25 * 억, assumedDebt: 6 * 억, isGenerationSkip: true, isMinorRecipient: true,
    });
    assert.equal(gBurden.generationSkipRate, 0.3,
      '부담부증여는 채무인수분을 뺀 증여분(19억)으로 20억원 기준을 판정해야 한다');
  });

excludedByOwner('E-2', '동거주택 상속공제가 반영된다',
  '상증법 제23조의2 — 10년 이상 동거한 무주택 상속인의 주택 상속가액 100%, 한도 6억원',
  '2026-08-21 소유자 결정 — 구현하면 계산식이 복잡해지고 사용자에게 혼란을 준다고 판단해 생략한다. '
  + '대신 상속세 결과의 「적용 기준 고지」에 미반영 사실을 표시해, 요건에 해당하는 상담에서는 '
  + '세액이 실제보다 크게 나온다는 점을 상담자가 알 수 있게 한다.',
  () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'calc.js'), 'utf8');
    assert.ok(/동거주택|cohabit/i.test(source),
      '동거주택 상속공제(상증법 제23조의2, 최대 6억)가 calc.js에 없다. 요건 충족 시 공제액이 일괄공제보다 커질 수 있다.');
  });

audit('E-3', '금융소득 2,000만원 경계에서 배당세액이 역전되지 않는다',
  '소득세법 제62조 — 금융소득이 2,000만원을 초과하면 비교과세로 "원천징수세율 적용분과 종합과세분 중 큰 금액"을 세액으로 한다. 따라서 경계를 넘을 때 세액이 줄어드는 일은 발생하지 않는다', () => {
    // 근로소득 과세표준을 여러 수준으로 두고 배당을 1만원 단위로 올려 본다.
    // 2,000만원 경계를 넘는 순간 세액이 줄어들면 비교과세가 빠졌다는 뜻이다.
    for (const earnedTaxBase of [0, 3000 * 만, 1 * 억, 5 * 억]) {
      let prev = null;
      for (let m = 1900; m <= 2200; m += 1) {
        const dividend = m * 만;
        const tax = calculateDividendTax(dividend, earnedTaxBase).total;
        if (prev !== null) {
          assert.ok(tax >= prev.tax - 1,
            `근로 과세표준 ${(earnedTaxBase / 만).toLocaleString()}만원 기준 — `
            + `배당 ${(prev.d / 만).toLocaleString()}만원(세액 ${Math.round(prev.tax).toLocaleString()}원) → `
            + `${(dividend / 만).toLocaleString()}만원(세액 ${Math.round(tax).toLocaleString()}원). `
            + `배당이 늘었는데 세액이 ${Math.round(prev.tax - tax).toLocaleString()}원 줄었다. `
            + '법정 비교과세(제62조)에는 이 역전이 없다.');
        }
        prev = { d: dividend, tax };
      }
    }
  });

// ══════════════════════════ F. 두 구현 차분 검증 ══════════════════════════
// oracle/calc.js(구버전)와 tax-review/calc.js(현행)에 같은 입력을 넣어
// 결과가 갈리는 지점을 찾는다. 어느 쪽이 맞는지는 법령으로 판단한다.
// 결정적 LCG를 써서 실행마다 같은 입력이 나오게 한다.

function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

audit('F-1', '두 상속세 구현이 같은 입력에 같은 결과를 낸다',
  '차분 검증 — oracle/calc.js vs tax-review/calc.js', () => {
    const rng = makeRng(20260820);
    const diffs = [];
    for (let i = 0; i < 3000; i += 1) {
      const input = {
        realEstate: Math.round(rng() * 60) * 억,
        cash: Math.round(rng() * 20) * 억,
        other: Math.round(rng() * 5) * 억,
        hasSpouse: rng() < 0.7,
        numChildren: Math.floor(rng() * 5),
        debt: Math.round(rng() * 10) * 억,
        financialDebt: Math.round(rng() * 3) * 억,
        funeralCost: Math.round(rng() * 3000) * 만,
        priorGift: Math.round(rng() * 5) * 억,
        minorYearsTotal: Math.floor(rng() * 20),
        numElderly: Math.floor(rng() * 3),
        disabledYearsTotal: Math.floor(rng() * 40),
      };
      const a = calculateInheritanceTax(input).finalTax;
      const b = legacy.calculateInheritanceTax(input).finalTax;
      if (a !== b) diffs.push({ input, current: a, legacy: b });
    }
    if (diffs.length > 0) {
      // 원인을 좁힌다 — 장례비를 법정 한도(1,000만원) 이내로 제한하면 차이가 사라지는지 본다.
      const rng2 = makeRng(20260820);
      let cappedDiffs = 0;
      for (let i = 0; i < 3000; i += 1) {
        const input = {
          realEstate: Math.round(rng2() * 60) * 억,
          cash: Math.round(rng2() * 20) * 억,
          other: Math.round(rng2() * 5) * 억,
          hasSpouse: rng2() < 0.7,
          numChildren: Math.floor(rng2() * 5),
          debt: Math.round(rng2() * 10) * 억,
          financialDebt: Math.round(rng2() * 3) * 억,
          funeralCost: Math.round(rng2() * 1000) * 만,   // 법정 한도 이내로만
          priorGift: Math.round(rng2() * 5) * 억,
          minorYearsTotal: Math.floor(rng2() * 20),
          numElderly: Math.floor(rng2() * 3),
          disabledYearsTotal: Math.floor(rng2() * 40),
        };
        if (calculateInheritanceTax(input).finalTax !== legacy.calculateInheritanceTax(input).finalTax) cappedDiffs += 1;
      }
      const sample = diffs.slice(0, 3).map((d) => {
        const i = d.input;
        return `    장례비 ${(i.funeralCost / 만).toLocaleString()}만 / 부동산 ${i.realEstate / 억}억 / 현금 ${i.cash / 억}억 `
          + `→ 현행 ${d.current.toLocaleString()} vs 구버전 ${d.legacy.toLocaleString()} (차이 ${(d.legacy - d.current).toLocaleString()}원)`;
      }).join('\n');
      assert.fail(`3,000건 중 ${diffs.length}건에서 두 구현의 상속세가 갈렸다.\n${sample}\n`
        + `  원인 분리: 장례비를 법정 한도(1,000만원) 이내로 제한하면 불일치 ${cappedDiffs}건.\n`
        + '  → 구버전(oracle/calc.js)에 장례비 한도가 없는 것이 유일한 원인이다. '
        + '상증법 시행령 제9조 제2항의 1,000만원 한도를 적용하는 현행(tax-review)이 옳다.');
    }
  });

audit('F-2', '배우자 실제 상속액을 0으로 명시했을 때 두 구현이 같게 동작한다',
  '차분 검증 — actualSpouseShare 경계 처리', () => {
    const input = { realEstate: 30 * 억, cash: 0, hasSpouse: true, numChildren: 2, actualSpouseShare: 0 };
    const a = calculateInheritanceTax(input);
    const b = legacy.calculateInheritanceTax(input);
    assert.equal(a.breakdown.spouseDeduction, b.spouseDeduction !== undefined ? b.spouseDeduction : b.breakdown.spouseDeduction,
      '현행은 actualSpouseShare=0을 "미입력"으로 보고 법정상속분을 쓰지만, '
      + '구버전은 0을 입력값으로 받아 하한 5억을 적용한다.');
  });

// ══════════════════════════ 요약 ══════════════════════════

console.log('\n' + '═'.repeat(78));
console.log(`감사 결과 — 통과 ${passCount}건 / 범위 제외 ${exclusions.length}건 / 결함 ${findings.length}건`);
console.log('═'.repeat(78));

// 제외 항목은 결함이 아니지만, 무엇을 계산하지 않는지가 이 도구의 유효 범위를 정한다.
for (const e of exclusions) {
  console.log(`\n[${e.id}] ${e.name} — 범위 제외`);
  console.log(`  근거: ${e.source}`);
  console.log(`  결정: ${e.decision}`);
  console.log(`  현재: ${e.message}`);
}
if (exclusions.length > 0) console.log('');

if (findings.length === 0) {
  console.log('법령 대조·불변식·경계값·차분 검증에서 결함이 발견되지 않았다.');
} else {
  for (const f of findings) {
    console.log(`\n[${f.id}] ${f.name}`);
    console.log(`  근거: ${f.source}`);
    console.log(`  내용: ${f.message}`);
  }
  console.log(`\n총 ${findings.length}건. 상세는 위 FAIL 출력을 참고한다.`);
  process.exitCode = 1;
}
