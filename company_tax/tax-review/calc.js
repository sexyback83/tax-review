'use strict';
// 세금진단 사전검토 — 8개 세목 계산 모듈
//
// 계약 (프로젝트 원칙 제1·2조):
//   · 모든 금액은 원(KRW) 단위다. 만원↔원 환산은 화면 계층 전용 책임이다.
//   · 모든 함수는 순수 함수이며 DOM·window·네트워크·저장소를 참조하지 않는다.
//   · 입력값 검증(음수·비수치)은 호출측(화면 계층) 책임이다.
//   · 반올림은 각 오케스트레이션 함수에서 출력 필드에 1회만 적용한다.
//     중간 공제·비율 계산은 반올림하지 않는다.
//   · "심화" 전용 인자는 모두 중립 기본값을 가진다. 간편 모드는 인자를 넘기지 않는 것만으로 동작한다.
//     예외적으로 아래 두 값은 간편 모드의 법정 기본 가정이므로 기본값이 중립이 아니다.
//       - 비상장주식: 최대주주 20% 할증 적용 (hasMaxShareholderPremium = true)
//       - 급여·배당: 법인세율 20%, 4대보험 반영 (corporateTaxRate = 0.20, includeInsurance = true)

const 억 = 100000000;
const 만 = 10000;

// ══════════════════════════ 공통 — 누진세율 ══════════════════════════
// 구간별 한계세율을 누적한다. upTo는 해당 구간의 상한(이하)이다.

// 상속세및증여세법 제26조
const INHERITANCE_TAX_BRACKETS = [
  { upTo: 1 * 억, rate: 0.10 },
  { upTo: 5 * 억, rate: 0.20 },
  { upTo: 10 * 억, rate: 0.30 },
  { upTo: 30 * 억, rate: 0.40 },
  { upTo: Infinity, rate: 0.50 },
];

// 소득세법 제55조 (2023년 개정 8단계)
const INCOME_TAX_BRACKETS = [
  { upTo: 1400 * 만, rate: 0.06 },
  { upTo: 5000 * 만, rate: 0.15 },
  { upTo: 8800 * 만, rate: 0.24 },
  { upTo: 15000 * 만, rate: 0.35 },
  { upTo: 30000 * 만, rate: 0.38 },
  { upTo: 50000 * 만, rate: 0.40 },
  { upTo: 100000 * 만, rate: 0.42 },
  { upTo: Infinity, rate: 0.45 },
];

// 종합부동산세법 제9조 제1항 — 2주택 이하
const JONGBU_TAX_BRACKETS_GENERAL = [
  { upTo: 3 * 억, rate: 0.005 },
  { upTo: 6 * 억, rate: 0.007 },
  { upTo: 12 * 억, rate: 0.010 },
  { upTo: 25 * 억, rate: 0.013 },
  { upTo: 50 * 억, rate: 0.015 },
  { upTo: 94 * 억, rate: 0.020 },
  { upTo: Infinity, rate: 0.027 },
];

// 종합부동산세법 제9조 제1항 — 3주택 이상 중과
// 중과는 과세표준 12억원 초과분부터 갈린다. 3억~12억 구간(0.7%·1.0%)은 2주택 이하와 같다.
const JONGBU_TAX_BRACKETS_MULTI = [
  { upTo: 3 * 억, rate: 0.005 },
  { upTo: 6 * 억, rate: 0.007 },
  { upTo: 12 * 억, rate: 0.010 },
  { upTo: 25 * 억, rate: 0.020 },
  { upTo: 50 * 억, rate: 0.030 },
  { upTo: 94 * 억, rate: 0.040 },
  { upTo: Infinity, rate: 0.050 },
];

// 2026 개편안 §(5) — 주택분 종부세 세율을 주택가액 기준으로 일원화 (종부법 제9조 제1항·제2항)
// 구간 경계(3/6/12/25/50/94억)는 현행과 같고, 세율만 바뀐다.
// '27년은 주택수 차등을 남겨 두고 6~12억 구간과 12억 초과 각 구간을 올린다.
const JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL = [
  { upTo: 3 * 억, rate: 0.005 },
  { upTo: 6 * 억, rate: 0.007 },
  { upTo: 12 * 억, rate: 0.013 },
  { upTo: 25 * 억, rate: 0.015 },
  { upTo: 50 * 억, rate: 0.020 },
  { upTo: 94 * 억, rate: 0.027 },
  { upTo: Infinity, rate: 0.035 },
];
const JONGBU_TAX_BRACKETS_REFORM_2027_MULTI = [
  { upTo: 3 * 억, rate: 0.005 },
  { upTo: 6 * 억, rate: 0.007 },
  { upTo: 12 * 억, rate: 0.013 },
  { upTo: 25 * 억, rate: 0.020 },
  { upTo: 50 * 억, rate: 0.030 },
  { upTo: 94 * 억, rate: 0.040 },
  { upTo: Infinity, rate: 0.050 },
];
// '28년 이후 — 주택수 차등 폐지. 가액만 보는 단일 표다.
// 수치는 '27년 3주택 이상 표와 우연히 같지만, 뜻이 다르므로(차등 폐지) 따로 적는다.
// 한쪽만 개정될 때 다른 쪽이 조용히 끌려가지 않게 하기 위함이다.
const JONGBU_TAX_BRACKETS_REFORM_2028 = [
  { upTo: 3 * 억, rate: 0.005 },
  { upTo: 6 * 억, rate: 0.007 },
  { upTo: 12 * 억, rate: 0.013 },
  { upTo: 25 * 억, rate: 0.020 },
  { upTo: 50 * 억, rate: 0.030 },
  { upTo: 94 * 억, rate: 0.040 },
  { upTo: Infinity, rate: 0.050 },
];

// ══════════════════════════ 공통 — 적용 기준 ══════════════════════════
// 2026 세제개편안은 입법 확정 전이며 시행도 '27.1.1.~(가업상속공제는 '27.7.1.~)이다.
// 따라서 기본값은 항상 현행이며, 개편안은 호출측이 명시적으로 선택해야 적용된다 (제약 C5).
const BASIS_CURRENT = '현행';
const BASIS_REFORM_2026 = '2026개편안';
const BASIS_OPTIONS = [BASIS_CURRENT, BASIS_REFORM_2026];
// 개편안 항목 다수가 연도별로 단계 시행되므로 기준연도를 함께 받는다.
const BASIS_YEAR_2027 = '2027';
const BASIS_YEAR_2028 = '2028';
const BASIS_YEAR_2029 = '2029';

function calculateTieredTax(taxBase, brackets) {
  if (taxBase <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const { upTo, rate } of brackets) {
    if (taxBase <= floor) break;
    tax += (Math.min(taxBase, upTo) - floor) * rate;
    floor = upTo;
  }
  return tax;
}

// ══════════════════════════ 1. 상속세 ══════════════════════════
// 근거: 상속세및증여세법 제18~23조(공제), 제26조(세율), 제69조(신고세액공제)

const LUMP_SUM_DEDUCTION = 5 * 억;        // 일괄공제
const BASIC_DEDUCTION = 2 * 억;           // 기초공제
const CHILD_DEDUCTION = 5000 * 만;        // 자녀 1인당
const MINOR_DEDUCTION_PER_YEAR = 1000 * 만;
const ELDERLY_DEDUCTION = 5000 * 만;      // 65세 이상 1인당
const DISABLED_DEDUCTION_PER_YEAR = 1000 * 만;
const SPOUSE_DEDUCTION_MIN = 5 * 억;
const SPOUSE_DEDUCTION_MAX = 30 * 억;
const FUNERAL_COST_LIMIT = 1000 * 만;     // 장례비 인정 한도
const MINOR_AGE_LIMIT = 19;               // 상증법 제20조 제1항 제2호 — 19세 미만이 미성년자

// ── 장애인공제 기대여명 (상속세및증여세법 시행령 제18조) ──
// 상증령 제18조는 장애인공제의 기대여명을 통계법 제18조에 따라 통계청장이 승인·고시하는
// 통계표의 성별·연령별 기대여명 연수로 정한다. 세법이 정한 상수가 아니라 통계표 조회값이다.
//
//   통계표   : 완전생명표(1세별) — 통계표ID DT_1B42
//   출처     : 「생명표」, 국가데이터처 (KOSIS)
//   기준연도 : 2024년
//   내려받음 : 2026-08-20
//
// 인덱스 = 나이(세), 값 = 기대여명(년). 마지막 원소(100)는 통계표의 '100세 이상' 구간이다.
// 표 값을 그대로 사용하며 임의의 반올림·절상을 적용하지 않는다.
// 표가 갱신되면 아래 두 배열과 LIFE_TABLE_YEAR를 함께 바꾼다.
const LIFE_TABLE_YEAR = 2024;

const LIFE_EXPECTANCY_MALE = [
  80.80831, 80.01964, 79.03906, 78.05291, 77.06284, 76.07059, 75.07728, 74.08338, 73.08858, 72.09308,   // 0~9세
  71.09764, 70.10301, 69.10956, 68.11746, 67.12680, 66.13748, 65.14961, 64.16364, 63.17937, 62.19678,   // 10~19세
  61.21548, 60.23506, 59.25591, 58.27850, 57.30318, 56.32985, 55.35843, 54.38874, 53.42053, 52.45359,   // 20~29세
  51.48740, 50.52188, 49.55741, 48.59370, 47.63061, 46.66801, 45.70640, 44.74667, 43.78977, 42.83588,   // 30~39세
  41.88469, 40.93583, 39.98950, 39.04588, 38.10534, 37.16830, 36.23474, 35.30479, 34.37930, 33.45930,   // 40~49세
  32.54503, 31.63630, 30.73278, 29.83436, 28.94181, 28.05609, 27.17753, 26.30546, 25.43841, 24.57701,   // 50~59세
  23.72133, 22.87206, 22.02961, 21.19429, 20.36520, 19.54125, 18.72215, 17.90984, 17.10648, 16.31314,   // 60~69세
  15.53174, 14.76424, 14.01167, 13.27480, 12.55155, 11.84282, 11.14666, 10.46405, 9.79599, 9.14636,   // 70~79세
  8.52429, 7.93504, 7.37989, 6.85632, 6.36071, 5.89500, 5.45892, 5.05174, 4.67260, 4.32050,   // 80~89세
  3.99434, 3.69292, 3.41501, 3.15933, 2.92457, 2.70945, 2.51270, 2.33307, 2.16938, 2.02049,   // 90~99세
  1.88532,   // 100세 이상
];

