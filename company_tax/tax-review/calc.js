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
  // 개편안은 세율체계를 주택수 기준에서 가액 기준으로 일원화하지만, 그 세율표 수치가
  // 첨부 개편안 자료에 없다. 임의 세율을 만들지 않고 현행 세율표를 그대로 적용한다.
  const brackets = isMultiHouse ? JONGBU_TAX_BRACKETS_MULTI : JONGBU_TAX_BRACKETS_GENERAL;
  const grossTax = calculateTieredTax(taxBase, brackets);

  // 고령자·장기보유 세액공제는 1세대1주택자에게만 적용된다.
  // 개편안은 보유기간 공제를 거주기간 공제로 전환하되, 구간별 공제율은 자료에 없어 현행 표를 준용한다.
  const ageCreditRate = !treatAsSingleHouse ? 0
    : ownerAge >= 70 ? 0.4 : ownerAge >= 65 ? 0.3 : ownerAge >= 60 ? 0.2 : 0;
  const creditBasisYears = isReform ? livingYears : holdingYears;
  const holdingCreditRate = !treatAsSingleHouse ? 0
    : creditBasisYears >= 15 ? 0.5 : creditBasisYears >= 10 ? 0.4 : creditBasisYears >= 5 ? 0.2 : 0;
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
    // 개편안 선택 시에도 아래 두 항목은 첨부 자료에 수치가 없어 현행 기준으로 계산했다.
    rateTableFromCurrent: isReform,
    creditRateTableFromCurrent: isReform && creditRate > 0,
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

// ══════════════════════════ 5-1. 가업상속공제 적용대상업종 확인 ══════════════════════════
// 근거: 상속세 및 증여세법 제18조의2 제1항 제2호, 같은 법 시행령 제15조 제1항 [별표]
// (「가업상속공제 적용 대상 업종」, 한국표준산업분류 기준)
//
// 이 표는 세액을 계산하지 않는다 — 사업자등록증의 업종코드가 공제 적용대상 업종에
// 해당하는지만 판정하는 정성적 사전확인이다. calculateBusinessSuccession()과 분리해 둔다.
// 세세분류 727개 중 가업상속공제 적용대상만 발췌한 것이며, 국세청 고시로 개정될 수 있으므로
// 결과 화면에 "참고용" 고지를 함께 낸다.

const SUCCESSION_INDUSTRY_CATEGORIES = {
  A: '농업, 임업 및 어업',
  B: '광업',
  C: '제조업',
  D: '전기, 가스, 증기 및 공기조절 공급업',
  E: '수도, 하수 및 폐기물 처리, 원료 재생업',
  F: '건설업',
  G: '도매 및 소매업',
  H: '운수 및 창고업',
  I: '숙박 및 음식점업',
  J: '정보통신업',
  M: '전문, 과학 및 기술 서비스업',
  N: '사업시설 관리, 사업 지원 및 임대 서비스업',
  P: '교육 서비스업',
  Q: '보건업 및 사회복지 서비스업',
  R: '예술, 스포츠 및 여가관련 서비스업',
  S: '협회 및 단체, 수리 및 기타 개인 서비스업',
};

// 음식을 직접 제조·조리하지 않으면 제외된다 (한식 일반 음식점업 56111 ~ 간이음식 포장 판매
// 전문점 56199 전체에 공통으로 걸리는 단서).
const FOOD_SERVICE_NOTE = '음식을 직접 제조하거나 조리하지 않는 경우는 적용대상에서 제외됩니다.';

