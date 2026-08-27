---
name: tax-review
description: 삼성생명 FC용 상담 사전검토 도구(company_tax/tax-review/)의 8개 세목 — 상속세·증여세·종합부동산세·양도소득세·비상장주식 평가·급여및배당·임원퇴직금·가업승계(가업상속공제 적용대상업종 판정·요건 체크리스트 포함) — 을 계산하거나, 그 코드(index.html, calc.js, succession-industry.js, fp.js)를 고치거나, 세율·공제 한도의 법령 근거를 확인할 때 사용하세요. "상속재산 30억이면 세금 얼마", "배우자상속공제 얼마까지", "부담부증여 세금", "임원퇴직금 한도", "가까운 FP센터" 같은 질문에는 도구 이름이 언급되지 않아도 반드시 이 스킬을 씁니다. 2026 세제개편안과 현행을 비교할 때도 마찬가지입니다.
---

# 세무 검토 도구 (AI 세무사)

`company_tax/tax-review/` 는 FC가 상담 자리에서 고객의 예상 세금을 개산하는 단일 페이지 웹 도구다.
계산은 전부 `calc.js` 의 순수 함수에 있고, 법령 대조 감사·독립 재구현 교차검증까지 네 겹으로 검증돼 있다.

이 스킬은 **그 검증된 계산을 다시 만들지 않기 위해** 있다.

## 세금을 손으로 계산하지 않는다

세액을 물으면 직접 산식을 세우지 말고 실행기를 쓴다. 누진세율·공제 한도·유리선택이 얽혀 있어
손계산은 거의 틀리고, 틀려도 그럴듯해 보인다.

```bash
node .claude/skills/tax-review/scripts/tax.js help
```

금액 플래그의 단위는 화면과 같은 **만원**이다 (20억 → `200000`).

```bash
node .claude/skills/tax-review/scripts/tax.js inherit --re 200000 --cash 100000 --children 2 --second
node .claude/skills/tax-review/scripts/tax.js gift --value 100000 --debt 30000 --acquire 40000 --years 10
node .claude/skills/tax-review/scripts/tax.js transfer --sale 200000 --buy 100000 --hold 10 --live 10 --exempt
node .claude/skills/tax-review/scripts/tax.js jongbu --pub 200000 --hold 5 --basis reform --year 2028
node .claude/skills/tax-review/scripts/tax.js retire --avg-pay 10000 --join 20050301 --retire 20260301
node .claude/skills/tax-review/scripts/tax.js fp 37.4979 127.0276
```

세목은 `inherit` `gift` `jongbu` `transfer` `stock` `paydiv` `retire` `succession` `fp` 아홉이다.
세목별 플래그는 `tax.js help <세목>`. 현행이 기본이고 `--basis reform --year 2027|2028|2029` 로
2026 세제개편안과 비교한다.

실행기가 못 다루는 조합이면 `calc.js` 의 함수를 직접 부른다 —
`grep -n '^function calculate' company_tax/tax-review/calc.js` 로 시그니처를 보고 쓴다.
**세율·공제 상수를 새로 적어 넣지 않는다.** 전부 `calc.js` 에 명명 상수로 있고 조문 주석이 붙어 있다.

## 코드를 고치기 전에

`index.html` · `calc.js` · `succession-industry.js` · `fp.js` 를 고치는 작업이라면, 먼저 프로젝트 루트의
**`AI세무사_에이전트_재생성_프롬프트.md`** 를 읽는다. 규칙 본문을 여기 복사해 두지 않았다 —
준법·법령 텍스트를 두 벌 두면 한쪽만 고쳐진다.

- **§1 제1~8조** — 계산과 화면의 분리(법정 수치는 `calc.js` 에만), 브라우저 없는 검증,
  기대값은 법령에서 전개, 저장·전송 금지, 단순성
- **§3 화면 불변조건 8가지** — 헤더 높이, 입력 중 재렌더 금지, 결과 진입 게이트 등
- **§9 실제로 틀렸던 것 7가지** — 같은 함정을 다시 밟지 않기 위한 목록
- **§10 완료 조건**

## 고친 뒤 검증

`company_tax/tax-review/` 에서 아래를 전부 돌린다. 하나라도 어긋나면 완료가 아니다.