const LIFE_EXPECTANCY_FEMALE = [
  86.57869, 85.76390, 84.78443, 83.79754, 82.80582, 81.81214, 80.81838, 79.82493, 78.83103, 77.83592,   // 0~9세
  76.83996, 75.84359, 74.84786, 73.85365, 72.86148, 71.87129, 70.88283, 69.89633, 68.91176, 67.92868,   // 10~19세
  66.94643, 65.96442, 64.98308, 64.00211, 63.02170, 62.04137, 61.06073, 60.08051, 59.10140, 58.12348,   // 20~29세
  57.14642, 56.16963, 55.19265, 54.21540, 53.23846, 52.26206, 51.28669, 50.31318, 49.34212, 48.37362,   // 30~39세
  47.40789, 46.44450, 45.48271, 44.52162, 43.56025, 42.59883, 41.63850, 40.68041, 39.72511, 38.77232,   // 40~49세
  37.82141, 36.87220, 35.92521, 34.98017, 34.03619, 33.09265, 32.14944, 31.20742, 30.26708, 29.32873,   // 50~59세
  28.39179, 27.45617, 26.52297, 25.59347, 24.66862, 23.74812, 22.83097, 21.91739, 21.00840, 20.10555,   // 60~69세
  19.21024, 18.32296, 17.44464, 16.57608, 15.71818, 14.87313, 14.04125, 13.22448, 12.42447, 11.64452,   // 70~79세
  10.88959, 10.16237, 9.46433, 8.79763, 8.16298, 7.56279, 6.99663, 6.46466, 5.96671, 5.50237,   // 80~89세
  5.07094, 4.67151, 4.30297, 3.96405, 3.65336, 3.36940, 3.11065, 2.87555, 2.66254, 2.47012,   // 90~99세
  2.29683,   // 100세 이상
];

// 성별은 '남' / '여'. 표 범위를 벗어난 나이는 양 끝 값으로 절단한다.
function lookupLifeExpectancy(sex, age) {
  const table = sex === '여' ? LIFE_EXPECTANCY_FEMALE : LIFE_EXPECTANCY_MALE;
  const index = Math.min(Math.max(0, Math.floor(age)), table.length - 1);
  return table[index];
}

// 미성년자공제의 잔여연수 합계. 나이별로 19세까지 남은 연수를 더한다.
// 장애인공제의 기대여명은 위 lookupLifeExpectancy로 조회한다.
function calculateMinorYearsTotal(ages) {
  return ages.reduce((sum, age) => sum + Math.max(0, MINOR_AGE_LIMIT - age), 0);
}

// 미성년자 판정 — 증여재산공제(직계존비속 미성년 2,000만원)에도 같은 기준을 쓴다.
function isMinorAge(age) {
  return age !== null && age < MINOR_AGE_LIMIT;
}
const FINANCIAL_DEDUCTION_MIN = 2000 * 만;
const FINANCIAL_DEDUCTION_MAX = 2 * 억;
const REPORT_CREDIT_RATE = 0.03;          // 신고세액공제

// ── 세대생략 할증 (상증법 제27조 상속 · 제57조 증여) ──
// 피상속인·증여자의 자녀를 제외한 직계비속(손자녀 등)이 취득하면 산출세액에 30%를 가산한다.
// 그 취득자가 미성년자이고 취득재산이 20억원을 초과하면 40%다.
//
// 대습상속·대습증여(민법 제1001조)는 자의로 세대를 건너뛴 것이 아니므로 할증 대상이 아니다.
// 그 판정은 상담자가 하므로 이 모듈은 "세대생략인지"를 인자로만 받는다 —
// 대습이면 호출측이 세대생략으로 넘기지 않는다.
const GENERATION_SKIP_RATE = 0.30;
const GENERATION_SKIP_RATE_MINOR = 0.40;
const GENERATION_SKIP_MINOR_THRESHOLD = 20 * 억;

function generationSkipSurchargeRate(acquiredValue, isMinor) {
  if (acquiredValue <= 0) return 0;
  return isMinor && acquiredValue > GENERATION_SKIP_MINOR_THRESHOLD
    ? GENERATION_SKIP_RATE_MINOR
    : GENERATION_SKIP_RATE;
}

function calculateInheritanceTax({
  realEstate,
  cash,
  other = 0,
  hasSpouse,
  numChildren,
  debt = 0,
  financialDebt = 0,
  funeralCost = 0,
  priorGift = 0,
  actualSpouseShare = null,
  minorYearsTotal = 0,
  numElderly = 0,
  disabledYearsTotal = 0,
  generationSkipShare = 0,          // 손자녀 등 세대생략 상속인·수유자가 받은 재산가액
  isGenerationSkipMinor = false,    // 그 취득자가 미성년자인지
}) {
  const totalEstate = realEstate + cash + other;
  const taxableValue = totalEstate - debt - Math.min(funeralCost, FUNERAL_COST_LIMIT) + priorGift;

  // 기초+인적공제 vs 일괄공제 — 유리한 쪽을 적용한다.
  // 배우자 단독상속(자녀 없음)은 일괄공제를 선택할 수 없다.
  const personalDeduction = BASIC_DEDUCTION
    + numChildren * CHILD_DEDUCTION
    + minorYearsTotal * MINOR_DEDUCTION_PER_YEAR
    + numElderly * ELDERLY_DEDUCTION
    + disabledYearsTotal * DISABLED_DEDUCTION_PER_YEAR;
  const isSpouseSoleHeir = hasSpouse && numChildren === 0;
  const lumpSumDeduction = isSpouseSoleHeir ? 0 : LUMP_SUM_DEDUCTION;
  const standardDeduction = Math.max(lumpSumDeduction, personalDeduction);

  // 배우자상속공제 — min(실제 상속액, 법정상속분, 30억), 5억 미만은 5억으로 절상
  //
  // actualSpouseShare 계약: null이면 "미입력"이라 법정상속분을 가정하고, 숫자면 그 값을 쓴다.
  // 0은 미입력이 아니라 "배우자가 실제로 상속받은 금액이 0"이다. 상증법 제19조 제1항은
  // 실제 상속받은 금액이 없거나 5억원 미만이면 5억원을 공제하도록 정하므로 0에서도 5억이 나온다.
  // 화면 계층은 빈 칸과 0을 구별할 수 없어 둘 다 null로 넘긴다 — 그 선택은 화면의 책임이다.
  const statutoryShare = hasSpouse ? taxableValue * 1.5 / (1.5 + numChildren) : 0;
  const spouseShare = actualSpouseShare !== null ? actualSpouseShare : statutoryShare;
  const spouseDeduction = hasSpouse
    ? Math.max(SPOUSE_DEDUCTION_MIN, Math.min(spouseShare, statutoryShare, SPOUSE_DEDUCTION_MAX))
    : 0;

  // 금융재산상속공제 — 순금융재산의 20%. 20%가 2천만 미만이면 min(순금융재산, 2천만)
  const netFinancialAsset = Math.max(0, cash - financialDebt);
  const twentyPercent = netFinancialAsset * 0.2;
  const financialDeduction = twentyPercent < FINANCIAL_DEDUCTION_MIN
    ? Math.min(netFinancialAsset, FINANCIAL_DEDUCTION_MIN)
    : Math.min(twentyPercent, FINANCIAL_DEDUCTION_MAX);

  const totalDeduction = standardDeduction + spouseDeduction + financialDeduction;
  const taxBase = Math.max(0, Math.round(taxableValue - totalDeduction));
  const calculatedTax = Math.round(calculateTieredTax(taxBase, INHERITANCE_TAX_BRACKETS));

  // 세대생략 할증 (상증법 제27조) — 산출세액 × (세대생략 취득분 / 상속재산) × 할증률.
  // 분모는 상속세 과세가액을 쓴다. 조문의 "상속재산"은 제13조에 따라 가산한 사전증여재산 중
  // 상속인·수유자가 받은 것을 포함하므로, 사전증여를 더한 과세가액이 그 취지에 가깝다.
  const generationSkipShareCapped = Math.max(0, Math.min(generationSkipShare, taxableValue));
  const generationSkipRatio = taxableValue > 0 ? generationSkipShareCapped / taxableValue : 0;
  const generationSkipRate = generationSkipSurchargeRate(generationSkipShareCapped, isGenerationSkipMinor);
  const generationSkipSurcharge = Math.round(calculatedTax * generationSkipRatio * generationSkipRate);

  // 신고세액공제는 할증액을 포함한 금액을 기준으로 계산한다 (상증법 제69조 제1항).
  const taxBeforeCredit = calculatedTax + generationSkipSurcharge;
  const reportDeduction = Math.round(taxBeforeCredit * REPORT_CREDIT_RATE);

  return {
    totalEstate,
    taxableValue,
    taxBase,
    calculatedTax,
    generationSkipShare: generationSkipShareCapped,
    generationSkipRatio,
    generationSkipRate,
    generationSkipSurcharge,
    taxBeforeCredit,
    reportDeduction,
    finalTax: taxBeforeCredit - reportDeduction,
    breakdown: {
      lumpSumDeduction,
      personalDeduction,
      standardDeduction,
      statutoryShare,
      spouseShare,
      spouseDeduction,
      netFinancialAsset,
      financialDeduction,
      totalDeduction,
    },
  };
}

// ══════════════════════════ 2. 증여세 (부담부증여) ══════════════════════════
// 근거: 상속세및증여세법 제47조(합산과세)·제53조(증여재산공제)·제26조(세율)
//       소득세법 제88조 — 수증자가 인수한 채무액은 유상양도로 본다

