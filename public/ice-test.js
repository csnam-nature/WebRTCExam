// ICE 후보 수집 테스트: 상대 없이 STUN/TURN 서버가 동작하는지 확인한다.
// 데이터 채널만 하나 만들어 offer 를 생성하면 미디어 없이도 후보 수집이 시작된다.

const $ = (id) => document.getElementById(id);
const cfgEl = $('cfg');
const rowsEl = $('rows');
const errorsEl = $('errors');
const summaryEl = $('summary');
const btnGather = $('btnGather');

const GATHER_TIMEOUT_MS = 10000;

const ERROR_HINT = {
  701: '서버에 닿지 못함',
  401: 'TURN 인증 실패',
  400: '잘못된 요청',
  403: '거부됨',
  437: '할당 불일치',
  486: '할당 한도 초과',
};

async function loadConfig() {
  try {
    const res = await fetch('/ice-config', { cache: 'no-store' });
    cfgEl.value = JSON.stringify(await res.json(), null, 2);
  } catch (err) {
    cfgEl.value = JSON.stringify({ iceServers: [] }, null, 2);
    errorsEl.textContent = `/ice-config 를 불러오지 못했습니다: ${err.message}`;
  }
}

function addRow(c, url, ms) {
  const tr = document.createElement('tr');
  tr.className = `t-${c.type}`;
  const cells = [
    c.type,
    c.protocol + (c.tcpType ? `/${c.tcpType}` : ''),
    `${c.address ?? '(숨김)'}:${c.port}`,
    c.relatedAddress ? `${c.relatedAddress}:${c.relatedPort}` : '',
    url || '',
    `${ms}ms`,
  ];
  cells.forEach((v) => {
    const td = document.createElement('td');
    td.textContent = v;
    tr.appendChild(td);
  });
  rowsEl.appendChild(tr);
}

function verdict(config, counts, how, errorCount) {
  const urls = (config.iceServers || []).flatMap((s) => [].concat(s.urls));
  const hasStun = urls.some((u) => u.startsWith('stun'));
  const hasTurn = urls.some((u) => u.startsWith('turn'));
  const lines = [`host ${counts.host} · srflx ${counts.srflx} · relay ${counts.relay}  (${how === 'complete' ? '수집 완료' : '10초 시간 초과'})`];

  if (config.iceTransportPolicy === 'relay') {
    lines.push(counts.relay ? '✔ relay 강제: TURN 후보만 수집됨' : '✘ relay 강제인데 TURN 후보가 없음 → TURN 설정/서버 확인');
  } else {
    if (!hasStun && !hasTurn) lines.push('ℹ ICE 서버 없음: host 후보만 나오는 것이 정상 (같은 네트워크에서만 연결 가능)');
    if (hasStun) lines.push(counts.srflx ? '✔ STUN 정상: 공인 주소(srflx)를 얻음' : '✘ STUN 실패: srflx 없음 → 인터넷/UDP 차단 또는 STUN 주소 확인');
  }
  if (hasTurn && counts.relay) lines.push('✔ TURN 정상: 중계 주소(relay)를 얻음');
  else if (hasTurn && errorCount) lines.push('✘ TURN 실패: relay 없음 → 아래 오류 코드 확인');
  else if (hasTurn) lines.push('✘ TURN 실패: 서버가 응답하지 않음 → 서버가 꺼져 있거나, 주소/포트가 틀렸거나, 방화벽이 3478 을 막는 중');
  return lines.join('\n');
}

async function gather() {
  let config;
  try {
    config = JSON.parse(cfgEl.value);
  } catch (err) {
    errorsEl.textContent = `설정 JSON 형식 오류: ${err.message}`;
    return;
  }
  config.iceTransportPolicy = $('chkRelay').checked ? 'relay' : 'all';

  rowsEl.innerHTML = '';
  errorsEl.textContent = '';
  summaryEl.textContent = '수집 중…';
  btnGather.disabled = true;

  const counts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  const t0 = performance.now();
  let pc;
  try {
    pc = new RTCPeerConnection(config);
  } catch (err) {
    errorsEl.textContent = `RTCPeerConnection 생성 실패: ${err.message}`;
    summaryEl.textContent = '설정 오류';
    btnGather.disabled = false;
    return;
  }
  pc.createDataChannel('probe');

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    counts[e.candidate.type] = (counts[e.candidate.type] || 0) + 1;
    addRow(e.candidate, e.candidate.url || e.url, Math.round(performance.now() - t0));
  };
  pc.onicecandidateerror = (e) => {
    const hint = ERROR_HINT[e.errorCode] ? ` - ${ERROR_HINT[e.errorCode]}` : '';
    errorsEl.textContent += `${e.errorCode}${hint}: ${e.errorText || ''}  (${e.url})\n`;
  };

  const done = new Promise((resolve) => {
    pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve('complete');
    setTimeout(() => resolve('timeout'), GATHER_TIMEOUT_MS);
  });

  await pc.setLocalDescription(await pc.createOffer());
  const how = await done;
  pc.close();

  const errorCount = errorsEl.textContent.split('\n').filter((l) => l && !l.includes('host lookup')).length;
  if (!errorsEl.textContent) errorsEl.textContent = '(없음)';
  summaryEl.textContent = verdict(config, counts, how, errorCount);
  btnGather.disabled = false;
}

btnGather.addEventListener('click', gather);
$('btnReload').addEventListener('click', loadConfig);
loadConfig();