// [대분류 문자, 업종코드(한국표준산업분류), 업종명, 비고(조건·제외사유)]
const SUCCESSION_INDUSTRY_CODES = [
  ['A', '1123', '종자 및 묘목 생산업',
    '가업용 자산 중 토지·건물의 가액이 가업용 자산가액의 100분의 50 미만인 경우만 해당 (상증령 제15조)'],

  ['B', '5100', '석탄 광업'],
  ['B', '6100', '철 광업'],
  ['B', '6200', '비철금속 광업'],
  ['B', '7110', '석회석 및 점토 광업'],
  ['B', '7121', '건설용 석재 채굴 및 쇄석 생산업'],
  ['B', '7210', '화학용 및 비료원료용 광물 광업'],
  ['B', '7290', '그 외 기타 비금속광물 광업'],
  ['B', '8000', '광업 지원 서비스업'],

  ['C', '10111', '육류 도축업(가금류 제외)'],
  ['C', '10112', '가금류 도축업'],
  ['C', '10121', '가금류 가공 및 저장 처리업'],
  ['C', '10122', '육류 포장육 및 냉동육 가공업 (가금류 제외)'],
  ['C', '10129', '육류 기타 가공 및 저장 가공업 (가금류 제외)'],
  ['C', '10211', '수산동물 훈제, 조리 및 유사 조제식품 제조업'],
  ['C', '10212', '수산동물 건조 및 염장품 제조업'],
  ['C', '10213', '수산동물 냉동품 제조업'],
  ['C', '10219', '기타 수산동물 가공 및 저장 처리업'],
  ['C', '10220', '수산식물 가공 및 저장 처리업'],
  ['C', '10301', '김치류 제조업'],
  ['C', '10302', '과실 및 그 외 채소 절임식품 제조업'],
  ['C', '10309', '기타 과실ㆍ채소 가공 및 저장 처리업'],
  ['C', '10411', '동물성 유지 제조업'],
  ['C', '10412', '식물성 유지 제조업'],
  ['C', '10413', '식용 정제유 및 가공유 제조업'],
  ['C', '10421', '액상시유 및 기타 낙농제품 제조업'],
  ['C', '10422', '아이스크림 및 기타 식용 빙과류 제조업'],
  ['C', '10511', '곡물 도정업'],
  ['C', '10512', '곡물 제분업'],
  ['C', '10513', '곡물 혼합분말 및 반죽 제조업'],
  ['C', '10519', '기타 곡물 가공품 제조업'],
  ['C', '10520', '전분제품 및 당류 제조업'],
  ['C', '10601', '떡류 제조업'],
  ['C', '10602', '빵류 제조업'],
  ['C', '10603', '과자류 및 코코아 제품 제조업'],
  ['C', '10701', '도시락류 제조업'],
  ['C', '10709', '기타 식사용 가공처리 조리식품 제조업'],
  ['C', '10810', '설탕 제조업'],
  ['C', '10820', '면류, 마카로니 및 유사 식품 제조업'],
  ['C', '10831', '식초, 발효 및 화학 조미료 제조업'],
  ['C', '10832', '천연 및 혼합조제 조미료 제조업'],
  ['C', '10833', '장류 제조업'],
  ['C', '10839', '기타 식품 첨가물 제조업'],
  ['C', '10891', '커피 가공업'],
  ['C', '10892', '차류 가공업'],
  ['C', '10893', '수프 및 균질화식품 제조업'],
  ['C', '10894', '두부 및 유사식품 제조업'],
  ['C', '10895', '인삼식품 제조업'],
  ['C', '10896', '건강보조용 액화식품 제조업'],
  ['C', '10897', '건강기능식품 제조업'],
  ['C', '10899', '그 외 기타 식료품 제조업'],
  ['C', '10901', '반려동물용 사료 제조업'],
  ['C', '10902', '배합 사료 제조업'],
  ['C', '10903', '단미 사료 및 기타 사료 제조업'],
  ['C', '11111', '탁주 및 약주 제조업'],
  ['C', '11112', '맥아 및 맥주 제조업'],
  ['C', '11119', '기타 발효주 제조업'],
  ['C', '11121', '주정 제조업'],
  ['C', '11122', '소주 제조업'],
  ['C', '11129', '기타 증류주 및 합성주 제조업'],
  ['C', '11201', '얼음 제조업'],
  ['C', '11202', '생수 생산업'],
  ['C', '11209', '기타 비알코올 음료 제조업'],
  ['C', '13101', '면 방적업'],
  ['C', '13102', '모 방적업'],
  ['C', '13103', '화학섬유 방적업'],
  ['C', '13104', '연사 및 가공사 제조업'],
  ['C', '13109', '기타 방적업'],
  ['C', '13211', '면직물 직조업'],
  ['C', '13212', '모직물 직조업'],
  ['C', '13213', '화학섬유직물 직조업'],
  ['C', '13219', '특수 직물 및 기타 직물 직조업'],
  ['C', '13221', '침구 및 관련제품 제조업'],
  ['C', '13222', '자수제품 및 자수용재료 제조업'],
  ['C', '13223', '커튼 및 유사제품 제조업'],
  ['C', '13224', '천막, 텐트 및 유사 제품 제조업'],
  ['C', '13225', '직물포대 제조업'],
  ['C', '13229', '기타 직물제품 제조업'],
  ['C', '13300', '편조원단 제조업'],
  ['C', '13401', '솜 및 실 염색가공업'],
  ['C', '13402', '직물, 편조원단 및 의복류 염색 가공업'],
  ['C', '13403', '날염 가공업'],
  ['C', '13409', '섬유제품 기타 정리 및 마무리 가공업'],
  ['C', '13910', '카펫, 마루덮개 및 유사제품 제조업'],
  ['C', '13921', '끈 및 로프 제조업'],
  ['C', '13922', '어망 및 기타 끈 가공품 제조업'],
  ['C', '13991', '세폭직물 제조업'],
  ['C', '13992', '부직포 및 펠트 제조업'],
  ['C', '13993', '특수사 및 코드직물 제조업'],
  ['C', '13994', '표면처리 및 적층 직물 제조업'],
  ['C', '13999', '그 외 기타 분류 안된 섬유제품 제조업'],
  ['C', '14111', '남자용 겉옷 제조업'],
  ['C', '14112', '여자용 겉옷 제조업'],
  ['C', '14120', '속옷 및 잠옷 제조업'],
  ['C', '14130', '한복 제조업'],
  ['C', '14191', '셔츠 및 블라우스 제조업'],
  ['C', '14192', '근무복, 작업복 및 유사의복 제조업'],
  ['C', '14193', '가죽의복 제조업'],
  ['C', '14194', '유아용 의복 제조업'],
  ['C', '14199', '그 외 기타 봉제의복 제조업'],
  ['C', '14200', '모피제품 제조업'],
  ['C', '14300', '편조의복 제조업'],
  ['C', '14411', '스타킹 및 기타 양말 제조업'],
  ['C', '14419', '기타 편조의복 액세서리 제조업'],
  ['C', '14491', '모자 제조업'],
  ['C', '14499', '그 외 기타 의복액세서리 제조업'],
  ['C', '15110', '모피 및 가죽 제조업'],
  ['C', '15121', '핸드백 및 지갑 제조업'],
  ['C', '15129', '가방 및 기타 보호용 케이스 제조업'],
  ['C', '15190', '기타 가죽제품 제조업'],
  ['C', '15211', '구두류 제조업'],
  ['C', '15219', '기타 신발 제조업'],
  ['C', '15220', '신발 부분품 제조업'],
  ['C', '16101', '일반 제재업'],
  ['C', '16102', '표면 가공 목재 및 특정 목적용 제재목 제조업'],
  ['C', '16103', '목재 보존, 방부처리, 도장 및 유사 처리업'],
  ['C', '16211', '박판, 합판 및 유사 적층판 제조업'],
  ['C', '16212', '강화 및 재생 목재 제조업'],
  ['C', '16221', '목재문 및 관련제품 제조업'],
  ['C', '16229', '기타 건축용 나무제품 제조업'],
  ['C', '16231', '목재 깔판류 및 기타 적재판 제조업'],
  ['C', '16232', '목재 포장용 상자, 드럼 및 유사용기 제조업'],
  ['C', '16291', '목재 도구 및 주방용 나무제품 제조업'],
  ['C', '16292', '장식용 목제품 제조업'],
  ['C', '16299', '그 외 기타 나무제품 제조업'],
  ['C', '16300', '코르크 및 조물제품 제조업'],
  ['C', '17101', '펄프 제조업'],
  ['C', '17102', '신문용지 제조업'],
  ['C', '17103', '인쇄용 및 필기용 원지 제조업'],
  ['C', '17104', '골판지 원지 제조업'],
  ['C', '17105', '크라프트지 및 기타 상자용 판지 제조업'],
  ['C', '17106', '위생용 원지 제조업'],
  ['C', '17109', '기타 종이 및 판지 제조업'],
  ['C', '17211', '골판지 제조업'],
  ['C', '17212', '골판지 상자 및 가공제품 제조업'],
  ['C', '17221', '종이 포대 및 가방 제조업'],
  ['C', '17222', '판지 상자 및 용기 제조업'],
  ['C', '17223', '식품 위생용 종이 상자 및 용기 제조업'],
  ['C', '17229', '기타 종이 상자 및 용기 제조업'],
  ['C', '17901', '문구용 종이제품 제조업'],
  ['C', '17902', '위생용 종이제품 제조업'],
  ['C', '17903', '벽지 및 장판지 제조업'],
  ['C', '17904', '적층, 합성 및 특수 표면처리 종이 제조업'],
  ['C', '17909', '그 외 기타 종이 및 판지 제품 제조업'],
  ['C', '18111', '경 인쇄업'],
  ['C', '18112', '스크린 인쇄업'],
  ['C', '18113', '오프셋 인쇄업'],
  ['C', '18119', '기타 인쇄업'],
  ['C', '18121', '제판 및 조판업'],
  ['C', '18122', '제책업'],
  ['C', '18129', '기타 인쇄관련 산업'],
  ['C', '18200', '기록매체 복제업'],
  ['C', '19100', '코크스 및 연탄 제조업'],
  ['C', '19210', '원유 정제처리업'],
  ['C', '19221', '윤활유 및 그리스 제조업'],
  ['C', '19229', '기타 석유정제물 재처리업'],
  ['C', '20111', '석유화학계 기초 화학물질 제조업'],
  ['C', '20112', '바이오매스계 기초 화학물질 제조업'],
  ['C', '20119', '기타 기초 유기 화학물질 제조업'],
  ['C', '20121', '수소 제조업'],
  ['C', '20122', '산소, 질소 및 기타 산업용 가스 제조업'],
  ['C', '20129', '기타 기초 무기 화학물질 제조업'],
  ['C', '20131', '무기안료용 금속 산화물 및 관련 제품 제조업'],
  ['C', '20132', '염료, 조제 무기안료, 유연제 및 기타 착색제 제조업'],
  ['C', '20201', '합성고무 제조업'],
  ['C', '20202', '합성수지 및 기타 플라스틱 물질 제조업'],
  ['C', '20203', '혼성 및 재생 플라스틱 소재 물질 제조업'],
  ['C', '20311', '질소화합물, 질소, 인산 및 칼리질 화학비료 제조업'],
  ['C', '20312', '복합비료 및 기타 화학비료 제조업'],
  ['C', '20313', '유기질 비료 및 상토 제조업'],
  ['C', '20321', '화학 살균ㆍ살충제 및 농업용 약제 제조업'],
  ['C', '20322', '생물 살균ㆍ살충제 및 식물보호제 제조업'],
  ['C', '20411', '일반용 도료 및 관련제품 제조업'],
  ['C', '20412', '요업용 도포제 및 관련제품 제조업'],
  ['C', '20413', '인쇄잉크 및 회화용 물감 제조업'],
  ['C', '20421', '계면활성제 제조업'],
  ['C', '20422', '치약, 비누 및 기타 세제 제조업'],
  ['C', '20423', '화장품 제조업'],
  ['C', '20424', '표면광택제 및 실내가향제 제조업'],
  ['C', '20491', '감광재료 및 관련 화학제품 제조업'],
  ['C', '20492', '가공 및 정제염 제조업'],
  ['C', '20493', '접착제 및 젤라틴 제조업'],
  ['C', '20494', '화약 및 불꽃제품 제조업'],
  ['C', '20495', '바이오 연료 및 혼합물 제조업'],
  ['C', '20499', '그 외 기타 분류 안된 화학제품 제조업'],
  ['C', '20501', '합성섬유 제조업'],
  ['C', '20502', '재생섬유 제조업'],
  ['C', '21100', '기초 의약 물질 제조업'],
  ['C', '21211', '생물 의약품 제조업'],
  ['C', '21212', '합성의약품 및 기타 완제 의약품 제조업'],
  ['C', '21220', '한의약품 제조업'],
  ['C', '21230', '동물용 의약품 제조업'],
  ['C', '21301', '체외 진단 시약 제조업'],
  ['C', '21309', '그 외 기타 의료용품 및 의약 관련제품 제조업'],
  ['C', '22110', '고무 타이어 및 튜브 제조업'],
  ['C', '22191', '고무패킹류 제조업'],
  ['C', '22192', '산업용 그 외 비경화 고무제품 제조업'],
  ['C', '22193', '고무 의류 및 기타 위생용 비경화 고무제품 제조업'],
  ['C', '22199', '그 외 기타 고무제품 제조업'],
  ['C', '22211', '플라스틱 선, 봉, 관 및 호스 제조업'],
  ['C', '22212', '플라스틱 필름 제조업'],
  ['C', '22213', '플라스틱 시트 및 판 제조업'],
  ['C', '22214', '플라스틱 합성피혁 제조업'],
  ['C', '22221', '벽 및 바닥 피복용 플라스틱제품 제조업'],
  ['C', '22222', '설치용 및 위생용 플라스틱제품 제조업'],
  ['C', '22223', '플라스틱 창호 제조업'],
  ['C', '22229', '기타 건축용 플라스틱 조립제품 제조업'],
  ['C', '22231', '플라스틱 포대, 봉투 및 유사제품 제조업'],
  ['C', '22232', '포장용 플라스틱 성형용기 제조업'],
  ['C', '22241', '운송장비 조립용 플라스틱제품 제조업'],
  ['C', '22249', '기타 기계ㆍ장비 조립용 플라스틱 제품 제조업'],
  ['C', '22251', '폴리스티렌 발포 성형제품 제조업'],
  ['C', '22259', '기타 플라스틱 발포 성형제품 제조업'],
  ['C', '22291', '플라스틱 접착처리 제품 제조업'],
  ['C', '22292', '플라스틱 적층, 도포 및 기타 표면처리 제품 제조업'],
  ['C', '22299', '그 외 기타 플라스틱 제품 제조업'],
  ['C', '23111', '판유리 제조업'],
  ['C', '23112', '안전유리 제조업'],
  ['C', '23119', '기타 판유리 가공품 제조업'],
  ['C', '23121', '1차 유리제품, 유리섬유 및 광학용 유리 제조업'],
  ['C', '23122', '디스플레이 장치용 유리 제조업'],
  ['C', '23129', '기타 산업용 유리제품 제조업'],
  ['C', '23191', '가정용 유리제품 제조업'],
  ['C', '23192', '포장용 유리용기 제조업'],
  ['C', '23199', '그 외 기타 유리제품 제조업'],
  ['C', '23211', '정형 내화 요업제품 제조업'],
  ['C', '23212', '부정형 내화 요업제품 제조업'],
  ['C', '23221', '가정용 및 장식용 도자기 제조업'],
  ['C', '23222', '위생용 및 산업용 도자기 제조업'],
  ['C', '23229', '기타 일반 도자기 제조업'],
  ['C', '23231', '점토 벽돌, 블록 및 유사 비내화 요업제품 제조업'],
  ['C', '23232', '타일 및 유사 비내화 요업제품 제조업'],
  ['C', '23239', '기타 건축용 비내화 요업제품 제조업'],
  ['C', '23311', '시멘트 제조업'],
  ['C', '23312', '석회 및 플라스터 제조업'],
  ['C', '23321', '비내화 모르타르 제조업'],
  ['C', '23322', '레미콘 제조업'],
  ['C', '23323', '플라스터 혼합제품 제조업'],
  ['C', '23324', '콘크리트 타일, 기와, 벽돌 및 블록 제조업'],
  ['C', '23325', '콘크리트 관 및 기타 구조용 콘크리트 제품 제조업'],
  ['C', '23326', '인조대리석 제품 제조업'],
  ['C', '23329', '그 외 기타 콘크리트 제품 및 유사제품 제조업'],
  ['C', '23911', '건설용 석제품 제조업'],
  ['C', '23919', '기타 석제품 제조업'],
  ['C', '23991', '아스팔트 콘크리트 및 혼합제품 제조업'],
  ['C', '23992', '연마재 제조업'],
  ['C', '23993', '비금속광물 분쇄물 생산업'],
  ['C', '23994', '암면 및 유사제품 제조업'],
  ['C', '23995', '탄소섬유 제조업'],
  ['C', '23999', '그 외 기타 분류 안된 비금속 광물제품 제조업'],
  ['C', '24111', '제철업'],
  ['C', '24112', '제강업'],
  ['C', '24113', '합금철 제조업'],
  ['C', '24119', '기타 제철 및 제강업'],
  ['C', '24121', '열간 압연 및 압출 제품 제조업'],
  ['C', '24122', '냉간 압연 및 압출 제품 제조업'],
  ['C', '24123', '철강선 제조업'],
  ['C', '24131', '주철관 제조업'],
  ['C', '24132', '강관 제조업'],
  ['C', '24133', '강관 가공품 및 관 연결구류 제조업'],
  ['C', '24191', '도금, 착색 및 기타 표면 처리강재 제조업'],
  ['C', '24199', '그 외 기타 1차 철강 제조업'],
  ['C', '24211', '동 제련, 정련 및 합금 제조업'],
  ['C', '24212', '알루미늄 제련, 정련 및 합금 제조업'],
  ['C', '24213', '연 및 아연 제련, 정련 및 합금 제조업'],
  ['C', '24219', '기타 비철금속 제련, 정련 및 합금 제조업'],
  ['C', '24221', '동 압연, 압출 및 연신제품 제조업'],
  ['C', '24222', '알루미늄 압연, 압출 및 연신제품 제조업'],
  ['C', '24229', '기타 비철금속 압연, 압출 및 연신 제품 제조업'],
  ['C', '24290', '기타 1차 비철금속 제조업'],
  ['C', '24311', '선철주물 주조업'],
  ['C', '24312', '강주물 주조업'],
  ['C', '24321', '알루미늄주물 주조업'],
  ['C', '24329', '기타 비철금속 주조업'],
  ['C', '25111', '금속 문, 창, 셔터 및 관련제품 제조업'],
  ['C', '25112', '구조용 금속 판제품 및 공작물 제조업'],
  ['C', '25113', '육상 금속 골조 구조재 제조업'],
  ['C', '25114', '수상 금속 골조 구조재 제조업'],
  ['C', '25119', '기타 구조용 금속제품 제조업'],
  ['C', '25121', '산업용 난방보일러 및 방열기 제조업'],
  ['C', '25122', '금속탱크 및 저장용기 제조업'],
  ['C', '25123', '압축 및 액화 가스용기 제조업'],
  ['C', '25130', '핵반응기 및 증기보일러 제조업'],
  ['C', '25200', '무기 및 총포탄 제조업'],
  ['C', '25911', '분말 야금제품 제조업'],
  ['C', '25912', '금속 단조제품 제조업'],
  ['C', '25913', '자동차용 금속 압형제품 제조업'],
  ['C', '25914', '그 외 금속 압형제품 제조업'],
  ['C', '25921', '금속 열처리업'],
  ['C', '25922', '도금업'],
  ['C', '25923', '도장 및 기타 피막처리업'],
  ['C', '25924', '절삭가공 및 유사처리업'],
  ['C', '25929', '그 외 기타 금속가공업'],
  ['C', '25931', '날붙이 제조업'],
  ['C', '25932', '일반철물 제조업'],
  ['C', '25933', '비동력식 수공구 제조업'],
  ['C', '25934', '톱 및 호환성 공구 제조업'],
  ['C', '25941', '볼트 및 너트류 제조업'],
  ['C', '25942', '그 외 금속파스너 및 나사제품 제조업'],
  ['C', '25943', '금속 스프링 제조업'],
  ['C', '25944', '금속선 가공제품 제조업'],
  ['C', '25991', '금속 캔 및 기타 포장용기 제조업'],
  ['C', '25992', '수동식 식품 가공기기 및 금속 주방용기 제조업'],
  ['C', '25993', '금속 위생용품 제조업'],
  ['C', '25994', '금속 표시판 제조업'],
  ['C', '25995', '피복 및 충전 용접봉 제조업'],
  ['C', '25999', '그 외 기타 분류 안된 금속 가공 제품 제조업'],
  ['C', '26111', '메모리용 전자집적회로 제조업'],
  ['C', '26112', '비메모리용 및 기타 전자집적회로 제조업'],
  ['C', '26121', '발광 다이오드 제조업'],
  ['C', '26129', '기타 반도체소자 제조업'],
  ['C', '26211', '액정 표시장치 제조업'],
  ['C', '26212', '유기발광 표시장치 제조업'],
  ['C', '26219', '기타 표시장치 제조업'],
  ['C', '26221', '인쇄회로기판용 적층판 제조업'],
  ['C', '26222', '경성 인쇄회로기판 제조업'],
  ['C', '26223', '연성 및 기타 인쇄회로기판 제조업'],
  ['C', '26224', '전자부품 실장기판 제조업'],
  ['C', '26291', '전자축전기 제조업'],
  ['C', '26292', '전자저항기 및 전자카드 제조업'],
  ['C', '26293', '전자코일, 변성기 및 기타 전자 유도자 제조업'],
  ['C', '26294', '전자감지장치 제조업'],
  ['C', '26299', '그 외 기타 전자부품 제조업'],
  ['C', '26310', '컴퓨터 제조업'],
  ['C', '26321', '기억장치 제조업'],
  ['C', '26322', '컴퓨터 모니터 제조업'],
  ['C', '26323', '컴퓨터 프린터 제조업'],
  ['C', '26329', '기타 주변기기 제조업'],
  ['C', '26410', '유선 통신장비 제조업'],
  ['C', '26421', '방송장비 제조업'],
  ['C', '26422', '이동전화기 제조업'],
  ['C', '26429', '기타 무선 통신장비 제조업'],
  ['C', '26511', '텔레비전 제조업'],
  ['C', '26519', '비디오 및 기타 영상기기 제조업'],
  ['C', '26521', '라디오, 녹음 및 재생 기기 제조업'],
  ['C', '26529', '기타 음향기기 제조업'],
  ['C', '26600', '마그네틱 및 광학 매체 제조업'],
  ['C', '27111', '방사선 장치 제조업'],
  ['C', '27112', '전기식 진단 및 요법 기기 제조업'],
  ['C', '27191', '치과용 기기 제조업'],
  ['C', '27192', '치과기공물 제조업'],
  ['C', '27193', '치과용 임플란트 제조업'],
  ['C', '27194', '정형외과용 및 신체 보정용 기기 제조업'],
  ['C', '27195', '안경 및 안경렌즈 제조업'],
  ['C', '27196', '의료용 가구 제조업'],
  ['C', '27199', '그 외 기타 의료용 기기 제조업'],
  ['C', '27211', '레이더, 항행용 무선기기 및 측량기구 제조업'],
  ['C', '27212', '전자기 측정, 시험 및 분석기구 제조업'],
  ['C', '27213', '물질 검사, 측정 및 분석기구 제조업'],
  ['C', '27214', '속도계 및 적산계기 제조업'],
  ['C', '27215', '기기용 자동측정 및 제어장치 제조업'],
  ['C', '27216', '산업처리공정 제어장비 제조업'],
  ['C', '27219', '기타 측정, 시험, 항해, 제어 및 정밀기기 제조업'],
  ['C', '27220', '시계 및 시계부품 제조업'],
  ['C', '27301', '광학렌즈 및 광학요소 제조업'],
  ['C', '27309', '기타 광학기기 및 사진기 제조업'],
  ['C', '28111', '전동기 및 발전기 제조업'],
  ['C', '28112', '변압기 제조업'],
  ['C', '28113', '에너지 저장장치 제조업'],
  ['C', '28119', '기타 전기 변환장치 제조업'],
  ['C', '28121', '전기회로 개폐, 보호장치 제조업'],
  ['C', '28122', '전기회로 접속장치 제조업'],
  ['C', '28123', '배전반 및 전기 자동제어반 제조업'],
  ['C', '28201', '일차전지 제조업'],
  ['C', '28202', '운송장비용 이차전지 제조업'],
  ['C', '28209', '기타 이차전지 제조업'],
  ['C', '28301', '광섬유 케이블 제조업'],
  ['C', '28302', '기타 절연선 및 케이블 제조업'],
  ['C', '28303', '절연 코드세트 및 기타 도체 제조업'],
  ['C', '28410', '전구 및 램프 제조업'],
  ['C', '28421', '운송장비용 조명장치 제조업'],
  ['C', '28422', '일반용 전기 조명장치 제조업'],
  ['C', '28423', '전시 및 광고용 조명장치 제조업'],
  ['C', '28429', '기타 조명장치 제조업'],
  ['C', '28511', '주방용 전기기기 제조업'],
  ['C', '28512', '가정용 전기 난방기기 제조업'],
  ['C', '28519', '기타 가정용 전기기기 제조업'],
  ['C', '28520', '가정용 비전기식 조리 및 난방 기구 제조업'],
  ['C', '28901', '전기경보 및 신호장치 제조업'],
  ['C', '28902', '전기용 탄소제품 및 절연제품 제조업'],
  ['C', '28903', '교통 신호장치 제조업'],
  ['C', '28909', '그 외 기타 전기장비 제조업'],
  ['C', '29111', '내연기관 제조업'],
  ['C', '29119', '기타 기관 및 터빈 제조업'],
  ['C', '29120', '유압기기 제조업'],
  ['C', '29131', '액체 펌프 제조업'],
  ['C', '29132', '기체 펌프 및 압축기 제조업'],
  ['C', '29133', '탭, 밸브 및 유사장치 제조업'],
  ['C', '29141', '구름베어링 제조업'],
  ['C', '29142', '기어 및 동력전달장치 제조업'],
  ['C', '29150', '산업용 오븐, 노 및 노용 버너 제조업'],
  ['C', '29161', '산업용 트럭 및 적재기 제조업'],
  ['C', '29162', '승강기 제조업'],
  ['C', '29163', '컨베이어장치 제조업'],
  ['C', '29169', '기타 물품 취급장비 제조업'],
  ['C', '29171', '산업용 냉장 및 냉동 장비 제조업'],
  ['C', '29172', '가정용 및 산업용 공기 조화장치 제조업'],
  ['C', '29173', '운송장비용 공기 조화장치 제조업'],
  ['C', '29174', '산업용 송풍기 및 배기장치 제조업'],
  ['C', '29175', '기체 여과기 제조업'],
  ['C', '29176', '액체 여과기 제조업'],
  ['C', '29177', '증류기, 열교환기 및 가스발생기 제조업'],
  ['C', '29180', '사무용 기계 및 장비 제조업'],
  ['C', '29191', '용기 세척, 포장 및 충전기 제조업'],
  ['C', '29192', '분사기 및 소화기 제조업'],
  ['C', '29193', '동력식 수지공구 제조업'],
  ['C', '29199', '그 외 기타 일반목적용 기계 제조업'],
  ['C', '29210', '농업 및 임업용 기계 제조업'],
  ['C', '29221', '전자 응용 절삭기계 제조업'],
  ['C', '29222', '디지털 적층 성형기계 제조업'],
  ['C', '29223', '금속 절삭기계 제조업'],
  ['C', '29224', '금속 성형기계 제조업'],
  ['C', '29229', '기타 가공 공작기계 제조업'],
  ['C', '29230', '금속 주조 및 기타 야금용 기계 제조업'],
  ['C', '29241', '건설 및 채광용 기계장비 제조업'],
  ['C', '29242', '광물처리 및 취급장비 제조업'],
  ['C', '29250', '음ㆍ식료품 및 담배 가공기계 제조업'],
  ['C', '29261', '산업용 섬유 세척, 염색, 정리 및 가공 기계 제조업'],
  ['C', '29269', '기타 섬유, 의복 및 가죽 가공 기계 제조업'],
  ['C', '29271', '반도체 제조용 기계 제조업'],
  ['C', '29272', '디스플레이 제조용 기계 제조업'],
  ['C', '29280', '산업용 로봇 제조업'],
  ['C', '29291', '고무, 화학섬유 및 플라스틱 성형기 제조업'],
  ['C', '29292', '인쇄 및 제책용 기계 제조업'],
  ['C', '29293', '주형 및 금형 제조업'],
  ['C', '29299', '그 외 기타 특수목적용 기계 제조업'],
  ['C', '30110', '자동차용 엔진 제조업'],
  ['C', '30121', '내연기관 승용차 및 기타 여객용 자동차 제조업'],
  ['C', '30122', '전기 승용차 및 기타 여객용 전기 자동차 제조업'],
  ['C', '30123', '내연기관 화물자동차 및 특수목적용 자동차 제조업'],
  ['C', '30124', '전기 화물자동차 및 특수목적용 전기 자동차 제조업'],
  ['C', '30201', '차체 및 특장차 제조업'],
  ['C', '30202', '자동차 구조 및 장치 변경업'],
  ['C', '30203', '트레일러 및 세미트레일러 제조업'],
  ['C', '30310', '자동차 엔진용 신품 부품 제조업'],
  ['C', '30320', '자동차 차체용 신품 부품 제조업'],
  ['C', '30331', '자동차용 신품 동력전달장치 제조업'],
  ['C', '30332', '자동차용 신품 전기장치 제조업'],
  ['C', '30391', '자동차용 신품 조향장치 및 현가 장치 제조업'],
  ['C', '30392', '자동차용 신품 제동장치 제조업'],
  ['C', '30393', '자동차용 신품 의자 제조업'],
  ['C', '30399', '그 외 자동차용 신품 부품 제조업'],
  ['C', '30400', '자동차 재제조 부품 제조업'],
  ['C', '31111', '강선 건조업'],
  ['C', '31112', '합성수지선 건조업'],
  ['C', '31113', '기타 선박 건조업'],
  ['C', '31114', '선박 구성 부분품 제조업'],
  ['C', '31120', '오락 및 스포츠용 보트 건조업'],
  ['C', '31201', '기관차 및 기타 철도차량 제조업'],
  ['C', '31202', '철도차량 부품 및 관련 장치물 제조업'],
  ['C', '31311', '유인 항공기, 항공우주선 및 보조장치 제조업'],
  ['C', '31312', '무인 항공기 및 무인 비행장치 제조업'],
  ['C', '31321', '항공기용 엔진 제조업'],
  ['C', '31322', '항공기용 부품 제조업'],
  ['C', '31910', '전투용 차량 제조업'],
  ['C', '31921', '모터사이클 제조업'],
  ['C', '31922', '개인용 전기식 이동수단 제조업'],
  ['C', '31991', '자전거 및 환자용 차량 제조업'],
  ['C', '31999', '그 외 기타 달리 분류되지 않은 운송장비 제조업'],
  ['C', '32011', '매트리스 및 침대 제조업'],
  ['C', '32019', '소파 및 기타 내장가구 제조업'],
  ['C', '32021', '주방용 및 음식점용 목재가구 제조업'],
  ['C', '32029', '기타 목재가구 제조업'],
  ['C', '32091', '금속 가구 제조업'],
  ['C', '32099', '그 외 기타 가구 제조업'],
  ['C', '33110', '귀금속 및 관련제품 제조업'],
  ['C', '33120', '모조 귀금속 및 모조 장신용품 제조업'],
  ['C', '33201', '건반 악기 제조업'],
  ['C', '33209', '기타 악기 및 전자 악기 제조업'],
  ['C', '33301', '체조, 육상 및 체력단련용 장비 제조업'],
  ['C', '33302', '놀이터용 장비 제조업'],
  ['C', '33303', '낚시 및 수렵용구 제조업'],
  ['C', '33309', '기타 운동 및 경기용구 제조업'],
  ['C', '33401', '인형 및 장난감 제조업'],
  ['C', '33402', '영상게임기 제조업'],
  ['C', '33409', '기타 오락용품 제조업'],
  ['C', '33910', '간판 및 광고물 제조업'],
  ['C', '33920', '사무 및 회화용품 제조업'],
  ['C', '33931', '가발 및 유사 제품 제조업'],
  ['C', '33932', '전시용 모형 제조업'],
  ['C', '33933', '표구처리업'],
  ['C', '33991', '단추 및 유사 파스너 제조업'],
  ['C', '33992', '라이터, 연소물 및 흡연용품 제조업'],
  ['C', '33993', '비 및 솔 제조업'],
  ['C', '33999', '그 외 기타 달리 분류되지 않은 제품 제조업'],
  ['C', '34011', '건설ㆍ광업용 기계 및 장비 수리업'],
  ['C', '34019', '기타 일반 기계 및 장비 수리업'],
  ['C', '34020', '전기ㆍ전자 및 정밀기기 수리업'],

  ['D', '35112', '수력 발전업'],
  ['D', '35114', '태양력 발전업'],
  ['D', '35115', '풍력 발전업'],
  ['D', '35119', '기타 발전업'],

  ['E', '37011', '하수 처리업'],
  ['E', '37012', '폐수 처리업'],
  ['E', '37022', '축산 분뇨 처리업'],
  ['E', '38110', '지정 외 폐기물 수집, 운반업'],
  ['E', '38120', '지정 폐기물 수집, 운반업'],
  ['E', '38210', '지정 외 폐기물 처리업'],
  ['E', '38220', '지정 폐기물 처리업'],
  ['E', '38230', '건설 폐기물 처리업'],
  ['E', '38240', '방사성 폐기물 수집, 운반 및 처리업'],
  ['E', '38311', '금속류 해체 및 선별업'],
  ['E', '38312', '금속류 원료 재생업'],
  ['E', '38321', '비금속류 해체 및 선별업'],
  ['E', '38322', '비금속류 원료 재생업'],
  ['E', '39001', '토양 및 지하수 정화업'],

  ['F', '41121', '사무ㆍ상업용 및 공공기관용 건물 건설업'],
  ['F', '41122', '제조업 및 유사 산업용 건물 건설업'],
  ['F', '41129', '기타 비주거용 건물 건설업'],
  ['F', '41210', '지반조성 건설업'],
  ['F', '41221', '도로 건설업'],
  ['F', '41222', '교량, 터널 및 철도 건설업'],
  ['F', '41223', '항만, 수로, 댐 및 유사 구조물 건설업'],
  ['F', '41224', '환경설비 건설업'],
  ['F', '41225', '산업생산시설 종합건설업'],
  ['F', '41226', '조경 건설업'],
  ['F', '41229', '기타 토목시설물 건설업'],
  ['F', '42201', '배관 및 냉ㆍ난방 공사업'],
  ['F', '42202', '건물용 기계ㆍ장비 설치 공사업'],
  ['F', '42203', '승강설비 설치 공사업'],
  ['F', '42204', '방음, 방진 및 내화 공사업'],
  ['F', '42205', '소방시설 공사업'],
  ['F', '42209', '기타 건물 관련설비 설치 공사업'],

  ['G', '45211', '자동차 신품 타이어 및 튜브 판매업'],
  ['G', '45212', '자동차용 전용 신품 부품 판매업'],
  ['G', '45213', '자동차 내장용 신품 전기ㆍ전자ㆍ정밀 기기 판매업'],
  ['G', '45219', '기타 자동차 신품 부품 및 내장품 판매업'],
  ['G', '46101', '산업용 농ㆍ축산물, 섬유 원료 및 동물 중개업'],
  ['G', '46102', '음ㆍ식료품 및 담배 중개업'],
  ['G', '46103', '섬유, 의복, 신발 및 가죽제품 중개업'],
  ['G', '46104', '목재 및 건축자재 중개업'],
  ['G', '46105', '연료, 광물, 1차 금속, 비료 및 화학제품 중개업'],
  ['G', '46106', '기계 및 장비 중개업'],
  ['G', '46107', '그 외 기타 특정 상품 중개업'],
  ['G', '46109', '상품 종합 중개업'],
  ['G', '46311', '과실류 도매업'],
  ['G', '46312', '채소류, 서류 및 향신작물류 도매업'],
  ['G', '46313', '육류 도매업'],
  ['G', '46314', '건어물 및 젓갈류 도매업'],
  ['G', '46315', '신선, 냉동 및 기타 수산물 도매업'],
  ['G', '46319', '기타 신선식품 및 단순 가공식품 도매업'],
  ['G', '46321', '육류 가공식품 도매업'],
  ['G', '46322', '수산물 가공식품 도매업'],
  ['G', '46323', '빵류, 과자류, 당류, 초콜릿 도매업'],
  ['G', '46324', '낙농품 및 동ㆍ식물성 유지 도매업'],
  ['G', '46325', '커피 및 차류 도매업'],
  ['G', '46326', '조미료 도매업'],
  ['G', '46329', '기타 가공식품 도매업'],
  ['G', '46332', '비알코올음료 도매업'],
  ['G', '46413', '남녀용 겉옷 및 셔츠 도매업'],
  ['G', '46414', '유아용 의류 도매업'],
  ['G', '46415', '속옷 및 잠옷 도매업'],
  ['G', '46416', '가죽 및 모피제품 도매업'],
  ['G', '46417', '의복 액세서리 및 모조 장신구 도매업'],
  ['G', '46420', '신발 도매업'],
  ['G', '46462', '악기 도매업'],
  ['G', '46491', '가방 및 보호용 케이스 도매업'],
  ['G', '46510', '컴퓨터 및 주변장치, 소프트웨어 도매업'],
  ['G', '46521', '가전제품 및 부품 도매업'],
  ['G', '46522', '통신ㆍ방송장비 및 부품 도매업'],
  ['G', '46531', '농림업용 기계 및 장비 도매업'],
  ['G', '46532', '건설ㆍ광업용 기계 및 장비 도매업'],
  ['G', '46533', '공작용 기계 및 장비 도매업'],
  ['G', '46539', '기타 산업용 기계 및 장비 도매업'],
  ['G', '46591', '사무용 가구 및 기기 도매업'],
  ['G', '46592', '의료기기 도매업'],
  ['G', '46593', '정밀기기 및 과학기기 도매업'],
  ['G', '46594', '수송용 운송장비 도매업'],
  ['G', '46595', '전기용 기계ㆍ장비 및 관련 기자재 도매업'],
  ['G', '46596', '전지 및 케이블 도매업'],
  ['G', '46599', '그 외 기타 기계 및 장비 도매업'],
  ['G', '46621', '배관 및 냉ㆍ난방장치 도매업'],
  ['G', '46622', '철물, 금속 파스너 및 수공구 도매업'],
  ['G', '46711', '고체연료 및 관련제품 도매업'],
  ['G', '46712', '액체연료 및 관련제품 도매업'],
  ['G', '46713', '기체연료 및 관련제품 도매업'],
  ['G', '46721', '1차 금속제품 도매업'],
  ['G', '46722', '금속광물 도매업'],
  ['G', '46731', '염료, 안료 및 관련제품 도매업'],
  ['G', '46732', '비료 및 농약 도매업'],
  ['G', '46733', '플라스틱물질 및 합성고무 도매업'],
  ['G', '46739', '기타 화학물질 및 화학제품 도매업'],
  ['G', '46741', '방직용 섬유 및 실 도매업'],
  ['G', '46742', '직물 도매업'],
  ['G', '46750', '종이 원지, 판지, 종이상자 도매업'],
  ['G', '46791', '재생용 재료 수집 및 판매업'],
  ['G', '46799', '그 외 기타 상품 전문 도매업'],
  ['G', '46800', '상품 종합 도매업'],
  ['G', '47411', '남자용 겉옷 소매업'],
  ['G', '47412', '여자용 겉옷 소매업'],
  ['G', '47413', '속옷 및 잠옷 소매업'],
  ['G', '47414', '셔츠 및 블라우스 소매업'],
  ['G', '47415', '한복 소매업'],
  ['G', '47416', '가죽 및 모피의복 소매업'],
  ['G', '47417', '유아용 의류 소매업'],
  ['G', '47419', '기타 의복 소매업'],
  ['G', '47421', '가정용 직물제품 소매업'],
  ['G', '47422', '의복 액세서리 및 모조 장신구 소매업'],
  ['G', '47429', '섬유 원단, 실 및 기타 섬유제품 소매업'],
  ['G', '47430', '신발 소매업'],
  ['G', '47440', '가방 및 기타 가죽제품 소매업'],
  ['G', '47911', '전자상거래 소매 중개업'],
  ['G', '47912', '전자상거래 소매업'],
  ['G', '47919', '기타 통신 판매업'],
  ['G', '47920', '노점 및 유사이동 소매업'],
  ['G', '47991', '자동판매기 운영업'],
  ['G', '47992', '계약배달 판매업'],
  ['G', '47993', '방문 판매업'],
  ['G', '47999', '그 외 기타 무점포 소매업'],

  ['H', '50111', '외항 여객 운송업'],
  ['H', '50112', '외항 화물 운송업'],
  ['H', '50121', '내항 여객 운송업'],
  ['H', '50122', '내항 화물 운송업'],
  ['H', '50130', '기타 해상 운송업'],
  ['H', '52921', '항구 및 기타 해상 터미널 운영업'],
  ['H', '52922', '선박관리업'],
  ['H', '52929', '기타 수상 운송지원 서비스업'],
  ['H', '52942', '수상 화물 취급업'],
  ['H', '52992', '화물운송 중개, 대리 및 관련 서비스업'],

  ['I', '56111', '한식 일반 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56112', '한식 면요리 전문점', FOOD_SERVICE_NOTE],
  ['I', '56113', '한식 육류요리 전문점', FOOD_SERVICE_NOTE],
  ['I', '56114', '한식 해산물요리 전문점', FOOD_SERVICE_NOTE],
  ['I', '56121', '중식 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56122', '일식 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56123', '서양식 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56129', '기타 외국식 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56130', '기관 구내식당업', FOOD_SERVICE_NOTE],
  ['I', '56141', '출장 음식 서비스업', FOOD_SERVICE_NOTE],
  ['I', '56142', '이동 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56150', '제과점업', FOOD_SERVICE_NOTE],
  ['I', '56161', '피자, 햄버거, 샌드위치 및 유사 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56162', '치킨 전문점', FOOD_SERVICE_NOTE],
  ['I', '56191', '김밥 및 기타 간이 음식점업', FOOD_SERVICE_NOTE],
  ['I', '56199', '간이음식 포장 판매 전문점', FOOD_SERVICE_NOTE],

  ['J', '58111', '교과서 및 학습서적 출판업'],
  ['J', '58112', '만화 출판업'],
  ['J', '58113', '일반 서적 출판업'],
  ['J', '58190', '기타 인쇄물 출판업'],
  ['J', '58211', '유선 온라인 게임 소프트웨어 개발 및 공급업'],
  ['J', '58212', '모바일 게임 소프트웨어 개발 및 공급업'],
  ['J', '58219', '기타 게임 소프트웨어 개발 및 공급업'],
  ['J', '58221', '시스템 소프트웨어 개발 및 공급업'],
  ['J', '58222', '응용 소프트웨어 개발 및 공급업'],
  ['J', '59111', '일반 영화 및 비디오물 제작업'],
  ['J', '59112', '애니메이션 영화 및 비디오물 제작업'],
  ['J', '59113', '광고 영화 및 비디오물 제작업'],
  ['J', '59114', '방송 프로그램 제작업'],
  ['J', '59120', '영화, 비디오물 및 방송프로그램 제작 관련 서비스업'],
  ['J', '59201', '음악 및 기타 오디오물 출판업'],
  ['J', '59202', '녹음시설 운영업'],
  ['J', '60100', '라디오 방송업'],
  ['J', '60221', '프로그램 공급업'],
  ['J', '60222', '유선 방송업'],
  ['J', '60229', '위성 및 기타 방송업'],
  ['J', '60310', '영상물 제공 서비스업'],
  ['J', '60320', '오디오물 제공 서비스업'],
  ['J', '61210', '유선 통신업'],
  ['J', '61220', '무선 및 위성 통신업'],
  ['J', '61291', '통신 재판매업'],
  ['J', '61299', '그 외 기타 전기 통신업'],
  ['J', '62010', '컴퓨터 프로그래밍 서비스업'],
  ['J', '62021', '컴퓨터시스템 통합 자문 및 구축 서비스업'],
  ['J', '62022', '컴퓨터시설 관리업'],
  ['J', '62090', '기타 정보기술 및 컴퓨터운영 관련 서비스업'],
  ['J', '63111', '자료 처리업'],
  ['J', '63112', '호스팅 및 관련 서비스업'],
  ['J', '63120', '포털 및 기타 인터넷 정보매개 서비스업'],
  ['J', '63910', '뉴스 제공업'],
  ['J', '63991', '데이터베이스 및 온라인 정보 제공업'],
  ['J', '63999', '그 외 기타 정보 서비스업'],

  ['M', '70111', '물리, 화학 및 생물학 연구개발업'],
  ['M', '70112', '농림수산학 및 수의학 연구개발업'],
  ['M', '70113', '의학 및 약학 연구개발업'],
  ['M', '70119', '기타 자연과학 연구개발업'],
  ['M', '70121', '전기ㆍ전자공학 연구개발업'],
  ['M', '70129', '기타 공학 연구개발업'],
  ['M', '70130', '자연과학 및 공학 융합 연구개발업'],
  ['M', '70201', '경제 및 경영학 연구개발업'],
  ['M', '70209', '기타 인문 및 사회과학 연구개발업'],
  ['M', '71310', '광고 대행업'],
  ['M', '71391', '옥외 광고업'],
  ['M', '71392', '광고물 문안, 도안, 설계 등 작성업'],
  ['M', '71399', '그 외 기타 광고 관련 서비스업'],
  ['M', '72111', '건축설계 및 관련 서비스업'],
  ['M', '72112', '도시계획 및 조경설계 서비스업'],
  ['M', '72121', '건물 및 토목 엔지니어링 서비스업'],
  ['M', '72122', '환경 관련 엔지니어링 서비스업'],
  ['M', '72129', '기타 엔지니어링 서비스업'],
  ['M', '72911', '물질성분 검사 및 분석업'],
  ['M', '72919', '기타 기술 시험, 검사 및 분석업'],
  ['M', '72921', '측량업'],
  ['M', '72922', '제도업'],
  ['M', '72923', '지질 조사ㆍ탐사 및 지도 제작업'],
  ['M', '73201', '인테리어 디자인업'],
  ['M', '73202', '제품 디자인업'],
  ['M', '73203', '시각 디자인업'],
  ['M', '73209', '패션, 섬유류 및 기타 전문 디자인업'],

  ['N', '74100', '사업시설 유지ㆍ관리 서비스업'],
  ['N', '74211', '건축물 일반 청소업'],
  ['N', '74212', '산업설비, 운송장비 및 공공장소 청소업'],
  ['N', '74220', '소독, 구충 및 방제 서비스업'],
  ['N', '75122', '상용 인력 공급 및 인사관리 서비스업'],
  ['N', '75210', '여행사업'],
  ['N', '75320', '보안시스템 서비스업'],
  ['N', '75992', '전시, 컨벤션 및 행사 대행업'],
  ['N', '75994', '포장 및 충전업'],

  ['P', '85110', '유아 교육기관'],
  ['P', '85650', '직원훈련기관'],
  ['P', '85669', '기타 기술 및 직업훈련학원'],

  ['Q', '87111', '노인 요양 복지시설 운영업'],
  ['Q', '87112', '노인 양로 복지시설 운영업'],
  ['Q', '87121', '신체 부자유자 거주 복지시설 운영업'],
  ['Q', '87122', '정신질환, 정신지체 및 약물 중독자 거주 복지시설 운영업'],
  ['Q', '87131', '아동 및 부녀자 거주 복지시설 운영업'],
  ['Q', '87139', '그 외 기타 거주 복지시설 운영업'],
  ['Q', '87210', '보육시설 운영업'],
  ['Q', '87291', '직업재활원 운영업'],
  ['Q', '87292', '종합복지관 운영업'],
  ['Q', '87293', '방문 복지서비스 제공업'],
  ['Q', '87294', '사회복지 상담서비스 제공업'],
  ['Q', '87299', '그 외 기타 비거주 복지 서비스업'],

  ['R', '90121', '연극단체'],
  ['R', '90191', '공연 기획업'],

  ['S', '95211', '자동차 종합 수리업'],
  ['S', '95212', '자동차 전문 수리업'],
  ['S', '95220', '모터사이클 수리업'],
];