// ── 2차 상속 (배우자 사망) 개산 ──
// 1차 상속에서 배우자상속공제를 받은 만큼의 재산이 배우자에게 남고, 배우자가 사망하면
// 그 재산이 다시 상속세 과세대상이 된다. 배우자상속공제는 세금을 없애는 것이 아니라
// 뒤로 미루는 장치라는 점이 상담의 핵심 논점이므로 1차·2차를 함께 산출한다.
//
// 2차 상속에는 배우자가 없으므로 배우자상속공제가 적용되지 않고, 상속인은 자녀뿐이다.
// 배우자에게 이전된 재산의 자산 구성(부동산·금융·기타)은 알 수 없으므로 기타자산으로 본다
// — 금융재산상속공제를 적용하지 않는 쪽이 보수적(세액 과대)이다.
// 2차 상속재산에 더할 금액은 배우자상속공제액이 아니라 **배우자가 실제로 취득하는 재산**이다.
// 공제액 = max(5억, min(실제취득액, 법정상속분, 30억)) 이므로 상한·하한에 걸리면 취득액과 어긋나고,
// 공제액을 이전 재산으로 쓰면 양방향으로 틀린다.
//   · 법정상속분이 30억을 넘으면 취득액 > 공제액  → 2차 세액 과소계상
//   · 취득액이 5억 미만이면       취득액 < 공제액  → 2차 세액 과대계상
//
// spouseAcquired 계약: null이면 "미입력"이라 법정상속분을 취득한다고 가정한다.
// 0은 미입력이 아니라 "배우자가 실제로 아무것도 취득하지 않음"이다.
function calculateSecondaryInheritance({
  first,                      // calculateInheritanceTax의 1차 상속 결과
  spouseAcquired = null,      // 배우자가 1차에서 실제로 취득하는 재산가액
  spouseOwnAsset = 0,         // 배우자 고유재산 (1차 상속과 무관하게 배우자가 이미 가진 재산)
  spouseOwnFinancial = 0,     // 그중 금융자산
  numChildren,
}) {
  const statutoryShare = first.breakdown.statutoryShare;
  const spouseDeduction = first.breakdown.spouseDeduction;
  // 배우자가 있으면 공제액은 하한 5억으로 반드시 0보다 크다. 0이면 배우자가 없는 경우다.
  const hasSpouse = spouseDeduction > 0;
  const usesStatutoryShare = spouseAcquired === null;
  const transferred = !hasSpouse ? 0
    : (usesStatutoryShare ? statutoryShare : Math.max(0, spouseAcquired));

  const ownFinancial = Math.min(Math.max(0, spouseOwnFinancial), Math.max(0, spouseOwnAsset));
  const second = calculateInheritanceTax({
    realEstate: 0,
    cash: ownFinancial,
    other: Math.max(0, spouseOwnAsset - ownFinancial) + transferred,
    hasSpouse: false,
    numChildren: numChildren,
  });
  return {
    transferred,
    statutoryShare,
    spouseDeduction,
    usesStatutoryShare: hasSpouse && usesStatutoryShare,
    spouseOwnAsset: Math.round(spouseOwnAsset),
    spouseOwnFinancial: Math.round(ownFinancial),
    secondEstate: second.totalEstate,
    second,
    firstTax: first.finalTax,
    secondTax: second.finalTax,
    totalTax: first.finalTax + second.finalTax,
  };
}

const GIFT_DEDUCTION_SPOUSE = 6 * 억;
const GIFT_DEDUCTION_LINEAL = 5000 * 만;
const GIFT_DEDUCTION_LINEAL_MINOR = 2000 * 만;
const GIFT_DEDUCTION_RELATIVE = 1000 * 만;
const TRANSFER_BASIC_DEDUCTION = 250 * 만;   // 양도소득 기본공제
const LOCAL_INCOME_TAX_RATE = 0.1;           // 지방소득세

function calculateGiftTax({
  giftValue,
  assumedDebt = 0,
  acquisitionCost = 0,
  relation = '직계존비속',
  isMinorRecipient = false,
  priorGift = 0,
  holdingYears = 0,
  applyRelativeDeduction = true,
  isGenerationSkip = false,   // 수증자가 증여자의 자녀가 아닌 직계비속(손자녀 등)인지
}) {
  // 증여재산공제는 10년 내 동일 관계에서 이미 한도를 소진했으면 적용받지 못한다.
  // 그 판정은 상담자가 하므로 적용 여부를 인자로 받는다.
  const fullRelativeDeduction = relation === '배우자' ? GIFT_DEDUCTION_SPOUSE
    : relation === '직계존비속' ? (isMinorRecipient ? GIFT_DEDUCTION_LINEAL_MINOR : GIFT_DEDUCTION_LINEAL)
      : GIFT_DEDUCTION_RELATIVE;
  const relativeDeduction = applyRelativeDeduction ? fullRelativeDeduction : 0;

  // 채무 인수액은 증여가 아니라 유상양도이므로 증여재산에서 제외한다.
  const debtAssumed = Math.min(assumedDebt, giftValue);
  const giftPortion = giftValue - debtAssumed;

  // 10년 내 사전증여는 합산과세하고, 사전증여분 상당 세액을 차감한다.
  const giftTaxBase = Math.max(0, giftPortion + priorGift - relativeDeduction);
  const priorGiftBase = Math.max(0, priorGift - relativeDeduction);
  const priorGiftTaxRaw = calculateTieredTax(priorGiftBase, INHERITANCE_TAX_BRACKETS);
  const giftComputedTax = calculateTieredTax(giftTaxBase, INHERITANCE_TAX_BRACKETS);

  // 세대생략 할증 (상증법 제57조) — 산출세액에 30%(미성년자가 20억원 초과 취득 시 40%)를 가산한다.
  // 20억원 기준은 실제로 증여받는 재산으로 판정하므로, 부담부증여는 채무인수분을 뺀 증여분을 쓴다.
  const generationSkipRate = isGenerationSkip
    ? generationSkipSurchargeRate(giftPortion, isMinorRecipient) : 0;
  const generationSkipSurcharge = giftComputedTax * generationSkipRate;

  // 신고세액공제는 할증액을 포함하고 기납부세액을 뺀 금액 기준이다 (상증법 제69조 제2항).
  const giftTaxRaw = Math.max(0, giftComputedTax + generationSkipSurcharge - priorGiftTaxRaw)
    * (1 - REPORT_CREDIT_RATE);

  // 양도세 부분 — 채무 인수액에 대응하는 취득가액만 차감한다.
  const acquisitionShare = giftValue > 0 ? acquisitionCost * debtAssumed / giftValue : 0;
  const transferGain = Math.max(0, debtAssumed - acquisitionShare);
  const longTermRate = holdingYears >= 3 ? Math.min(0.3, 0.02 * holdingYears) : 0;
  const transferTaxBase = Math.max(0, transferGain * (1 - longTermRate) - TRANSFER_BASIC_DEDUCTION);
  const transferTaxRaw = calculateTieredTax(transferTaxBase, INCOME_TAX_BRACKETS) * (1 + LOCAL_INCOME_TAX_RATE);

  return {
    giftValue,
    debtAssumed,
    giftPortion,
    applyRelativeDeduction,
    fullRelativeDeduction,
    relativeDeduction,
    giftTaxBase,
    giftComputedTax: Math.round(giftComputedTax),
    generationSkipRate,
    generationSkipSurcharge: Math.round(generationSkipSurcharge),
    priorGiftTax: Math.round(priorGiftTaxRaw),
    giftTax: Math.round(giftTaxRaw),
    acquisitionShare: Math.round(acquisitionShare),
    transferGain: Math.round(transferGain),
    longTermRate,
    transferTaxBase: Math.round(transferTaxBase),
    transferTax: Math.round(transferTaxRaw),
    total: Math.round(giftTaxRaw + transferTaxRaw),
  };
}

// ══════════════════════════ 3. 종합부동산세 ══════════════════════════
// 근거: 종합부동산세법 제8조(과세표준)·제9조(세율)·제9조의2(세액공제), 농어촌특별세법 제5조

const JONGBU_DEDUCTION_SINGLE = 12 * 억;   // 1세대1주택 단독명의
const JONGBU_DEDUCTION_GENERAL = 9 * 억;
const FAIR_MARKET_RATIO = 0.6;             // 공정시장가액비율
const JONGBU_CREDIT_LIMIT = 0.8;           // 고령자+장기보유 합계 한도
const RURAL_TAX_RATE = 0.2;                // 농어촌특별세

// 2026 개편안 §4.2 — 기본공제금액 조정
const JONGBU_DEDUCTION_REFORM_SINGLE_RESIDENT = 14 * 억;
const JONGBU_DEDUCTION_REFORM_SINGLE_NONRESIDENT = 9 * 억;
const JONGBU_DEDUCTION_REFORM_GENERAL_BASE = 4 * 억;        // 정액 기본
const JONGBU_DEDUCTION_REFORM_GENERAL_RESIDENCE = 5 * 억;   // 거주비중 안분분
// 2026 개편안 §4.2 — 공정시장가액비율 상향. '28년 80%는 3주택 이상·조정대상지역에 한하고
// 1세대1주택은 제외된다. 그 외는 70%까지.
const FAIR_MARKET_RATIO_REFORM = { [BASIS_YEAR_2027]: 0.7, [BASIS_YEAR_2028]: 0.7 };
const FAIR_MARKET_RATIO_REFORM_HEAVY = { [BASIS_YEAR_2027]: 0.7, [BASIS_YEAR_2028]: 0.8 };
// 2026 개편안 §4.2 — 1세대1주택 세액공제 금액 한도 신설
const JONGBU_CREDIT_AMOUNT_CAP_REFORM = { [BASIS_YEAR_2027]: 800 * 만, [BASIS_YEAR_2028]: 600 * 만 };
// 2026 개편안 §(6) — 보유기간 세액공제를 거주기간 세액공제로 전환 (종부법 제9조 제5항·제8항·제9항)
// 거주공제율은 현행 보유공제율과 같은 표(5년 20% / 10년 40% / 15년 50%)이고,
// 보유공제율은 그 1/2 이다 (자료 표: 10% / 20% / 25%).
//   '27년    — 보유공제와 거주공제 중 높은 공제율
//   '28년 이후 — 거주공제만
const JONGBU_HOLDING_CREDIT_REFORM_RATIO = 0.5;

