#!/usr/bin/env node
/**
 * 「AI 세무사」 스킬의 계산 실행기 — company_tax/tax-review/ 의 검증된 계산 모듈을 CLI 로 부른다.
 *
 * 세율·공제 상수를 이 파일에 두지 않는다. 법정 수치는 calc.js 에만 있다 (프로젝트 원칙 제1조).
 * 여기 있는 것은 인자 파싱과 출력 서식뿐이다. 의존성이 없고 네트워크를 쓰지 않는다 (제4조).
 *
 * 금액 플래그의 단위는 화면과 같은 만원이다. 20억 -> --re 200000
 *
 *   node tax.js <세목> [플래그...]
 *   node tax.js help [세목]
 *   node tax.js selftest          재생성 프롬프트 §8 자기검증 벡터 대조
 */

const path = require('path');

// scripts -> tax-review -> skills -> .claude -> 프로젝트 루트
const REVIEW_DIR = path.join(__dirname, '..', '..', '..', '..', 'company_tax', 'tax-review');
const calc = require(path.join(REVIEW_DIR, 'calc.js'));
const fp = require(path.join(REVIEW_DIR, 'fp.js'));

const MANWON = 10000;
const 억 = 100000000;

// ══════════════════════════ 인자 ══════════════════════════

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) !== '--') { rest.push(a); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.slice(0, 2) === '--') flags[a.slice(2)] = true;
    else { flags[a.slice(2)] = next; i++; }
  }
  return { flags: flags, rest: rest };
}

const num = (f, k, def) => (f[k] === undefined ? def : Number(f[k]));
const won = (f, k) => num(f, k, 0) * MANWON;
// --spouse / --no-spouse / --spouse false 를 모두 받는다.
const on = (f, k, def) => {
  if (f['no-' + k] !== undefined) return false;
  if (f[k] === undefined) return def;
  return f[k] !== 'false' && f[k] !== '아니오';
};
// 미입력(null)과 0을 구분해야 하는 자리 — calc.js 가 null 을 "가정으로 갈음"으로 읽는다.
const wonOrNull = (f, k) => (f[k] === undefined ? null : won(f, k));

// 적용 기준 — 현행 / 2026 세제개편안. 개편안은 적용 연도별로 값이 다르다.
function basisOf(f) {
  const reform = /reform|개편/.test(String(f.basis || ''));
  const years = {
    2027: calc.BASIS_YEAR_2027, 2028: calc.BASIS_YEAR_2028, 2029: calc.BASIS_YEAR_2029,
  };
  return {
    basis: reform ? calc.BASIS_REFORM_2026 : calc.BASIS_CURRENT,
    basisYear: years[num(f, 'year', 2027)] || calc.BASIS_YEAR_2027,
  };
}

// ══════════════════════════ 출력 ══════════════════════════

// index.html 의 formatWon 과 같은 표기. Infinity 는 「한도 없음」으로 낸다 —
// 종부세·양도세의 한도 없음이 '—' 로 보이면 결측과 구분되지 않는다.
function W(v) {
  if (v === Infinity) return '한도 없음';
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.round(v);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs > 0 && abs < MANWON) return sign + abs.toLocaleString('ko-KR') + '원';
  let eok = Math.floor(abs / 억);
  let man = Math.round((abs % 억) / MANWON);
  if (man >= 10000) { eok += 1; man -= 10000; }
  if (eok > 0 && man > 0) return sign + eok.toLocaleString('ko-KR') + '억 ' + man.toLocaleString('ko-KR') + '만원';
  if (eok > 0) return sign + eok.toLocaleString('ko-KR') + '억원';
  return sign + man.toLocaleString('ko-KR') + '만원';
}

const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1).replace(/\.0$/, '') + '%' : '—');

function print(title, rows) {
  console.log('== ' + title + ' ==');
  rows.filter(Boolean).forEach((r) => console.log('  ' + r[0] + ': ' + r[1]));
}

// ══════════════════════════ 근속기간 ══════════════════════════

// 소득세법 제22조 제3항의 경계일은 2012.1.1. 과 2020.1.1. 이다.
// index.html 의 serviceSpans 와 같은 방식 — 월수만 세고 연수 배분은 calc.js 가 한다.
const digits = (s) => String(s || '').replace(/\D/g, '');

function monthsBetween(from, to) {
  const a = digits(from), b = digits(to);
  if (a.length !== 8 || b.length !== 8) return 0;
  let m = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(4, 6) - +a.slice(4, 6));
  if (+b.slice(6, 8) < +a.slice(6, 8)) m -= 1;
  return m > 0 ? m : 0;
}