| 명령 | 통과 기준 |
|---|---|
| `node calc.test.js` | PASS 124 / FAIL 0 |
| `node succession-industry.test.js` | PASS 7 / FAIL 0 |
| `node fp.test.js` | 253개 단언 통과 |
| `node audit.test.js` | 통과 36건 / 범위 제외 1건 / 결함 0건 |
| `node oracle/calc.test.js` | 26건 PASS |
| `node oracle/fixture-check.js` | 43 passed, 0 failed |
| `node oracle/crosscheck-run.js` | 400 cases, 2,400 values, 0 mismatched |
| `python -m pytest oracle/test_calc.py` | 28 passed |

그리고 이 스킬의 배선이 계산 모듈과 어긋나지 않았는지도 본다:

```bash
node .claude/skills/tax-review/scripts/tax.js selftest
```

74건 전부 §8 자기검증 벡터와 일치해야 한다. 실행기는 `calc.js` 를 직접 `require` 하므로,
계산 결과가 바뀌면 여기서 먼저 드러난다.

## 자주 틀리는 것

- **상속세 게이트를 첫 필드로 판정하지 않는다.** 부동산 칸만 보면 현금·예금만 있는 고객이 막히고,
  금융자산을 부동산 칸에 넣어 우회하면 금융재산 상속공제(한도 2억)가 사라져 세액이 과대 계상된다.
  부동산+금융자산+기타 **합계**로 본다.
- **2차 상속에 더할 금액은 배우자상속공제액이 아니라 배우자가 실제로 취득하는 재산이다.**
  공제액은 하한 5억·상한 30억·법정상속분에 걸려 취득액과 어긋난다.
- **`Infinity` 를 결측으로 거르지 않는다.** 종부세·양도세에서 「한도 없음」을 뜻하는 의도된 값이다.
- **`Number.isFinite` 로 결과를 검증하면 안 된다.** NaN 만 본다.
- **`exemptRatio` 는 이름과 달리 「과세되는 안분비율」이다** (비과세가 아니면 1).
- **`fpExpiryStatus` 는 `Date` 가 아니라 `'YYYY-MM-DD'` 문자열을 받는다.** Date 를 넘기면 조용히 NaN 이 된다.
- **임원퇴직금의 한도와 지급액은 다르다.** 지급액은 근속연수 전체에 정관상 배수를 곱한 값이고,
  한도는 소득세법 제22조 제3항의 세 구간(2011년 이전 / 2012~2019 / 2020 이후)을 각각 다른 배수로
  계산한 합이다. 둘이 같아 보이면 구간 배분이 빠진 것이다. 전개는 `scripts/tax.js` 의 V9 단언 옆에 있다.

## 파일 지도

`company_tax/tax-review/`

| 파일 | 내용 |
|---|---|
| `index.html` | 화면 전부 (인라인 CSS·JS). 입력 수집·단위 환산·결과 표시만 한다 |
| `calc.js` | 세액 계산 순수 함수와 법정 상수. 조문 주석이 붙어 있다 |
| `succession-industry.js` | 가업상속공제 적용대상업종 727개 표·판정 함수·피상속인/상속인 요건. 세액을 계산하지 않아 `calc.js` 와 분리했다 |
| `fp.js` | FP센터 8곳·하버사인 거리·유효기간·지도 투영 |
| `calc.test.js` | 회귀 — 구현이 설계대로인가 |
| `succession-industry.test.js` | 업종표 구조(727개·중복 없음)·판정 로직 회귀 |
| `audit.test.js` | 감사 — **설계가 법대로인가**. 구현을 참조하지 않고 조문에서만 전개한다 |
| `oracle/` | JS·Python 독립 재구현 교차검증 |

법령 근거를 더 파야 하면 `company_tax/docs/tax-law-sources.md` 와
`company_tax/docs/2026-tax-reform-summary.md` 를 본다. 설계 결정의 배경은
`company_tax/spec/` 의 5개 문서에 있다.

## 이 도구가 하지 않는 것

동거주택 상속공제(상증법 제23조의2, 최대 6억)는 **의도적으로 구현하지 않았다.**
계산이 복잡해지고 상담자에게 혼란을 준다고 판단한 소유자 결정이며, `audit.test.js` 가
「범위 제외 1건」으로 세고 있다. 요건에 해당하는 상담에서는 세액이 실제보다 크게 나온다.
이 결정을 뒤집으려면 `audit.test.js` 의 `excludedByOwner()` 부터 본다.