function calculateComprehensiveRealEstateTax({
  publicPrice,
  numHouses = 1,
  isSingleHouse = true,
  ownerAge = 0,
  holdingYears = 0,
  propertyTaxPaid = 0,
  basis = BASIS_CURRENT,
  basisYear = BASIS_YEAR_2027,
  isResident = true,       // 개편안 — 1세대1주택 거주 여부로 기본공제가 갈린다
  residentRatio = 0,       // 개편안 — 다주택 기본공제 중 5억원의 거주비중 안분율(%)
  livingYears = 0,         // 개편안 — 세액공제가 보유기간에서 거주기간으로 전환
  isAdjustedArea = false,  // 개편안 — '28년 공정시장가액비율 80% 판정
}) {
  const isReform = basis === BASIS_REFORM_2026;
  const isMultiHouse = numHouses >= 3;

  // 1세대1주택자는 주택 1채만 소유한 경우다 (종부세법 제8조 제1항).
  // 주택 수가 2 이상인데 1세대1주택이 함께 들어오면 모순이므로 1세대1주택 취급을 배제한다.
  // 배제하지 않으면 기본공제 12억과 다주택 중과세율이 동시에 적용된다.
  // 양도세가 모순 입력에서 중과를 배제하는 것과 같은 방어다.
  const singleHouseSuppressed = isSingleHouse && numHouses > 1;
  const treatAsSingleHouse = isSingleHouse && !singleHouseSuppressed;

  const basicDeduction = !isReform
    ? (treatAsSingleHouse ? JONGBU_DEDUCTION_SINGLE : JONGBU_DEDUCTION_GENERAL)
    : treatAsSingleHouse
      ? (isResident ? JONGBU_DEDUCTION_REFORM_SINGLE_RESIDENT : JONGBU_DEDUCTION_REFORM_SINGLE_NONRESIDENT)
      : JONGBU_DEDUCTION_REFORM_GENERAL_BASE
        + JONGBU_DEDUCTION_REFORM_GENERAL_RESIDENCE * Math.min(100, Math.max(0, residentRatio)) / 100;

  const usesHeavyRatio = isReform && !treatAsSingleHouse && (isMultiHouse || isAdjustedArea);
  const fairMarketRatio = !isReform ? FAIR_MARKET_RATIO
    : (usesHeavyRatio ? FAIR_MARKET_RATIO_REFORM_HEAVY : FAIR_MARKET_RATIO_REFORM)[basisYear];

  const taxBase = Math.max(0, (publicPrice - basicDeduction) * fairMarketRatio);
  // 개편안은 주택수 기준 차등세율을 단계적으로 폐지한다.
  // '27년은 차등을 남기고, '28년 이후는 가액만 보는 단일 표로 간다.
  const isFirstReformYear = basisYear === BASIS_YEAR_2027;
  const brackets = !isReform
    ? (isMultiHouse ? JONGBU_TAX_BRACKETS_MULTI : JONGBU_TAX_BRACKETS_GENERAL)
    : isFirstReformYear
      ? (isMultiHouse ? JONGBU_TAX_BRACKETS_REFORM_2027_MULTI : JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL)
      : JONGBU_TAX_BRACKETS_REFORM_2028;
  const grossTax = calculateTieredTax(taxBase, brackets);

  // 고령자·장기보유 세액공제는 1세대1주택자에게만 적용된다.
  const ageCreditRate = !treatAsSingleHouse ? 0
    : ownerAge >= 70 ? 0.4 : ownerAge >= 65 ? 0.3 : ownerAge >= 60 ? 0.2 : 0;

  // 기간 구간별 공제율표. 현행 보유공제와 개편안 거주공제가 같은 표를 쓴다.
  const termRate = (years) => years >= 15 ? 0.5 : years >= 10 ? 0.4 : years >= 5 ? 0.2 : 0;

  // 개편안은 보유공제를 거주공제로 전환한다.
  //   '27년    — 보유공제(거주공제의 1/2)와 거주공제 중 높은 쪽
  //   '28년 이후 — 거주공제만. 보유기간이 아무리 길어도 거주하지 않았으면 공제가 없다.
  const holdingCreditRate = !treatAsSingleHouse ? 0
    : !isReform ? termRate(holdingYears)
      : isFirstReformYear
        ? Math.max(termRate(holdingYears) * JONGBU_HOLDING_CREDIT_REFORM_RATIO, termRate(livingYears))
        : termRate(livingYears);
  // 공제 판정에 실제로 쓴 기간. '27년은 두 기간 중 높은 공제율을 낸 쪽이다.
  const creditBasisYears = !isReform ? holdingYears
    : isFirstReformYear
      ? (termRate(holdingYears) * JONGBU_HOLDING_CREDIT_REFORM_RATIO > termRate(livingYears) ? holdingYears : livingYears)
      : livingYears;
  const creditRate = Math.min(JONGBU_CREDIT_LIMIT, ageCreditRate + holdingCreditRate);

  // 개편안은 세액공제에 금액 한도를 신설했다.
  const creditAmountCap = isReform ? JONGBU_CREDIT_AMOUNT_CAP_REFORM[basisYear] : Infinity;
  const creditUncapped = grossTax * creditRate;
  const creditAmount = Math.min(creditUncapped, creditAmountCap);
  const isCreditCapped = creditUncapped > creditAmountCap;

  const netTax = Math.max(0, grossTax - creditAmount - propertyTaxPaid);
  const ruralTaxRaw = netTax * RURAL_TAX_RATE;

  return {
    basis,
    basisYear,
    isReform,
    publicPrice,
    basicDeduction,
    fairMarketRatio,
    usesHeavyRatio,
    taxBase: Math.round(taxBase),
    isMultiHouse,
    treatAsSingleHouse,        // 실제로 1세대1주택으로 계산했는지
    singleHouseSuppressed,     // 주택 수와 모순돼 1세대1주택 취급을 배제한 경우
    // 개편안 '28년 이후는 주택수 차등이 폐지돼 다주택도 같은 세율표를 쓴다.
    usesUnifiedRateTable: isReform && !isFirstReformYear,
    usesResidenceCreditOnly: isReform && !isFirstReformYear,
    burdenCapNotApplied: isReform,   // 세부담상한 150%→200% 전환은 전년 세액 정보가 필요해 미적용
    grossTax: Math.round(grossTax),
    ageCreditRate,
    holdingCreditRate,
    creditRate,
    creditBasisYears,
    creditAmount: Math.round(creditAmount),
    creditAmountCap,
    isCreditCapped,
    propertyTaxPaid,
    calculatedTax: Math.round(netTax),
    ruralTax: Math.round(ruralTaxRaw),
    finalTax: Math.round(netTax + ruralTaxRaw),
  };
}

// ══════════════════════════ 4. 양도소득세 ══════════════════════════
// 근거: 소득세법 제89조(비과세)·제95조(장기보유특별공제)·제104조(세율), 지방세법 제103조의3

const ONE_HOUSE_EXEMPT_LIMIT = 12 * 억;    // 1세대1주택 비과세 기준
const LONG_TERM_RATE_GENERAL = 0.02;       // 표1 — 보유 1년당
const LONG_TERM_LIMIT_GENERAL = 0.3;
const LONG_TERM_RATE_ONE_HOUSE = 0.04;     // 표2 — 보유·거주 각 1년당
const LONG_TERM_LIMIT_ONE_HOUSE = 0.8;     // 표2 — 보유분 + 거주분 합계 한도
// 소득세법 제95조 제5항 — "공제율이 100분의 40보다 큰 경우에는 100분의 40으로 한다".
// 합계 80%와 별개로 보유분·거주분 각각에 40% 한도가 걸린다. 합계 한도만 두면
// 보유기간이 거주기간보다 긴 경우에 과다공제가 된다.
const LONG_TERM_LIMIT_ONE_HOUSE_EACH = 0.4;
// 표2는 보유 3년 이상 + 거주 2년 이상일 때만 적용된다. 거주 요건을 못 채우면 표1이다.
// 비조정대상지역은 거주 없이 보유 2년만으로 1세대1주택 비과세가 되므로 이 조합이 실제로 발생한다.
const ONE_HOUSE_TABLE2_MIN_LIVING_YEARS = 2;

// 다주택 중과 대상 구분 (소득세법 제104조 제7항). 화면 계층은 주택 수만 넘기고
// 세율은 이 모듈이 결정한다 — 중과율이 적용 기준·연도에 따라 달라지기 때문이다 (원칙 제1조).
// 중과는 **조정대상지역 소재** 다주택에만 적용된다 (소득세법 제104조 제7항).
// 따라서 "중과 없음"에는 성질이 다른 두 경우가 섞여 있어 선택지를 갈라 둔다.
//   · 1세대1주택 비과세 — 비과세와 중과는 동시에 성립하지 않는다
//   · 중과 대상 아님 — 1주택이지만 보유 2년 미만 등으로 과세되는 경우, 비조정대상지역 다주택 등
// 둘 다 중과율 0%지만, 화면이 비과세 선택과 짝지어 유효한 선택지만 열어 주려면 구분이 필요하다.
const TRANSFER_SURCHARGE_OPTIONS = [
  { label: '없음 — 1세대1주택 비과세', houses: 0, requiresExempt: true },
  { label: '없음 — 중과 대상 아님', houses: 0, requiresExempt: false },
  { label: '2주택 중과', houses: 2, requiresExempt: false },
  { label: '3주택 이상 중과', houses: 3, requiresExempt: false },
];
const TRANSFER_SURCHARGE_RATE_CURRENT = { 0: 0, 2: 0.20, 3: 0.30 };
// 2026 개편안 §4.2 — 조정대상지역 다주택 중과 한시완화. '29년은 한시완화가 끝나 현행으로 복귀한다.
const TRANSFER_SURCHARGE_RATE_REFORM = {
  [BASIS_YEAR_2027]: { 0: 0, 2: 0.05, 3: 0.10 },
  [BASIS_YEAR_2028]: { 0: 0, 2: 0.10, 3: 0.15 },
  [BASIS_YEAR_2029]: TRANSFER_SURCHARGE_RATE_CURRENT,
};
// 2026 개편안 §4.2 — 장기보유특별공제 개편
const LONG_TERM_RATE_RESIDENCE_ONLY = 0.08;   // '29년 최종형: 거주 1년당 8%, 한도 80%
const LONG_TERM_DEDUCTION_CAP_REFORM = {      // 공제액 한도 신설
  [BASIS_YEAR_2027]: Infinity,
  [BASIS_YEAR_2028]: 20 * 억,
  [BASIS_YEAR_2029]: 10 * 억,
};
// 2026 개편안 §4.2 — 장기거주 1주택 양도세 기본공제 확대
const TRANSFER_BASIC_DEDUCTION_LONG_RESIDENCE = 2500 * 만;
const LONG_RESIDENCE_MIN_YEARS = 10;
const LONG_RESIDENCE_PRICE_LIMIT = 30 * 억;