// 사업자등록증에는 표준산업분류(4~5자리)가 아니라 국세청 업종코드(6자리)가 적히는 경우가
// 많고, 그 코드는 대개 표준산업분류 코드를 앞자리로 그대로 포함한다. 숫자만 남긴 입력이
// 정확히 일치하지 않으면 그 다음으로 가장 긴 접두 일치를 참고용으로 보여준다.
function normalizeIndustryCode(code) {
  return String(code === null || code === undefined ? '' : code).replace(/[^0-9]/g, '');
}

function checkSuccessionIndustry(inputCode) {
  const normalized = normalizeIndustryCode(inputCode);
  if (!normalized) {
    return {
      normalized: '', matched: false, approximate: false,
      category: '', categoryName: '', name: '', note: '',
    };
  }
  let entry = SUCCESSION_INDUSTRY_CODES.find((row) => row[1] === normalized);
  let approximate = false;
  if (!entry) {
    const prefixMatches = SUCCESSION_INDUSTRY_CODES
      .filter((row) => normalized.indexOf(row[1]) === 0)
      .sort((a, b) => b[1].length - a[1].length);
    if (prefixMatches.length > 0) {
      entry = prefixMatches[0];
      approximate = true;
    }
  }
  if (!entry) {
    return {
      normalized, matched: false, approximate: false,
      category: '', categoryName: '', name: '', note: '',
    };
  }
  const [category, code, name, note] = entry;
  return {
    normalized, matched: true, approximate,
    matchedCode: code,
    category, categoryName: SUCCESSION_INDUSTRY_CATEGORIES[category] || '',
    name, note: note || '',
  };
}