function serviceSpans(join, out) {
  const j = digits(join), o = digits(out);
  const total = monthsBetween(j, o);
  if (total === 0) return { serviceYears: 0, yearsUntil2011: 0, years2012to2019: 0, months: 0 };
  const earlier = (x, y) => (x < y ? x : y);
  const later = (x, y) => (x > y ? x : y);
  const spans = calc.allocateServiceYears({
    totalMonths: total,
    monthsUntil2011: monthsBetween(j, earlier(o, '20120101')),
    months2012to2019: monthsBetween(later(j, '20120101'), earlier(o, '20200101')),
  });
  spans.months = total;
  return spans;
}

// ══════════════════════════ 세목 ══════════════════════════

const COMMANDS = {

  inherit: {
    desc: '상속세 — --second 를 붙이면 2차 상속까지',
    flags: [
      '--re N             부동산',
      '--cash N           금융자산(현금)',
      '--etc N            기타자산',
      '--no-spouse        배우자 없음 (기본: 있음)',
      '--children N       자녀 수 (기본 2)',
      '--debt N           채무 합계',
      '--fin-debt N       그중 금융기관 채무',
      '--funeral N        장례비용',
      '--pregift N        사전증여재산',
      '--spouse-actual N  배우자 실제 상속액 (미입력이면 법정상속분 가정)',
      '--minor-years N    미성년자 잔여연수 합계',
      '--elders N         65세 이상 부양가족 수',
      '--disabled-years N 장애인 기대여명 합계',
      '--skip-share N     세대생략 상속분',
      '--skip-minor       세대생략 상속인이 미성년자',
      '--second           2차 상속(배우자 사망)까지 계산',
      '--spouse-asset N   배우자 고유재산 (--second 용)',
      '--spouse-fin N     그중 금융자산',
    ],
    run: function (f) {
      const r = calc.calculateInheritanceTax({
        realEstate: won(f, 're'), cash: won(f, 'cash'), other: won(f, 'etc'),
        hasSpouse: on(f, 'spouse', true), numChildren: num(f, 'children', 2),
        debt: won(f, 'debt'), financialDebt: won(f, 'fin-debt'),
        funeralCost: won(f, 'funeral'), priorGift: won(f, 'pregift'),
        actualSpouseShare: wonOrNull(f, 'spouse-actual'),
        minorYearsTotal: num(f, 'minor-years', 0), numElderly: num(f, 'elders', 0),
        disabledYearsTotal: num(f, 'disabled-years', 0),
        generationSkipShare: won(f, 'skip-share'),
        isGenerationSkipMinor: on(f, 'skip-minor', false),
      });
      const b = r.breakdown;
      print('상속세', [
        ['총 상속재산', W(r.totalEstate)],
        ['과세가액', W(r.taxableValue)],
        ['일괄공제', W(b.lumpSumDeduction)],
        ['기초+인적공제', W(b.personalDeduction)],
        ['적용 공제(유리한 쪽)', W(b.standardDeduction)],
        ['법정상속분', W(b.statutoryShare)],
        ['배우자상속공제', W(b.spouseDeduction)],
        ['순금융재산', W(b.netFinancialAsset)],
        ['금융재산공제', W(b.financialDeduction)],
        ['공제 합계', W(b.totalDeduction)],
        ['과세표준', W(r.taxBase)],
        ['산출세액', W(r.calculatedTax)],
        r.generationSkipSurcharge > 0 && ['세대생략 할증', W(r.generationSkipSurcharge) + ' (' + pct(r.generationSkipRate) + ')'],
        ['신고세액공제', W(r.reportDeduction)],
        ['최종 세액', W(r.finalTax)],
      ]);
      if (f.second) {
        const s = calc.calculateSecondaryInheritance({
          first: r, spouseAcquired: wonOrNull(f, 'spouse-actual'),
          spouseOwnAsset: won(f, 'spouse-asset'), spouseOwnFinancial: won(f, 'spouse-fin'),
          numChildren: num(f, 'children', 2),
        });
        print('2차 상속 (배우자 사망)', [
          ['배우자 취득 재산', W(s.transferred) + (s.usesStatutoryShare ? ' (법정상속분 가정)' : '')],
          ['배우자 고유재산', W(s.spouseOwnAsset)],
          ['2차 상속재산', W(s.secondEstate)],
          ['1차 세액', W(s.firstTax)],
          ['2차 세액', W(s.secondTax)],
          ['1·2차 합계', W(s.totalTax)],
        ]);
      }
    },
  },

  gift: {
    desc: '증여세 (부담부증여)',
    flags: [
      '--value N     증여재산가액',
      '--debt N      수증자 인수 채무액',
      '--acquire N   증여재산 취득가액',
      '--rel S       관계 (배우자 / 직계존비속 / 기타친족, 기본 직계존비속)',
      '--minor       수증자가 미성년자',
      '--prior N     10년 내 사전증여 합계',
      '--years N     증여자 보유기간(년)',
      '--no-rel-ded  증여재산공제 미적용',
      '--skip        수증자가 손자녀 등 세대생략',
    ],
    run: function (f) {
      const r = calc.calculateGiftTax({
        giftValue: won(f, 'value'), assumedDebt: won(f, 'debt'), acquisitionCost: won(f, 'acquire'),
        relation: f.rel || '직계존비속', isMinorRecipient: on(f, 'minor', false),
        priorGift: won(f, 'prior'), holdingYears: num(f, 'years', 0),
        applyRelativeDeduction: on(f, 'rel-ded', true), isGenerationSkip: on(f, 'skip', false),
      });
      print('증여세 (부담부증여)', [
        ['증여재산가액', W(r.giftValue)],
        ['인수 채무액', W(r.debtAssumed)],
        ['증여분', W(r.giftPortion)],
        ['증여재산공제', W(r.relativeDeduction)],
        ['증여 과세표준', W(r.giftTaxBase)],
        ['증여 산출세액', W(r.giftComputedTax)],
        r.generationSkipSurcharge > 0 && ['세대생략 할증', W(r.generationSkipSurcharge) + ' (' + pct(r.generationSkipRate) + ')'],
        r.priorGiftTax > 0 && ['사전증여 기납부세액', W(r.priorGiftTax)],
        ['증여세', W(r.giftTax)],
        ['양도분 취득가액', W(r.acquisitionShare)],
        ['양도차익', W(r.transferGain)],
        ['장기보유공제율', pct(r.longTermRate)],
        ['양도 과세표준', W(r.transferTaxBase)],
        ['양도세', W(r.transferTax)],
        ['합계', W(r.total)],
      ]);
    },
  },

  jongbu: {
    desc: '종합부동산세',
    flags: [
      '--pub N                주택 공시가격 합계',
      '--houses N             주택 수 (기본 1)',
      '--no-single            1세대1주택 단독명의 아님',
      '--age N                만 나이',
      '--hold N               보유기간(년)',
      '--ptax N               기납부 재산세 중복분',
      '--basis reform         2026 개편안 적용 (기본 현행)',
      '--year 2027|2028|2029  개편안 적용 연도',
      '--no-resident          해당 주택 미거주',
      '--resident-houses N    거주 중인 주택 수 (개편안 다주택 기본공제 안분. 0 또는 1)',
      '--live N               거주기간(년)',
      '--adjusted             조정대상지역',
    ],
    run: function (f) {
      const r = calc.calculateComprehensiveRealEstateTax(Object.assign({
        publicPrice: won(f, 'pub'), numHouses: num(f, 'houses', 1),
        isSingleHouse: on(f, 'single', true), ownerAge: num(f, 'age', 0),
        holdingYears: num(f, 'hold', 0), propertyTaxPaid: won(f, 'ptax'),
        isResident: on(f, 'resident', true),
        // 개편안 다주택 기본공제는 거주 주택 수로 안분한다. 미지정이면 거주 여부를 따른다.
        residentHouses: f['resident-houses'] !== undefined
          ? num(f, 'resident-houses', 0) : (on(f, 'resident', true) ? 1 : 0),
        livingYears: num(f, 'live', 0), isAdjustedArea: on(f, 'adjusted', false),
      }, basisOf(f)));
      print('종합부동산세', [
        ['적용 기준', r.isReform ? '2026 개편안 · ' + r.basisYear + '년' : '현행'],
        ['공시가격', W(r.publicPrice)],
        ['기본공제', W(r.basicDeduction)],
        ['공정시장가액비율', pct(r.fairMarketRatio)],
        ['과세표준', W(r.taxBase)],
        ['산출세액', W(r.grossTax)],
        ['세액공제율', pct(r.creditRate) + ' (고령 ' + pct(r.ageCreditRate) + ' + 장기보유 ' + pct(r.holdingCreditRate) + ')'],
        ['세액공제', W(r.creditAmount) + (r.isCreditCapped ? ' (한도 적용)' : '')],
        r.propertyTaxPaid > 0 && ['기납부 재산세', W(r.propertyTaxPaid)],
        ['결정세액', W(r.calculatedTax)],
        ['농어촌특별세', W(r.ruralTax)],
        ['최종 세액', W(r.finalTax)],
      ]);
    },
  },

  transfer: {
    desc: '양도소득세',
    flags: [
      '--sale N        양도가액',
      '--buy N         취득가액',
      '--cost N        필요경비',
      '--hold N        보유기간(년)',
      '--live N        거주기간(년)',
      '--exempt        1세대1주택 비과세',
      '--surcharge N   다주택 중과 (0 / 2 / 3)',
      '--basis reform  2026 개편안 적용',
      '--year 2027|2028|2029',
    ],
    run: function (f) {
      const r = calc.calculateTransferIncomeTax(Object.assign({
        salePrice: won(f, 'sale'), purchasePrice: won(f, 'buy'), expenses: won(f, 'cost'),
        holdingYears: num(f, 'hold', 0), livingYears: num(f, 'live', 0),
        isOneHouseExempt: on(f, 'exempt', false), surchargeHouses: num(f, 'surcharge', 0),
      }, basisOf(f)));
      print('양도소득세', [
        ['적용 기준', r.isReform ? '2026 개편안 · ' + r.basisYear + '년' : '현행'],
        ['양도차익', W(r.transferGain)],
        // exemptRatio 는 이름과 달리 「과세되는 안분비율」이다 (비과세가 아니면 1).
        // 1세대1주택 비과세가 걸린 경우에만 뜻이 있다 — 그때만 낸다.
        r.exemptRatio < 1 && ['과세 안분비율', pct(r.exemptRatio) + ' — (양도가액 − 12억) ÷ 양도가액'],
        ['과세대상 양도차익', W(r.taxableGain)],
        ['장기보유공제율', pct(r.longTermRate) + (r.usesTable2 ? ' (표2)' : ' (표1)')],
        ['장기보유공제', W(r.longTermDeduction) + (r.isLongTermCapped ? ' (한도 ' + W(r.longTermCap) + ')' : '')],
        ['기본공제', W(r.basicDeduction)],
        ['과세표준', W(r.taxBase)],
        r.surchargeRate > 0 && ['다주택 중과율', pct(r.surchargeRate)],
        ['산출세액', W(r.calculatedTax)],
        ['지방소득세', W(r.localTax)],
        ['최종 세액', W(r.finalTax)],
      ]);
    },
  },

  stock: {
    desc: '비상장주식 평가',
    flags: [
      '--net-asset N  순자산가액',
      '--inc1 N       순손익액 1년 전',
      '--inc2 N       2년 전',
      '--inc3 N       3년 전',
      '--shares N     발행주식 총수(주, 기본 10000)',
      '--net-only     순자산가치만 평가',
      '--realty       부동산 과다보유 법인',
      '--no-premium   최대주주 할증 미적용 (기본 20% 할증)',
    ],
    run: function (f) {
      const weighted = calc.calculateWeightedNetIncome([won(f, 'inc1'), won(f, 'inc2'), won(f, 'inc3')]);
      const r = calc.calculateUnlistedStockValue({
        netAsset: won(f, 'net-asset'), weightedIncome: weighted,
        totalShares: num(f, 'shares', 10000),
        isRealtyHeavy: on(f, 'realty', false), netAssetOnly: on(f, 'net-only', false),
        hasMaxShareholderPremium: on(f, 'premium', true),
      });
      print('비상장주식 평가', [
        ['가중평균 순손익액', W(weighted)],
        ['주당 순자산가치', W(r.netAssetPerShare)],
        ['주당 순손익가치', W(r.incomePerShare)],
        ['가중평균', W(r.weightedValue)],
        ['하한 (순자산 80%)', W(r.floorValue) + (r.isFloorApplied ? ' — 적용됨' : '')],
        ['주당 평가액', W(r.valuePerShare)],
        ['최대주주 할증', '×' + r.premiumRate],
        ['할증 후 주당', W(r.pricePerShare)],
        ['총 평가액', W(r.totalValue) + ' (' + r.totalShares.toLocaleString('ko-KR') + '주)'],
      ]);
    },
  },

  paydiv: {
    desc: '급여 및 배당',
    flags: [
      '--salary N      현재 급여액(연간)',
      '--dividend N    예상 배당액(연간)',
      '--step N        급여 증감 비교 폭(%, 기본 10)',
      '--no-insurance  4대보험 미반영',
    ],
    run: function (f) {
      const r = calc.calculateSalaryDividendCompare({
        salary: won(f, 'salary'), dividend: won(f, 'dividend'),
        includeInsurance: on(f, 'insurance', true), stepPercent: num(f, 'step', 10),
      });
      const d = r.withDividend;
      print('급여 및 배당', [
        ['급여', W(d.salary)],
        ['배당', W(d.dividend)],
        ['근로소득공제', W(d.earnedDeduction)],
        ['과세표준', W(d.taxBase)],
        ['급여분 세액', W(d.salaryTax)],
        ['배당 분리과세분', W(d.dividendSeparateTax)],
        ['배당 종합과세 초과분', W(d.dividendExcess) + ' → ' + W(d.dividendExcessTax)],
        ['배당분 세액', W(d.dividendTax)],
        ['총 세부담', W(d.totalTax)],
        d.insurance > 0 && ['4대보험 본인부담', W(d.insurance)],
        ['세후 수령액', W(d.netCash)],
        ['실효세율', pct(d.effectiveRate)],
      ]);
    },
  },

  retire: {
    desc: '임원퇴직금',
    flags: [
      '--avg-pay N        최종 3년 연평균 급여',
      '--avg-pay-2019 N   2019.12.31. 기준 3년 평균급여',
      '--join YYYYMMDD    입사일',
      '--retire YYYYMMDD  퇴직(예정)일',
      '--mult N           정관상 지급배수 (기본 2)',
      '--other-inc N      퇴직 연도의 다른 근로소득',
    ],
    run: function (f) {
      const s = serviceSpans(f.join, f.retire);
      if (s.serviceYears === 0) {
        console.error('입사일과 퇴직일이 필요합니다 — 예: --join 20050301 --retire 20260301');
        process.exit(1);
      }
      const r = calc.calculateExecutiveSeveranceTax({
        averagePay: won(f, 'avg-pay'), averagePay2019: won(f, 'avg-pay-2019'),
        serviceYears: s.serviceYears, payMultiple: num(f, 'mult', 2),
        yearsUntil2011: s.yearsUntil2011, years2012to2019: s.years2012to2019,
        otherIncome: won(f, 'other-inc'),
      });
      print('임원퇴직금', [
        ['근속연수', s.serviceYears + '년 (' + s.months + '개월) · 1년 미만은 1년으로 봄'],
        ['구간 배분', '2011년 이전 ' + r.yearsPre + '년 / 2012~2019 ' + r.yearsTriple + '년 / 2020 이후 ' + r.yearsDouble + '년'],
        ['지급액(세전)', W(r.paidAmount)],
        ['퇴직소득 인정 한도', W(r.limitAmount)],
        r.yearsTriple > 0 && ['  3배 구간 한도', W(r.limitTriple) + (r.usesSeparate2019Pay ? '' : ' — 최종급여로 갈음')],
        r.yearsDouble > 0 && ['  2배 구간 한도', W(r.limitDouble)],
        ['한도 초과분 (근로소득)', W(r.excess)],
        ['퇴직소득', W(r.severanceIncome)],
        ['퇴직소득세', W(r.severanceTax)],
        r.excessTax > 0 && ['초과분 근로소득세', W(r.excessTax)],
        ['총 세액', W(r.totalTax)],
      ]);
    },
  },

  succession: {
    desc: '가업승계제도 검토',
    flags: [
      '--biz N          법인 주식 검토 가액',
      '--unrelated N    사업무관자산 비율(%)',
      '--years N        경영기간(년, 기본 15)',
      '--route S        검토 경로 (가업상속공제 / 증여세과세특례, 기본 가업상속공제)',
      '--total-estate N 전체 상속재산 (세액 비교용)',
      '--land-unit N    ㎡당 토지 평가액',
      '--land-area N    토지 면적(㎡)',
      '--floor-area N   건축물 바닥면적(㎡)',
      '--local          수도권 밖 (기본 수도권)',
      '--basis reform   2026 개편안 적용',
    ],
    run: function (f) {
      const r = calc.calculateBusinessSuccession(Object.assign({
        businessValue: won(f, 'biz'), managementYears: num(f, 'years', 15),
        totalEstate: won(f, 'total-estate'),
        route: f.route || '가업상속공제',
        landUnitPrice: won(f, 'land-unit'), landArea: num(f, 'land-area', 0),
        floorArea: num(f, 'floor-area', 0), isMetroArea: !f.local,
        unrelatedAssetRate: num(f, 'unrelated', 0) / 100,
      }, basisOf(f)));
      const rows = [
        ['적용 기준', r.isReform ? '2026 개편안' : '현행'],
        ['검토 가액', W(r.businessValue)],
        r.isLandReduced && ['토지 평가 조정', W(r.landValueBefore) + ' → ' + W(r.landValueAfter)],
        ['사업무관자산', W(r.unrelatedAssetValue) + ' (' + pct(r.unrelatedAssetRate) + ')'],
        ['가업해당 재산', W(r.qualifiedValue)],
        ['경영기간', r.managementYears + '년'],
        ['공제 한도', W(r.deductionCap)],
        ['공제액', W(r.deduction)],
      ];
      if (r.route === '가업상속공제') {
        rows.push(['공제 미적용 세액', W(r.taxWithout)], ['공제 적용 세액', W(r.taxWith)], ['절세액', W(r.saving)]);
      } else {
        rows.push(['과세특례 공제', W(r.specialDeduction)], ['특례 증여세', W(r.specialTax)],
          ['일반 증여세', W(r.normalGiftTax)], ['절세액', W(r.specialSaving)]);
      }
      print('가업승계제도 검토', rows);
    },
  },

  fp: {
    desc: 'FP센터 — 가까운 순 조회.  사용: tax.js fp <위도> <경도> [개수]',
    flags: ['(위치 인자) 위도 경도 [개수, 기본 3]  — 인자가 없으면 8곳 전체를 낸다'],
    run: function (f, rest) {
      const status = fpExpiryLine();
      if (rest.length < 2) {
        print('FP센터 ' + fp.CENTERS.length + '곳', fp.CENTERS.map((c) => [c.이름, c.전화 + ' · ' + c.주소]));
        console.log('  ' + status);
        return;
      }
      const lat = Number(rest[0]), lng = Number(rest[1]);
      if (!fp.inKorea(lat, lng)) {
        console.error('국내 좌표가 아닙니다 (위 33~39 / 경 124~132): ' + lat + ', ' + lng);
        process.exit(1);
      }
      const near = fp.nearestCenters(lat, lng, fp.CENTERS, Number(rest[2]) || 3);
      print('가까운 FP센터 (' + lat + ', ' + lng + ')',
        near.map((c) => [c.이름, c.거리km.toFixed(2) + 'km · ' + c.전화 + ' · ' + c.주소]));
      console.log('  ' + status);
    },
  },
};