function calculateTransferIncomeTax({
  salePrice,
  purchasePrice,
  expenses = 0,
  holdingYears = 0,
  livingYears = 0,
  isOneHouseExempt = false,
  surchargeHouses = 0,
  basis = BASIS_CURRENT,
  basisYear = BASIS_YEAR_2027,
}) {
  const isReform = basis === BASIS_REFORM_2026;
  const transferGain = Math.max(0, salePrice - purchasePrice - expenses);

  // 1세대1주택 고가주택의 과세대상 양도차익 (소득세법 시행령 제160조 제1항 제1호)
  //   과세대상 양도차익 = 양도차익 × (양도가액 − 12억원) ÷ 양도가액
  //
  // 두 가지를 구분해야 한다.
  //   · 12억원 초과 판정은 **양도가액** 기준이다 (고가주택 판정, 법 제89조 제1항 제3호).
  //   · 과세되는 금액은 **양도차익에 그 안분비율을 곱한 값**이다.
  // 흔한 오해 둘 다 아니다 — "양도가액 − 12억원"도 아니고 "양도차익 − 12억원"도 아니다.
  // 예: 양도 20억 / 취득 10억 → 차익 10억 × (20−12)/20 = 4억이 과세대상이다.
  //     (오해대로면 8억 또는 0원이 되어 세액이 크게 어긋난다.)
  const exemptRatio = !isOneHouseExempt ? 1
    : salePrice > ONE_HOUSE_EXEMPT_LIMIT ? (salePrice - ONE_HOUSE_EXEMPT_LIMIT) / salePrice : 0;
  const taxableGain = transferGain * exemptRatio;

  // 1세대1주택 비과세는 1주택자에게만 적용되므로 다주택 중과와 동시에 성립하지 않는다.
  // 두 값이 함께 들어오면 모순이므로 중과를 배제한다 (화면에서도 선택을 막지만 여기서 한 번 더 막는다).
  const surchargeSuppressed = isOneHouseExempt && surchargeHouses > 0;
  const effectiveSurchargeHouses = isOneHouseExempt ? 0 : surchargeHouses;

  // 다주택 중과 대상 자산은 장기보유특별공제 대상에서 제외된다.
  // 소득세법 제95조 제2항 단서 — 장특공제 대상에서 "제104조 제7항 각 호에 따른 자산"을 뺀다.
  const longTermExcludedBySurcharge = effectiveSurchargeHouses > 0;

  // 개편안 '29년형은 1세대1주택 장특공제가 거주기간 단일공제로 바뀐다.
  // '27·'28년의 단계별 전환율은 첨부 개편안 자료에 수치가 없어 현행 공제율을 적용한다.
  const usesTable2 = isOneHouseExempt && livingYears >= ONE_HOUSE_TABLE2_MIN_LIVING_YEARS;
  const usesResidenceOnlyRate = isReform && basisYear === BASIS_YEAR_2029 && usesTable2;
  const longTermRateFromCurrent = isReform && !usesResidenceOnlyRate && usesTable2 && holdingYears >= 3;
  const livedYears = Math.min(livingYears, holdingYears);
  const longTermRate = (longTermExcludedBySurcharge || holdingYears < 3) ? 0
    : usesResidenceOnlyRate
      ? Math.min(LONG_TERM_LIMIT_ONE_HOUSE, livedYears * LONG_TERM_RATE_RESIDENCE_ONLY)
      : usesTable2
        // 표2 — 보유분·거주분을 각각 40%로 끊은 뒤 합계를 80%로 끊는다 (제95조 제5항)
        ? Math.min(LONG_TERM_LIMIT_ONE_HOUSE,
          Math.min(LONG_TERM_LIMIT_ONE_HOUSE_EACH, holdingYears * LONG_TERM_RATE_ONE_HOUSE)
          + Math.min(LONG_TERM_LIMIT_ONE_HOUSE_EACH, livedYears * LONG_TERM_RATE_ONE_HOUSE))
        : Math.min(LONG_TERM_LIMIT_GENERAL, holdingYears * LONG_TERM_RATE_GENERAL);

  // 개편안은 장특공제액 자체에 금액 한도를 신설했다.
  const longTermCap = isReform ? LONG_TERM_DEDUCTION_CAP_REFORM[basisYear] : Infinity;
  const longTermDeductionUncapped = taxableGain * longTermRate;
  const longTermDeduction = Math.min(longTermDeductionUncapped, longTermCap);
  const isLongTermCapped = longTermDeductionUncapped > longTermCap;

  // 개편안 — 10년 이상 거주하고 양도가액이 30억원 이하이면 기본공제가 2,500만원으로 확대된다.
  const hasLongResidenceDeduction = isReform
    && livingYears >= LONG_RESIDENCE_MIN_YEARS
    && salePrice <= LONG_RESIDENCE_PRICE_LIMIT;
  const basicDeduction = hasLongResidenceDeduction
    ? TRANSFER_BASIC_DEDUCTION_LONG_RESIDENCE : TRANSFER_BASIC_DEDUCTION;

  const taxBase = Math.max(0, taxableGain - longTermDeduction - basicDeduction);

  const surchargeRate = isReform
    ? TRANSFER_SURCHARGE_RATE_REFORM[basisYear][effectiveSurchargeHouses]
    : TRANSFER_SURCHARGE_RATE_CURRENT[effectiveSurchargeHouses];
  const calculatedTaxRaw = calculateTieredTax(taxBase, INCOME_TAX_BRACKETS) + taxBase * surchargeRate;
  const localTaxRaw = calculatedTaxRaw * LOCAL_INCOME_TAX_RATE;

  return {
    basis,
    basisYear,
    isReform,
    transferGain: Math.round(transferGain),
    exemptRatio,
    taxableGain: Math.round(taxableGain),
    longTermRate,
    usesTable2,                   // 표2(1세대1주택) 적용 여부 — 거주 2년 미만이면 표1로 내려간다
    usesResidenceOnlyRate,
    longTermRateFromCurrent,      // 개편안이지만 전환율 미수록으로 현행 공제율을 쓴 경우
    longTermExcludedBySurcharge,  // 다주택 중과 대상이라 장특공제가 배제된 경우
    longTermDeduction: Math.round(longTermDeduction),
    longTermCap: longTermCap,
    isLongTermCapped,
    basicDeduction,
    hasLongResidenceDeduction,
    taxBase: Math.round(taxBase),
    surchargeHouses: effectiveSurchargeHouses,
    surchargeSuppressed,
    surchargeRate,
    calculatedTax: Math.round(calculatedTaxRaw),
    localTax: Math.round(localTaxRaw),
    finalTax: Math.round(calculatedTaxRaw + localTaxRaw),
  };
}

// ══════════════════════════ 5. 가업승계 ══════════════════════════
// 근거: 상속세및증여세법 제18조의2(가업상속공제), 조세특례제한법 제30조의6(증여세 과세특례)
//       2026 개편안은 입법 확정 전이다 (제약 C5).

const SUCCESSION_CAP_10Y = 300 * 억;
const SUCCESSION_CAP_20Y = 400 * 억;
const SUCCESSION_CAP_30Y = 600 * 억;
const SUCCESSION_REFORM_PER_YEAR = 20 * 억;   // 개편안 — 경영연수 1년당
const SUCCESSION_REFORM_CAP = 1000 * 억;
// 개편안 피상속인 계속경영 요건: 30년 이상이 원칙이나, 20년 이상이면 부족기간만큼
// 상속인 사후관리기간을 연장하는 전제로 공제가 허용된다 (2026 세제개편안 3.3(2)).
// 가업승계 증여세 과세특례(조특법 §30의6)의 부모 계속경영 요건도 개편안에서 20년이다 (동 3.6).
const SUCCESSION_REFORM_MIN_YEARS = 20;
const SUCCESSION_REFORM_FULL_YEARS = 30;
const SPECIAL_GIFT_DEDUCTION = 10 * 억;       // 과세특례 공제
const SPECIAL_GIFT_RATE_LOW = 0.10;
const SPECIAL_GIFT_RATE_HIGH = 0.20;
const SPECIAL_GIFT_THRESHOLD = 120 * 억;
// 가업상속공제 외의 상속공제. 이 세목은 법인 주식만 상속재산으로 보므로 개인 사정에 따라
// 달라지는 공제를 입력받지 않고 일괄공제(상증법 제21조, 5억원)를 적용한다.
// 공제 대상에서 빠진 사업무관자산·한도초과분에 대한 상속세가 이 공제를 받는다.
// 2026 개편안 §3.4(1) — 공제대상 토지 범위 축소
// 공제대상 토지가액 = min(토지면적, 건축물 바닥면적 × 배율) × min(㎡당 평가액, 1,000만원)
const SUCCESSION_LAND_MULTIPLE_METRO = 2;     // 수도권(인구감소지역 제외)
const SUCCESSION_LAND_MULTIPLE_OTHER = 3;
const SUCCESSION_LAND_UNIT_PRICE_CAP = 1000 * 만;
// 2026 개편안 §3.6 — 가업승계 증여세 과세특례(조특법 §30의6) 부모 계속경영 요건 10년 → 20년
const SPECIAL_GIFT_MIN_YEARS_CURRENT = 10;
const SPECIAL_GIFT_MIN_YEARS_REFORM = 20;