// 피상속인·상속인 요건 (상증법 제18조의2 제1항, 같은 법 시행령 제15조 제3항).
// 각 요건은 예/아니오로만 판단하는 정성적 체크리스트이므로 세액처럼 계산하지 않고
// 화면에서 그대로 나열해 체크박스로 쓴다.
const SUCCESSION_DECEDENT_REQUIREMENTS = [
  {
    id: 'continuity',
    label: '중소기업 또는 매출액 5천억원 미만 중견기업을 10년 이상 계속하여 경영',
    basis: '상증법 제18조의2 제1항',
  },
  {
    id: 'shareholding',
    label: '피상속인이 특수관계인 지분 포함 최대주주등으로서 지분 40%(상장법인 20%) 이상을 10년 이상 계속 보유',
    basis: '상증법 시행령 제15조 제3항 제1호',
  },
  {
    id: 'ceoTerm',
    label: '가업 영위기간의 50% 이상, 상속개시일 전 10년 중 5년 이상, 또는 상속인이 대표이사직을 승계해 상속개시일까지 계속(10년 이상) 재직 — 셋 중 하나를 대표이사로 재직',
    basis: '상증법 시행령 제15조 제3항 제1호',
  },
];

const SUCCESSION_HEIR_REQUIREMENTS = [
  { id: 'age', label: '상속개시일 현재 18세 이상', basis: '상증법 시행령 제15조 제3항 제2호' },
  {
    id: 'engage',
    label: '상속개시일 전 2년 이상 직접 가업에 종사 (피상속인이 65세 이전 사망, 천재지변ㆍ인재 등 부득이한 사유가 있으면 예외)',
    basis: '상증법 시행령 제15조 제3항 제2호',
  },
  { id: 'officer', label: '상속세 과세표준 신고기한까지 임원으로 취임', basis: '상증법 시행령 제15조 제3항 제2호' },
  { id: 'ceo', label: '신고기한부터 2년 이내 대표이사등으로 취임', basis: '상증법 시행령 제15조 제3항 제2호' },
];

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
    SUCCESSION_INDUSTRY_CATEGORIES,
    SUCCESSION_INDUSTRY_CODES,
    SUCCESSION_DECEDENT_REQUIREMENTS,
    SUCCESSION_HEIR_REQUIREMENTS,
    checkSuccessionIndustry,
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