// fpExpiryStatus 는 Date 가 아니라 'YYYY-MM-DD' 문자열을 받는다 (index.html 의 todayIso 와 같은 꼴).
// Date 를 넘기면 남은일수가 조용히 NaN 이 된다.
function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fpExpiryLine() {
  const s = fp.fpExpiryStatus(todayIso());
  const base = '심의번호 ' + fp.FP_SOURCE.심의번호 + ' · 유효기간 ~' + fp.FP_SOURCE.유효기간.만료;
  if (s.만료됨) return base + ' — 만료됨. 준법 재심의가 필요합니다.';
  if (s.경고) return base + ' — 만료 ' + s.남은일수 + '일 전.';
  return base + ' (' + s.남은일수 + '일 남음)';
}

// ══════════════════════════ 자기검증 ══════════════════════════

// 기대값의 출처는 AI세무사_에이전트_재생성_프롬프트.md §8 자기검증 벡터다.
// 구현을 실행해 얻지 않는다 (프로젝트 원칙 제3조).
// 만원 단위로 대조한다 — 화면의 formatWon 이 만원까지 반올림해 보이므로 §8 과 같은 눈금이다.
function selftest() {
  const fails = [];
  let pass = 0;
  const man = (v) => Math.round(v / MANWON);
  function eq(name, actual, expected) {
    if (actual === expected) { pass++; return; }
    fails.push(name + ' — 기대 ' + expected + ' / 실제 ' + actual);
  }
  function close(name, actual, expected, tol) {
    if (Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol)) { pass++; return; }
    fails.push(name + ' — 기대 ' + expected + ' / 실제 ' + actual);
  }

  // V1 상속세 — 부동산 20억 · 금융자산 10억 · 배우자 있음 · 자녀 2
  const v1 = calc.calculateInheritanceTax({ realEstate: 20 * 억, cash: 10 * 억, hasSpouse: true, numChildren: 2 });
  eq('V1 totalEstate', man(v1.totalEstate), 300000);
  eq('V1 taxBase', man(v1.taxBase), 101429);
  eq('V1 calculatedTax', man(v1.calculatedTax), 24571);
  eq('V1 finalTax', man(v1.finalTax), 23834);
  eq('V1 일괄공제', man(v1.breakdown.lumpSumDeduction), 50000);
  eq('V1 배우자상속공제', man(v1.breakdown.spouseDeduction), 128571);
  eq('V1 금융재산공제', man(v1.breakdown.financialDeduction), 20000);
  eq('V1 법정상속분', man(v1.breakdown.statutoryShare), 128571);

  // V2 2차 상속 — V1 기준, 배우자 고유재산 0, 자녀 2
  const v2 = calc.calculateSecondaryInheritance({ first: v1, spouseOwnAsset: 0, numChildren: 2 });
  eq('V2 배우자 취득 재산', man(v2.transferred), 128571);
  eq('V2 2차 세액', man(v2.secondTax), 17044);
  eq('V2 1·2차 합계', man(v2.totalTax), 40879);

  // V3 금융재산공제 상한 — 전액 금융자산 30억 vs 전액 부동산 30억
  const v3 = calc.calculateInheritanceTax({ realEstate: 0, cash: 30 * 억, hasSpouse: true, numChildren: 2 });
  eq('V3 taxBase', man(v3.taxBase), 101429);
  eq('V3 finalTax', man(v3.finalTax), 23834);
  eq('V3 금융재산공제', man(v3.breakdown.financialDeduction), 20000);
  const v3b = calc.calculateInheritanceTax({ realEstate: 30 * 억, cash: 0, hasSpouse: true, numChildren: 2 });
  eq('V3 전액부동산 taxBase', man(v3b.taxBase), 121429);
  eq('V3 전액부동산 finalTax', man(v3b.finalTax), 31594);

  // V4 증여세(부담부증여) — 증여재산 10억 · 채무인수 3억 · 직계존비속 · 취득가액 4억 · 보유 10년
  const v4 = calc.calculateGiftTax({ giftValue: 10 * 억, assumedDebt: 3 * 억, acquisitionCost: 4 * 억, holdingYears: 10 });
  eq('V4 증여분', man(v4.giftPortion), 70000);
  eq('V4 증여재산공제', man(v4.relativeDeduction), 5000);
  eq('V4 과세표준', man(v4.giftTaxBase), 65000);
  eq('V4 증여세', man(v4.giftTax), 13095);
  eq('V4 양도분 취득가액', man(v4.acquisitionShare), 12000);
  eq('V4 양도차익', man(v4.transferGain), 18000);
  eq('V4 양도세', man(v4.transferTax), 3749);
  eq('V4 합계', man(v4.total), 16844);

  // V5 종합부동산세 — 1세대1주택 공시 20억 · 보유 5년 · 현행
  const v5 = calc.calculateComprehensiveRealEstateTax({ publicPrice: 20 * 억, holdingYears: 5 });
  eq('V5 기본공제', man(v5.basicDeduction), 120000);
  close('V5 공정시장가액비율', v5.fairMarketRatio, 0.6);
  eq('V5 과세표준', man(v5.taxBase), 48000);
  eq('V5 산출세액', man(v5.grossTax), 276);
  close('V5 장기보유 공제율', v5.creditRate, 0.2);
  eq('V5 공제액', man(v5.creditAmount), 55);
  eq('V5 결정세액', man(v5.calculatedTax), 221);
  eq('V5 농특세', man(v5.ruralTax), 44);
  eq('V5 finalTax', man(v5.finalTax), 265);

  // V6 양도소득세 — 양도 10억 · 취득 5억 · 보유 10년 · 1세대1주택 아님 · 현행
  const v6 = calc.calculateTransferIncomeTax({ salePrice: 10 * 억, purchasePrice: 5 * 억, holdingYears: 10 });
  eq('V6 양도차익', man(v6.transferGain), 50000);
  close('V6 장기보유공제율', v6.longTermRate, 0.2);
  eq('V6 장기보유공제', man(v6.longTermDeduction), 10000);
  eq('V6 기본공제', man(v6.basicDeduction), 250);
  eq('V6 과세표준', man(v6.taxBase), 39750);
  eq('V6 산출세액', man(v6.calculatedTax), 13306);
  eq('V6 지방소득세', man(v6.localTax), 1331);
  eq('V6 finalTax', man(v6.finalTax), 14637);

  // V7 비상장주식 — 순자산 50억 · 순손익 10/8/6억 · 10,000주 · 최대주주 할증
  const weighted = calc.calculateWeightedNetIncome([10 * 억, 8 * 억, 6 * 억]);
  eq('V7 가중평균 순손익액', man(weighted), 86667);
  const v7 = calc.calculateUnlistedStockValue({ netAsset: 50 * 억, weightedIncome: weighted, totalShares: 10000 });
  eq('V7 순자산가치', man(v7.netAssetPerShare), 50);
  eq('V7 순손익가치', man(v7.incomePerShare), 87);
  eq('V7 가중평균', man(v7.weightedValue), 72);
  eq('V7 하한(순자산 80%)', man(v7.floorValue), 40);
  eq('V7 주당 평가액', man(v7.valuePerShare), 72);
  close('V7 할증률', v7.premiumRate, 1.2);
  eq('V7 할증 후 주당', man(v7.pricePerShare), 86);
  eq('V7 총액', man(v7.totalValue), 864000);

  // V8 급여·배당 — 급여 1.2억 · 배당 3,000만원 · 4대보험 반영
  const v8 = calc.calculateSalaryDividendCompare({ salary: 1.2 * 억, dividend: 3000 * MANWON, includeInsurance: true }).withDividend;
  eq('V8 총 세부담', man(v8.totalTax), 2919);
  eq('V8 세후 수령액', man(v8.netCash), 11001);
  eq('V8 배당 분리과세분', man(v8.dividendSeparateTax), 308);
  eq('V8 초과분', man(v8.dividendExcessTax), 385);

  // V9 임원퇴직금 — 연평균급여 1억 · 2005-03-01 ~ 2026-03-01 · 배수 2
  const s9 = serviceSpans('20050301', '20260301');
  eq('V9 근속연수', s9.serviceYears, 21);
  const v9 = calc.calculateExecutiveSeveranceTax({
    averagePay: 1 * 억, serviceYears: s9.serviceYears, payMultiple: 2,
    yearsUntil2011: s9.yearsUntil2011, years2012to2019: s9.years2012to2019,
  });
  eq('V9 지급액(세전)', man(v9.paidAmount), 42000);
  // 한도는 지급액과 다르다. 소득세법 제22조 제3항의 세 구간으로 갈라 각각 다른 배수로 계산한다.
  //   2011년 이전 7년   한도 적용 제외, 지급액 그대로   1,000만 × 7 × 2배 = 1.4억
  //   2012~2019년 8년   1,000만 × 8 × 3배            = 2.4억
  //   2020년 이후 6년   1,000만 × 6 × 2배            = 1.2억   → 합계 5억
  // 지급액 4.2억 < 한도 5억 이므로 초과는 0이다.
  eq('V9 한도', man(v9.limitAmount), 50000);
  eq('V9 초과', man(v9.excess), 0);
  eq('V9 퇴직소득세', man(v9.totalTax), 3886);

  // V10 가업승계 — 검토가액 100억 · 사업무관 20% · 경영 15년 · 가업상속공제 · 현행
  const v10 = calc.calculateBusinessSuccession({ businessValue: 100 * 억, managementYears: 15, unrelatedAssetRate: 0.2 });
  eq('V10 사업무관자산', man(v10.unrelatedAssetValue), 200000);
  eq('V10 가업해당', man(v10.qualifiedValue), 800000);
  eq('V10 공제 한도', man(v10.deductionCap), 3000000);
  eq('V10 공제액', man(v10.deduction), 800000);

  // FP센터 — 강남역(37.4979, 127.0276) 기준
  const near = fp.nearestCenters(37.4979, 127.0276, fp.CENTERS, 3);
  eq('FP 1순위', near[0].이름, '강남FP센터');
  eq('FP 2순위', near[1].이름, '서울FP센터');
  eq('FP 3순위', near[2].이름, '경원FP센터');
  close('FP 강남 거리', near[0].거리km, 0.21, 0.005);
  close('FP 서울 거리', near[1].거리km, 9.09, 0.005);
  close('FP 경원 거리', near[2].거리km, 24.72, 0.005);
  close('FP 위도 1도', fp.distanceKm(0, 0, 1, 0), 111.195, 0.005);
  const 서울 = fp.CENTERS.find((c) => c.이름 === '서울FP센터');
  const 부산 = fp.CENTERS.find((c) => c.이름 === '부산FP센터');
  // 327.20 은 손으로 전개한 하버사인 값이라 끝자리가 정확하지 않다.
  // fp.test.js 도 같은 이유로 ±1km 를 허용한다 — 여기서는 드리프트를 잡을 만큼만 좁힌다.
  close('FP 서울↔부산', fp.distanceKm(서울.lat, 서울.lng, 부산.lat, 부산.lng), 327.20, 0.05);

  // 유효기간 — fpExpiryStatus 는 'YYYY-MM-DD' 문자열만 받는다. Date 를 넘기면 조용히 NaN 이 된다.
  // 이 화면 배선이 어긋나면 준법 유효기간이 안 보이므로 계약을 고정한다. (경계값은 fp.test.js §유효기간)
  eq('FP 유효기간 남은일수가 수치', Number.isFinite(fp.fpExpiryStatus(todayIso()).남은일수), true);
  eq('FP 만료 60일 전 경고', fp.fpExpiryStatus('2026-08-28').경고, true);
  eq('FP 만료 61일 전 미경고', fp.fpExpiryStatus('2026-08-27').경고, false);

  console.log('자기검증 — 통과 ' + pass + '건 / 불일치 ' + fails.length + '건');
  if (fails.length) {
    fails.forEach((m) => console.log('  불일치: ' + m));
    console.log('\n계산 모듈이 §8 자기검증 벡터와 어긋납니다. calc.js 변경 내역을 확인하세요.');
    process.exit(1);
  }
  console.log('AI세무사_에이전트_재생성_프롬프트.md §8 의 벡터와 전부 일치합니다.');
}