function calculateBusinessSuccession({
  businessValue,
  managementYears,
  totalEstate = 0,
  otherDeduction = LUMP_SUM_DEDUCTION,
  basis = BASIS_CURRENT,
  route = '가업상속공제',
  landUnitPrice = 0,   // ㎡당 평가액
  landArea = 0,        // 토지 면적(㎡)
  floorArea = 0,       // 건축물 바닥면적(㎡)
  isMetroArea = true,  // 수도권(인구감소지역 제외) 여부
  // 상증법 시행령 제15조 제5항 제2호 — 사업무관자산 비율(0~1).
  // 가업상속 재산가액 = 주식가액 × (1 − 사업무관자산가액 ÷ 총자산가액)
  unrelatedAssetRate = 0,
}) {
  const isReform = basis === BASIS_REFORM_2026;

  // 개편안의 토지 공제 축소. 현행에는 ㎡당 한도가 없고 배율이 용도지역별(3~7배)로
  // 세분되어 있어, 용도지역 입력 없이 현행분을 재계산하지 않는다 — 현행 기준에서는
  // 입력된 가업 자산가액을 그대로 사용한다.
  const landMultiple = isMetroArea ? SUCCESSION_LAND_MULTIPLE_METRO : SUCCESSION_LAND_MULTIPLE_OTHER;
  const hasLandInput = landArea > 0 && landUnitPrice > 0 && floorArea > 0;
  const landValueBefore = landArea * landUnitPrice;
  const landValueAfter = Math.min(landArea, floorArea * landMultiple)
    * Math.min(landUnitPrice, SUCCESSION_LAND_UNIT_PRICE_CAP);
  const isLandReduced = isReform && hasLandInput;
  const adjustedBusinessValue = isLandReduced
    ? Math.max(0, businessValue - landValueBefore + landValueAfter)
    : businessValue;

  // 사업무관자산은 가업상속 재산가액에서 제외된다. 공제 한도를 씌우기 전에 뺀다.
  const unrelatedRate = Math.min(1, Math.max(0, unrelatedAssetRate));
  const qualifiedValue = adjustedBusinessValue * (1 - unrelatedRate);

  const deductionCap = isReform
    ? (managementYears >= SUCCESSION_REFORM_MIN_YEARS
      ? Math.min(managementYears * SUCCESSION_REFORM_PER_YEAR, SUCCESSION_REFORM_CAP) : 0)
    : managementYears >= 30 ? SUCCESSION_CAP_30Y
      : managementYears >= 20 ? SUCCESSION_CAP_20Y
        : managementYears >= 10 ? SUCCESSION_CAP_10Y : 0;
  const deduction = Math.min(qualifiedValue, deductionCap);

  // 총상속재산 미지정 시 가업자산가액을 총상속재산으로 본다.
  const estate = totalEstate > 0 ? totalEstate : businessValue;
  const baseWithout = Math.max(0, estate - otherDeduction);
  const baseWith = Math.max(0, estate - otherDeduction - deduction);
  const taxWithoutRaw = calculateTieredTax(baseWithout, INHERITANCE_TAX_BRACKETS) * (1 - REPORT_CREDIT_RATE);
  const taxWithRaw = calculateTieredTax(baseWith, INHERITANCE_TAX_BRACKETS) * (1 - REPORT_CREDIT_RATE);

  // 증여세 과세특례 — (과세가액 − 10억) × 10%, 120억 초과분 20%
  // 부모 계속경영 요건은 현행 10년, 개편안 20년이다.
  const specialMinYears = isReform ? SPECIAL_GIFT_MIN_YEARS_REFORM : SPECIAL_GIFT_MIN_YEARS_CURRENT;
  const meetsSpecialRequirement = managementYears >= specialMinYears;
  const specialTaxBase = meetsSpecialRequirement ? Math.max(0, deduction - SPECIAL_GIFT_DEDUCTION) : 0;
  const specialGrossTaxRaw = Math.min(specialTaxBase, SPECIAL_GIFT_THRESHOLD) * SPECIAL_GIFT_RATE_LOW
    + Math.max(0, specialTaxBase - SPECIAL_GIFT_THRESHOLD) * SPECIAL_GIFT_RATE_HIGH;
  const specialTaxRaw = (Math.min(specialTaxBase, SPECIAL_GIFT_THRESHOLD) * SPECIAL_GIFT_RATE_LOW
    + Math.max(0, specialTaxBase - SPECIAL_GIFT_THRESHOLD) * SPECIAL_GIFT_RATE_HIGH)
    * (1 - REPORT_CREDIT_RATE);

  // 과세특례를 쓰지 않고 같은 주식을 그냥 증여했을 때의 일반 증여세.
  // 특례의 절감효과를 보여주기 위한 비교분이다 — 가업상속공제의 "공제 미적용 시 상속세"와 같은 역할.
  // 성년 자녀에게 증여하는 표준 사례로 계산한다 (증여재산공제 5,000만원).
  const normalGift = calculateGiftTax({ giftValue: qualifiedValue, relation: '직계존비속' });
  const normalGiftTaxRaw = normalGift.giftTax;

  const isSpecialRoute = route === '증여세과세특례';
  return {
    businessValue,
    managementYears,
    isReform,
    // 개편안에서 20~29년 경영은 사후관리기간 연장을 전제로만 공제가 허용된다 (상속공제 경로에 한함).
    needsExtendedFollowUp: isReform
      && !isSpecialRoute
      && managementYears >= SUCCESSION_REFORM_MIN_YEARS
      && managementYears < SUCCESSION_REFORM_FULL_YEARS,
    landMultiple,
    landValueBefore: Math.round(landValueBefore),
    landValueAfter: Math.round(landValueAfter),
    isLandReduced,
    adjustedBusinessValue: Math.round(adjustedBusinessValue),
    unrelatedAssetRate: unrelatedRate,
    unrelatedAssetValue: Math.round(adjustedBusinessValue - qualifiedValue),
    qualifiedValue: Math.round(qualifiedValue),
    deductionCap,
    deduction,
    otherDeduction,
    specialMinYears,
    meetsSpecialRequirement,
    baseWithout: Math.round(baseWithout),
    baseWith: Math.round(baseWith),
    taxWithout: Math.round(taxWithoutRaw),
    taxWith: Math.round(taxWithRaw),
    saving: Math.round(taxWithoutRaw - taxWithRaw),
    specialDeduction: SPECIAL_GIFT_DEDUCTION,
    specialThreshold: SPECIAL_GIFT_THRESHOLD,
    specialRateLow: SPECIAL_GIFT_RATE_LOW,
    specialRateHigh: SPECIAL_GIFT_RATE_HIGH,
    specialTaxBase: Math.round(specialTaxBase),
    specialGrossTax: Math.round(specialGrossTaxRaw),
    specialReportCredit: Math.round(specialGrossTaxRaw * REPORT_CREDIT_RATE),
    specialTax: Math.round(specialTaxRaw),
    // 특례 미적용 시 일반 증여세와 그 차액 (요건 미충족이면 절감 효과 0)
    normalGiftTax: Math.round(normalGiftTaxRaw),
    normalGiftDeduction: normalGift.relativeDeduction,
    normalGiftTaxBase: Math.round(normalGift.giftTaxBase),
    specialSaving: Math.round(meetsSpecialRequirement ? normalGiftTaxRaw - specialTaxRaw : 0),
    route,
    total: Math.round(isSpecialRoute ? specialTaxRaw : taxWithRaw),
  };
}

// ══════════════════════════ 6. 비상장주식 평가 ══════════════════════════
// 근거: 상속세및증여세법 시행령 제54조(비상장주식 평가)·제53조(최대주주 할증)

const CAPITALIZATION_RATE = 0.1;           // 순손익가치 환원율
const NET_ASSET_FLOOR_RATIO = 0.8;         // 순자산가치 하한
const MAX_SHAREHOLDER_PREMIUM = 1.2;       // 최대주주 20% 할증

// 최근 3년 순손익액의 가중평균 (상증법 시행령 제56조 제1항 제1호)
//   = (평가기준일 1년 전 × 3 + 2년 전 × 2 + 3년 전 × 1) ÷ 6
const NET_INCOME_WEIGHTS = [3, 2, 1];
const NET_INCOME_WEIGHT_SUM = 6;

function calculateWeightedNetIncome(incomes) {
  const sum = NET_INCOME_WEIGHTS.reduce((acc, w, i) => acc + (incomes[i] || 0) * w, 0);
  return sum / NET_INCOME_WEIGHT_SUM;
}

function calculateUnlistedStockValue({
  netAsset,
  weightedIncome,
  totalShares,
  isRealtyHeavy = false,
  // 상증법 시행령 제54조 제4항 — 사업개시 3년 미만, 휴·폐업, 청산 중,
  // 자산총액 중 부동산등 비율 80% 이상인 법인은 순자산가치만으로 평가한다.
  netAssetOnly = false,
  hasMaxShareholderPremium = true,
}) {
  const shares = Math.max(1, totalShares);
  const netAssetPerShare = netAsset / shares;
  const incomePerShare = (weightedIncome / shares) / CAPITALIZATION_RATE;

  // 부동산 과다보유 법인은 순손익2 : 순자산3으로 가중치가 역전된다.
  const weightedValue = isRealtyHeavy
    ? (incomePerShare * 2 + netAssetPerShare * 3) / 5
    : (incomePerShare * 3 + netAssetPerShare * 2) / 5;
  const floorValue = netAssetPerShare * NET_ASSET_FLOOR_RATIO;
  // 순자산가치만으로 평가하는 법인에는 가중평균도 80% 하한도 적용하지 않는다.
  const valuePerShare = netAssetOnly ? netAssetPerShare : Math.max(weightedValue, floorValue);

  const premiumRate = hasMaxShareholderPremium ? MAX_SHAREHOLDER_PREMIUM : 1;
  const pricePerShareRaw = valuePerShare * premiumRate;

  return {
    netAssetPerShare: Math.round(netAssetPerShare),
    incomePerShare: Math.round(incomePerShare),
    weightedValue: Math.round(weightedValue),
    floorValue: Math.round(floorValue),
    netAssetOnly,
    isFloorApplied: !netAssetOnly && floorValue >= weightedValue,
    valuePerShare: Math.round(valuePerShare),
    premiumRate,
    pricePerShare: Math.round(pricePerShareRaw),
    // 평가 대상은 발행주식 전체다 — 이 세목은 법인 주식의 1주당 가액을 정하는 것이 목적이고,
    // 개인별 보유분 가액은 1주당 가액 × 보유주식수로 상속세·증여세 세목에서 다룬다.
    totalShares: shares,
    totalValue: Math.round(pricePerShareRaw * shares),
  };
}

// ══════════════════════════ 7. 급여 및 배당 ══════════════════════════
// 근거: 소득세법 제47조(근로소득공제)·제50조(기본공제)·제55조(세율)·제59조(근로소득세액공제)
//       제14조·제62조(금융소득종합과세)·제129조(원천징수), 법인세법 제55조
//
// 이 세목은 "현재 급여액 + 예상 배당액"을 받아 개인 단계의 세부담만 비교한다.
// 배당액은 법인세를 이미 부담한 이익잉여금에서 지급되는 실제 배당금으로 보므로
// 법인 단계의 법인세를 다시 계산하지 않는다.

