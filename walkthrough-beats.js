// 「AI 세무사」 사용 설명 영상의 대본.
//
// act 는 함수가 아니라 이름(문자열)이다. 대본을 순수 데이터로 두어야 node 에서 검사할 수 있고,
// 실제 조작은 walkthrough.html 의 ACTIONS 표가 이름으로 찾아 실행한다.
//
// hold 는 그 beat 가 머무는 초다. 자막을 읽을 시간이므로 글자 수에 비례해 잡았다.

const BEATS = [
  // ── 1장 시작 화면 ──
  { ch: 1, title: '시작 화면', say: '상담 자리에서 예상 세금을 개산하는 도구입니다', hold: 5 },
  { ch: 1, say: '세무 검토와 FP센터, 두 갈래로 시작합니다', focus: '.split', hold: 4 },
  { ch: 1, say: '세법 기준일자가 카드에 적혀 있습니다', focus: '.split-meta', hold: 3 },

  // ── 2장 상단 4개 버튼 ──
  { ch: 2, title: '상단 4개 버튼', say: '검토를 시작하면 위에 버튼 네 개가 늘 떠 있습니다',
    act: 'startTax', focus: '.hdr-nav', hold: 5 },
  { ch: 2, say: '「처음으로」는 첫 화면으로 돌아갑니다',
    focus: '[data-act="gotoStart"]', note: '입력값은 지워지지 않음', hold: 6 },
  { ch: 2, say: '「입력값 초기화」는 앞 고객의 정보를 지웁니다',
    focus: '[data-act="resetAll"]', hold: 6 },
  { ch: 2, say: '실수로 지우지 않도록 두 번 눌러야 합니다',
    focus: '[data-act="resetAll"]', note: '두 번 눌러야 지워짐', hold: 6 },
  { ch: 2, say: '「검토결과 확인」에는 검토한 항목 수가 붙습니다',
    focus: '[data-act="gotoSummary"]', note: '1건 이상일 때 활성', hold: 6 },
  { ch: 2, say: '「FP센터」는 가까운 센터를 지도에서 찾습니다',
    focus: '[data-act="gotoFp"]', hold: 5 },

  // ── 3장 고객 정보 ──
  { ch: 3, title: '고객 정보', say: '고객명과 성별, 생년월일을 넣습니다', focus: '.fields', hold: 5 },
  { ch: 3, say: '생년월일을 넣으면 만 나이가 자동으로 나옵니다',
    act: 'fillCustomer', focus: '#ageText', hold: 6 },
  { ch: 3, say: '나이는 미성년자공제·연로자공제 판정에 쓰입니다', hold: 5 },

  // ── 4장 검토 모드 ──
  { ch: 4, title: '검토 모드', say: '간편과 심화 중에 고릅니다', act: 'toStep2', hold: 4 },
  { ch: 4, say: '「간편」은 필수값만 받고 나머지는 법정 기본값을 씁니다',
    focus: '[data-act="mode"][data-v="simple"]', hold: 7 },
  { ch: 4, say: '「심화」는 채무·사전증여·중과까지 직접 지정합니다',
    focus: '[data-act="mode"][data-v="deep"]', hold: 7 },

  // ── 5장 세목 선택 ──
  { ch: 5, title: '세목 선택', say: '8개 세목 중에 검토할 항목을 고릅니다',
    act: 'pickSimple', hold: 5 },
  { ch: 5, say: '검토를 마친 항목에는 「검토 완료」 표시가 남습니다', hold: 5 },
  { ch: 5, say: '여기서는 상속세로 시연합니다',
    focus: '[data-act="item"][data-v="inherit"]', hold: 4 },

  // ── 6장 값 입력 ──
  { ch: 6, title: '값 입력', say: '금액은 만원 단위로 넣습니다',
    act: 'pickInherit', focus: 'input[data-inp="val"][data-k="re"]', note: '만원 단위', hold: 6 },
  { ch: 6, say: '부동산 20억이면 200000을 넣습니다', act: 'typeRealEstate', hold: 6 },
  { ch: 6, say: '금융자산은 반드시 제 칸에 넣습니다',
    act: 'typeCash', focus: 'input[data-inp="val"][data-k="cash"]', hold: 6 },
  { ch: 6, say: '부동산 칸에 몰아넣으면 금융재산공제가 사라집니다',
    note: '세액이 과대 계상됨', hold: 7 },
  { ch: 6, say: '입력하는 동안 아래 안내 문구가 함께 바뀝니다', focus: '[data-hint]', hold: 6 },

  // ── 7장 결과 ──
  { ch: 7, title: '결과', say: '세액이 가장 크게 나옵니다', act: 'toResult', hold: 5 },
  { ch: 7, say: '그 아래에 계산 과정이 단계별로 펼쳐집니다', act: 'scrollSteps', hold: 6 },
  { ch: 7, say: '적용 기준 고지는 어떤 전제로 계산했는지 밝힙니다',
    act: 'scrollNotice', focus: '.notice', hold: 6 },
  { ch: 7, say: '개산이므로 확정 세액은 전문가 검토가 필요합니다', hold: 6 },

  // ── 8장 종합 검토 결과 ──
  { ch: 8, title: '종합 검토 결과', say: '검토한 항목을 한 화면에 모아 봅니다',
    act: 'toSummary', hold: 5 },
  { ch: 8, say: '결과와 입력값, 적용한 가정이 함께 보입니다', hold: 5 },
  { ch: 8, say: '인쇄하거나 PDF로 저장할 수 있습니다',
    focus: '[data-act="print"]', hold: 5 },

  // ── 9장 결과 수정 ──
  { ch: 9, title: '결과 수정', say: '고칠 값이 있으면 항목의 「수정」을 누릅니다',
    focus: '[data-act="sumEdit"]', hold: 6 },
  { ch: 9, say: '입력값이 그 자리에서 열립니다', act: 'openEdit', hold: 5 },
  { ch: 9, say: '값을 고치면 즉시 다시 계산됩니다', act: 'editRealEstate', hold: 6 },
  { ch: 9, say: '앞 화면으로 돌아갈 필요가 없습니다', hold: 4 },

  // ── 10장 마무리 ──
  { ch: 10, title: 'FP센터와 마무리', say: '가까운 FP센터를 지도에서 찾을 수 있습니다',
    act: 'toFp', hold: 6 },
  { ch: 10, say: '위치를 허용하면 가까운 순으로 정렬됩니다',
    focus: '[data-act="fpLocate"]', hold: 6 },
  { ch: 10, say: '결과는 참고용 개산입니다', hold: 5 },
];

function totalDuration() {
  return BEATS.reduce((sum, b) => sum + b.hold, 0);
}

// 시각 t 가 속한 beat. 되감기·앞으로감기 모두 이 함수 하나로 판정한다.
function beatAt(t) {
  if (!(t > 0)) return { index: 0, beat: BEATS[0], elapsed: 0 };
  let acc = 0;
  for (let i = 0; i < BEATS.length; i++) {
    if (t < acc + BEATS[i].hold) return { index: i, beat: BEATS[i], elapsed: t - acc };
    acc += BEATS[i].hold;
  }
  const last = BEATS.length - 1;
  return { index: last, beat: BEATS[last], elapsed: BEATS[last].hold };
}

function chapterTitles() {
  const out = [];
  let acc = 0;
  BEATS.forEach((b) => {
    if (b.title) out.push({ ch: b.ch, title: b.title, start: acc });
    acc += b.hold;
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BEATS, totalDuration, beatAt, chapterTitles };
}