// ══════════════════════════ 진입점 ══════════════════════════

function help(which) {
  if (which && COMMANDS[which]) {
    console.log('node tax.js ' + which + ' [플래그...]   — ' + COMMANDS[which].desc);
    COMMANDS[which].flags.forEach((line) => console.log('  ' + line));
    return;
  }
  console.log('AI 세무사 계산 실행기 — 금액 플래그의 단위는 만원입니다 (20억 -> 200000).\n');
  console.log('  node tax.js <세목> [플래그...]');
  console.log('  node tax.js help <세목>      세목별 플래그');
  console.log('  node tax.js selftest         §8 자기검증 벡터 대조\n');
  Object.keys(COMMANDS).forEach((k) => console.log('  ' + k + '  —  ' + COMMANDS[k].desc));
  console.log('\n예:');
  console.log('  node tax.js inherit --re 200000 --cash 100000 --children 2 --second');
  console.log('  node tax.js gift --value 100000 --debt 30000 --acquire 40000 --years 10');
  console.log('  node tax.js fp 37.4979 127.0276');
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(argv[1]); return; }
  if (cmd === 'selftest') { selftest(); return; }
  const command = COMMANDS[cmd];
  if (!command) {
    console.error('모르는 세목입니다: ' + cmd + '\n');
    help();
    process.exit(1);
  }
  const parsed = parseArgs(argv.slice(1));
  if (parsed.flags.help) { help(cmd); return; }
  command.run(parsed.flags, parsed.rest);
  console.log('\n  ※ 개산입니다. 실제 신고·납부는 세무 전문가의 확인을 거쳐야 합니다.');
}

main();