const SEPARATE_TAXATION_LIMIT = 2000 * 만;   // 금융소득종합과세 기준금액 (소득세법 제14조 제3항)
const SEPARATE_TAXATION_RATE = 0.154;        // 배당소득 원천징수 14% + 지방소득세 1.4%
const PERSONAL_DEDUCTION_SELF = 150 * 만;    // 소득세법 제50조 제1항 — 본인 기본공제
const EARNED_DEDUCTION_LIMIT = 2000 * 만;    // 소득세법 제47조 제2항 — 근로소득공제 한도
// 4대보험 근로자 부담분 근사치 — 국민연금 4.5% + 건강보험 3.545% + 장기요양 약 0.46% + 고용보험 0.9%.
// 국민연금 기준소득월액 상한은 반영하지 않아 고소득 구간에서는 다소 과대 계상된다.
const INSURANCE_RATE = 0.09;

// 법인세율 (법인세법 제55조 제1항).
// 2024.12.31. 법률 제20613호로 전 구간 1%p 인상되어, **2026.1.1. 이후 개시하는 사업연도**부터
// 과세표준 2억원 이하 10% / 2억~200억 20% / 200억~3,000억 22% / 3,000억 초과 25%가 적용된다.
// (2025 사업연도까지는 9 / 19 / 21 / 24%)
// 배당 재원에 적용되는 한계세율은 해당 법인의 과세표준 구간에 따라 달라지므로 상담 시 직접 선택한다.
const CORPORATE_TAX_RATE_APPLIED_FROM = '2026.1.1. 이후 개시 사업연도';
const CORPORATE_TAX_RATE_OPTIONS = [
  { label: '10%', rate: 0.10, bracket: '과세표준 2억원 이하' },
  { label: '20%', rate: 0.20, bracket: '2억~200억원' },
  { label: '22%', rate: 0.22, bracket: '200억~3,000억원' },
  { label: '25%', rate: 0.25, bracket: '3,000억원 초과' },
];
// 2025 사업연도 이전 건을 검토할 때 참고한다.
const CORPORATE_TAX_RATE_OPTIONS_UNTIL_2025 = [
  { label: '9%', rate: 0.09, bracket: '과세표준 2억원 이하' },
  { label: '19%', rate: 0.19, bracket: '2억~200억원' },
  { label: '21%', rate: 0.21, bracket: '200억~3,000억원' },
  { label: '24%', rate: 0.24, bracket: '3,000억원 초과' },
];

// 근로소득공제 (소득세법 제47조 제1항) — 총급여액 구간별, 공제액 2,000만원 한도
function calculateEarnedIncomeDeduction(grossPay) {
  let d;
  if (grossPay <= 500 * 만) d = grossPay * 0.7;
  else if (grossPay <= 1500 * 만) d = 350 * 만 + (grossPay - 500 * 만) * 0.4;
  else if (grossPay <= 4500 * 만) d = 750 * 만 + (grossPay - 1500 * 만) * 0.15;
  else if (grossPay <= 10000 * 만) d = 1200 * 만 + (grossPay - 4500 * 만) * 0.05;
  else d = 1475 * 만 + (grossPay - 10000 * 만) * 0.02;
  return Math.min(d, EARNED_DEDUCTION_LIMIT);
}

// 근로소득세액공제 (소득세법 제59조) — 산출세액 기준 공제율에 총급여액 기준 한도를 씌운다.
function calculateEarnedIncomeTaxCredit(computedTax, grossPay) {
  const raw = computedTax <= 130 * 만
    ? computedTax * 0.55
    : 130 * 만 * 0.55 + (computedTax - 130 * 만) * 0.30;
  let cap;
  if (grossPay <= 3300 * 만) cap = 74 * 만;
  else if (grossPay <= 7000 * 만) cap = Math.max(66 * 만, 74 * 만 - (grossPay - 3300 * 만) * 0.008);
  else if (grossPay <= 12000 * 만) cap = Math.max(50 * 만, 66 * 만 - (grossPay - 7000 * 만) * 0.5);
  else cap = Math.max(20 * 만, 50 * 만 - (grossPay - 12000 * 만) * 0.5);
  return Math.min(raw, cap);
}

// 근로소득만 있는 근로자의 결정세액. 본인 기본공제 외의 소득·세액공제는 반영하지 않는다.
function calculateEarnedIncomeTax(grossPay) {
  const deduction = calculateEarnedIncomeDeduction(grossPay);
  const incomeAmount = Math.max(0, grossPay - deduction);
  const taxBase = Math.max(0, incomeAmount - PERSONAL_DEDUCTION_SELF);
  const computedTax = calculateTieredTax(taxBase, INCOME_TAX_BRACKETS);
  const credit = calculateEarnedIncomeTaxCredit(computedTax, grossPay);
  const determinedTax = Math.max(0, computedTax - credit);
  return {
    grossPay,
    deduction,
    incomeAmount,
    taxBase,
    computedTax,
    credit,
    determinedTax,
    totalTax: determinedTax * (1 + LOCAL_INCOME_TAX_RATE),
  };
}

// 배당소득세. 2,000만원까지는 15.4% 원천징수로 종결되고(소득세법 제14조 제3항),
// 초과분은 다른 종합소득에 합산해 누진세율로 과세된다. 비교과세(제62조)에 따라
// 초과분 세액은 원천징수세율로 계산한 금액보다 작아지지 않는다.
function calculateDividendTax(dividend, earnedTaxBase) {
  const separatePart = Math.min(dividend, SEPARATE_TAXATION_LIMIT);
  const excess = Math.max(0, dividend - SEPARATE_TAXATION_LIMIT);
  const separateTax = separatePart * SEPARATE_TAXATION_RATE;
  const progressive = (calculateTieredTax(earnedTaxBase + excess, INCOME_TAX_BRACKETS)
    - calculateTieredTax(earnedTaxBase, INCOME_TAX_BRACKETS)) * (1 + LOCAL_INCOME_TAX_RATE);
  const excessTax = excess > 0 ? Math.max(progressive, excess * SEPARATE_TAXATION_RATE) : 0;
  return {
    separatePart,
    separateTax,
    excess,
    excessTax,
    isComparativeFloor: excess > 0 && excessTax > progressive,
    isSeparateTaxation: excess === 0,
    total: separateTax + excessTax,
  };
}

// 급여 수준별 비교표의 단계 — 증감폭(stepPercent)에 이 배수를 곱한다.
const SALARY_SCALE_STEPS = [-2, -1, 0, 1, 2];

// 급여액을 고정한 채 배당 실행 여부를 비교하고(표1), 급여 수준을 단계별로 비교한다(표2).
function calculateSalaryDividendCompare({
  salary,
  dividend,
  includeInsurance = true,
  stepPercent = 10,
}) {
  function scenario(pay, div) {
    const earned = calculateEarnedIncomeTax(pay);
    const insurance = includeInsurance ? pay * INSURANCE_RATE : 0;
    const part = calculateDividendTax(div, earned.taxBase);
    const totalTax = earned.totalTax + part.total;
    const gross = pay + div;
    return {
      salary: Math.round(pay),
      dividend: Math.round(div),
      earnedDeduction: Math.round(earned.deduction),
      taxBase: Math.round(earned.taxBase),
      computedTax: Math.round(earned.computedTax),
      earnedCredit: Math.round(earned.credit),
      salaryTax: Math.round(earned.totalTax),
      insurance: Math.round(insurance),
      dividendSeparateTax: Math.round(part.separateTax),
      dividendExcess: Math.round(part.excess),
      dividendExcessTax: Math.round(part.excessTax),
      dividendTax: Math.round(part.total),
      isSeparateTaxation: part.isSeparateTaxation,
      isComparativeFloor: part.isComparativeFloor,
      totalTax: Math.round(totalTax),
      burden: Math.round(totalTax + insurance),
      netCash: Math.round(gross - totalTax - insurance),
      effectiveRate: gross > 0 ? (totalTax + insurance) / gross : 0,
    };
  }

  const withDividend = scenario(salary, dividend);
  const withoutDividend = scenario(salary, 0);

  const step = Math.max(0, stepPercent) / 100;
  const ratios = step > 0
    ? SALARY_SCALE_STEPS.map((n) => 1 + n * step).filter((r) => r > 0)
    : [1];
  const salaryScale = ratios.map((r) => {
    // 표에 만원 단위로 떨어지는 급여를 싣는다.
    const row = scenario(Math.round(salary * r / 만) * 만, dividend);
    row.ratio = r;
    row.isCurrent = Math.abs(r - 1) < 1e-9;
    return row;
  });

  return {
    salary: Math.round(salary),
    dividend: Math.round(dividend),
    withDividend,
    withoutDividend,
    dividendCost: withDividend.burden - withoutDividend.burden,
    stepPercent,
    salaryScale,
  };
}

// ══════════════════════════ 8. 임원퇴직금 ══════════════════════════
// 근거: 소득세법 제22조(퇴직소득)·제48조(환산급여공제)·법인세법 시행령 제44조
//
// 한도는 근무기간을 세 구간으로 나눠 적용한다 (소득세법 제22조 제3항).
//   · 2011.12.31. 이전       — 한도 적용 제외. 정관상 금액이 전액 퇴직소득이다.
//   · 2012.1.1.~2019.12.31. — 3배
//   · 2020.1.1. 이후         — 2배
// 2011년 이전 근무분을 "3배수 한도"로 다루면 두 가지가 함께 틀린다.
// 없는 한도가 생겨 한도초과분이 과대 계상되고, 진짜 3배 구간을 표현할 수단이 없어진다.

const SEVERANCE_MULTIPLE_2012_2019 = 3;
const SEVERANCE_MULTIPLE_AFTER_2020 = 2;

// 근속연수 (소득세법 제48조 제1항 후단) — 1년 미만의 기간은 1년으로 본다.
function calculateServiceYearsFromMonths(months) {
  return months <= 0 ? 0 : Math.ceil(months / 12);
}

// 입사일·퇴직일에서 뽑은 구간별 근속 월수를 한도 계산용 연수로 배분한다.
// 화면 계층은 날짜 계산(월수)만 하고, 연수 배분 규칙은 계산 모듈이 소유한다.
// 구간 연수는 월수를 12로 나눠 반올림하고, 남는 기간을 2020년 이후 구간으로 본다.
function allocateServiceYears({ totalMonths, monthsUntil2011 = 0, months2012to2019 = 0 }) {
  const serviceYears = calculateServiceYearsFromMonths(totalMonths);
  const yearsUntil2011 = Math.min(serviceYears, Math.round(Math.max(0, monthsUntil2011) / 12));
  const years2012to2019 = Math.min(serviceYears - yearsUntil2011,
    Math.round(Math.max(0, months2012to2019) / 12));
  return {
    serviceYears,
    yearsUntil2011,
    years2012to2019,
    yearsAfter2020: Math.max(0, serviceYears - yearsUntil2011 - years2012to2019),
  };
}

// 근속연수공제 (소득세법 제48조 제1항)
function calculateServiceYearsDeduction(years) {
  if (years <= 5) return years * 100 * 만;
  if (years <= 10) return 500 * 만 + (years - 5) * 200 * 만;
  if (years <= 20) return 1500 * 만 + (years - 10) * 250 * 만;
  return 4000 * 만 + (years - 20) * 300 * 만;
}

// 환산급여공제 (소득세법 제48조 제3항)
function calculateConvertedIncomeDeduction(converted) {
  if (converted <= 800 * 만) return converted;
  if (converted <= 7000 * 만) return 800 * 만 + (converted - 800 * 만) * 0.6;
  if (converted <= 10000 * 만) return 4520 * 만 + (converted - 7000 * 만) * 0.55;
  if (converted <= 30000 * 만) return 6170 * 만 + (converted - 10000 * 만) * 0.45;
  return 15170 * 만 + (converted - 30000 * 만) * 0.35;
}

function calculateExecutiveSeveranceTax({
  averagePay,             // 퇴직일부터 소급 3년간 총급여의 연평균환산액
  // 2019.12.31.부터 소급 3년간 총급여의 연평균환산액.
  // 소득세법 제22조 제3항은 3배 구간의 한도를 이 급여로 계산한다 — 최종 급여가 아니다.
  // 미입력(0)이면 최종 3년 평균급여를 그대로 쓴다 (간편 모드).
  averagePay2019 = 0,
  serviceYears,
  payMultiple,
  yearsUntil2011 = 0,     // 2011.12.31. 이전 근무연수 — 한도 적용 제외
  years2012to2019 = 0,    // 2012.1.1.~2019.12.31. 근무연수 — 3배 한도
  otherIncome = 0,
}) {
  const annualBase = averagePay / 10;   // 연평균급여 ÷ 10 (정관상 산정 기준)
  // 3배 구간의 한도 기준급여. 별도 입력이 없으면 최종 평균급여로 갈음한다.
  const annualBase2019 = averagePay2019 > 0 ? averagePay2019 / 10 : annualBase;
  const paidAmount = annualBase * serviceYears * payMultiple;

  // 근속연수를 세 구간으로 가른다. 합이 전체 근속연수를 넘지 않도록 앞 구간부터 채운다.
  const yearsPre = Math.min(Math.max(0, yearsUntil2011), serviceYears);
  const yearsTriple = Math.min(Math.max(0, years2012to2019), serviceYears - yearsPre);
  const yearsDouble = Math.max(0, serviceYears - yearsPre - yearsTriple);

  // 2011년 이전 근무분에 대응하는 지급액은 한도 없이 퇴직소득으로 인정된다.
  const paidUntil2011 = annualBase * yearsPre * payMultiple;
  const paidAfter2012 = annualBase * (yearsTriple + yearsDouble) * payMultiple;
  // 구간별로 기준급여가 다르다 — 3배 구간은 2019년 기준, 2배 구간은 최종 기준.
  const limitTriple = annualBase2019 * yearsTriple * SEVERANCE_MULTIPLE_2012_2019;
  const limitDouble = annualBase * yearsDouble * SEVERANCE_MULTIPLE_AFTER_2020;
  const limitAfter2012 = limitTriple + limitDouble;

  // 한도초과분은 2012년 이후 구간에서만 발생한다.
  const excess = Math.max(0, paidAfter2012 - limitAfter2012);
  const severanceIncome = paidAmount - excess;
  // 표시용 총 인정액 — 2011년 이전분은 한도가 없으므로 그 지급액을 그대로 더한다.
  const limitAmount = paidUntil2011 + limitAfter2012;

  const yearsDeduction = calculateServiceYearsDeduction(serviceYears);
  const convertedBase = Math.max(0, severanceIncome - yearsDeduction);
  const convertedIncome = serviceYears > 0 ? convertedBase / serviceYears * 12 : 0;
  const convertedDeduction = calculateConvertedIncomeDeduction(convertedIncome);
  const convertedTax = calculateTieredTax(Math.max(0, convertedIncome - convertedDeduction), INCOME_TAX_BRACKETS);
  // 연분연승 — 환산세액을 12로 나눈 뒤 근속연수를 곱한다.
  const severanceTaxRaw = serviceYears > 0 ? convertedTax / 12 * serviceYears : 0;

  // 한도 초과분은 근로소득으로 과세되므로, 같은 해 근로소득에 얹히는 증분으로 계산한다.
  // 초과분도 총급여액에 들어가 근로소득공제·근로소득세액공제가 다시 계산되므로
  // §7의 근로소득세 함수를 그대로 쓴다 (지방소득세 포함).
  const excessTaxRaw = excess > 0
    ? calculateEarnedIncomeTax(otherIncome + excess).totalTax - calculateEarnedIncomeTax(otherIncome).totalTax
    : 0;

  return {
    paidAmount: Math.round(paidAmount),
    limitAmount: Math.round(limitAmount),
    yearsPre,
    yearsTriple,
    yearsDouble,
    paidUntil2011: Math.round(paidUntil2011),
    annualBase: Math.round(annualBase),
    annualBase2019: Math.round(annualBase2019),
    usesSeparate2019Pay: averagePay2019 > 0,
    limitTriple: Math.round(limitTriple),
    limitDouble: Math.round(limitDouble),
    limitAfter2012: Math.round(limitAfter2012),
    excess: Math.round(excess),
    severanceIncome: Math.round(severanceIncome),
    yearsDeduction: Math.round(yearsDeduction),
    convertedIncome: Math.round(convertedIncome),
    convertedDeduction: Math.round(convertedDeduction),
    // 두 세액 모두 지방소득세 10%를 포함한 금액이다.
    severanceTax: Math.round(severanceTaxRaw * (1 + LOCAL_INCOME_TAX_RATE)),
    excessTax: Math.round(excessTaxRaw),
    totalTax: Math.round(severanceTaxRaw * (1 + LOCAL_INCOME_TAX_RATE) + excessTaxRaw),
  };
}

// ── 결과 검증 ────────────────────────────────────────────────────────────────
// 인자를 빠뜨리거나 숫자 아닌 값을 넘기면 예전에는 NaN 이 반환 객체 전체로 조용히
// 퍼져 화면까지 흘러갔다. 필수 키를 함수마다 열거하는 대신 결과에 NaN 이 있으면
// 그 자리에서 멈춘다 — 원인을 가리지 않고 잡히며, 정상 입력에는 영향이 없다.
//
// Infinity 는 거르지 않는다. 이 모듈에서 Infinity 는 「한도 없음」을 뜻하는 의도된 값이다
// (creditAmountCap·longTermCap 은 현행법에서 한도가 없고 개편안에서만 한도가 생긴다).
function assertNoNaNResult(name, result) {
  const bad = [];
  const walk = (obj, path) => {
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v === 'number') {
        if (Number.isNaN(v)) bad.push(path + k);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, path + k + '.');
      }
    });
  };
  if (result && typeof result === 'object') walk(result, '');
  if (bad.length > 0) {
    throw new TypeError(name + ': 계산 결과에 NaN 이 있습니다 — '
      + bad.join(', ') + '. 넘긴 인자를 확인하세요.');
  }
  return result;
}

// 공개 계산 함수를 감싸 결과를 검증한다.
function guarded(name, fn) {
  return function () {
    return assertNoNaNResult(name, fn.apply(null, arguments));
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    INHERITANCE_TAX_BRACKETS,
    INCOME_TAX_BRACKETS,
    DISABLED_DEDUCTION_PER_YEAR,
    SEPARATE_TAXATION_LIMIT,
    JONGBU_TAX_BRACKETS_GENERAL,
    JONGBU_TAX_BRACKETS_MULTI,
    JONGBU_TAX_BRACKETS_REFORM_2027_GENERAL,
    JONGBU_TAX_BRACKETS_REFORM_2027_MULTI,
    JONGBU_TAX_BRACKETS_REFORM_2028,
    JONGBU_HOLDING_CREDIT_REFORM_RATIO,
    TRANSFER_SURCHARGE_OPTIONS,
    ONE_HOUSE_EXEMPT_LIMIT,
    CORPORATE_TAX_RATE_OPTIONS,
    CORPORATE_TAX_RATE_OPTIONS_UNTIL_2025,
    CORPORATE_TAX_RATE_APPLIED_FROM,
    BASIS_CURRENT,
    BASIS_REFORM_2026,
    BASIS_OPTIONS,
    BASIS_YEAR_2027,
    BASIS_YEAR_2028,
    BASIS_YEAR_2029,
    MINOR_AGE_LIMIT,
    LIFE_TABLE_YEAR,
    LIFE_EXPECTANCY_MALE,
    LIFE_EXPECTANCY_FEMALE,
    lookupLifeExpectancy,
    calculateTieredTax,
    calculateMinorYearsTotal,
    isMinorAge,
    calculateInheritanceTax: guarded('calculateInheritanceTax', calculateInheritanceTax),
    calculateSecondaryInheritance: guarded('calculateSecondaryInheritance', calculateSecondaryInheritance),
    calculateGiftTax: guarded('calculateGiftTax', calculateGiftTax),
    calculateComprehensiveRealEstateTax: guarded('calculateComprehensiveRealEstateTax', calculateComprehensiveRealEstateTax),
    calculateTransferIncomeTax: guarded('calculateTransferIncomeTax', calculateTransferIncomeTax),
    calculateBusinessSuccession: guarded('calculateBusinessSuccession', calculateBusinessSuccession),
    calculateWeightedNetIncome,
    calculateUnlistedStockValue: guarded('calculateUnlistedStockValue', calculateUnlistedStockValue),
    calculateServiceYearsFromMonths,
    allocateServiceYears,
    calculateEarnedIncomeDeduction,
    calculateEarnedIncomeTaxCredit,
    calculateEarnedIncomeTax,
    calculateDividendTax,
    calculateSalaryDividendCompare: guarded('calculateSalaryDividendCompare', calculateSalaryDividendCompare),
    calculateExecutiveSeveranceTax: guarded('calculateExecutiveSeveranceTax', calculateExecutiveSeveranceTax),
  };
}
