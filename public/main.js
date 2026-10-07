// 단계 3~6: WebSocket 시그널링으로 두 탭/PC 연결 (1:1 통화) + STUN/TURN
// ICE 서버 목록은 서버의 /ice-config 에서 받아온다 (.env 로 설정).

const $ = (id) => document.getElementById(id);
const localVideo = $('local');
const remoteVideo = $('remote');
const btnStart = $('btnStart');
const btnJoin = $('btnJoin');
const btnMute = $('btnMute');
const btnHangup = $('btnHangup');
const chkRelay = $('chkRelay');
const logEl = $('log');

let rtcConfig = { iceServers: [] };
let localStream = null;
let ws = null;
let pc = null;
let pendingCandidates = [];
let candCount = {};
let isCaller = false;

function log(msg) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) log(`⚠ ${msg.split('\n')[0]}`);
}

// 버튼 상태: init → camera(또는 nocam) → waiting → connected
// nocam: 카메라를 못 얻었지만 영상 수신 전용으로 접속은 가능
function setUi(mode) {
  const canJoin = mode === 'camera' || mode === 'nocam';
  btnStart.disabled = mode !== 'init' && mode !== 'nocam';
  btnJoin.disabled = !canJoin;
  btnMute.disabled = mode !== 'connected' || !localStream;
  btnHangup.disabled = mode === 'init' || mode === 'camera';
  chkRelay.disabled = mode === 'waiting' || mode === 'connected'; // 정책은 pc 생성 시점에만 적용된다
  $('hint').textContent = mode === 'waiting' ? '상대를 기다리는 중… 다른 탭/PC에서 접속하세요.' : '';
}

function setWsState(open) {
  $('wsDot').classList.toggle('on', open);
  $('wsState').textContent = open ? '시그널링: 연결됨' : '시그널링: 끊김';
}

// ---------- 단계 1: 카메라 ----------
async function startCamera() {
  showError('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      `이 주소(${location.origin})는 보안 연결이 아니라서 브라우저가 카메라를 막습니다.\n` +
      '카메라는 https:// 또는 http://localhost 에서만 사용할 수 있습니다.\n' +
      `→ 해결: 서버를 HTTPS 모드(npm run start:https)로 실행하고 https://${location.hostname}:${location.port || 443} 로 접속하세요.\n` +
      '   (자체 서명 인증서 경고가 나오면 [고급] → [계속 진행]) 또는 HTTPS 터널(cloudflared/ngrok)을 쓰세요.\n' +
      '→ 지금은 카메라 없이 [접속]을 눌러 상대 영상만 받을 수 있습니다.'
    );
    return setUi('nocam');
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    let why = `${err.name} - ${err.message}`;
    if (err.name === 'NotAllowedError') why = '카메라/마이크 권한이 거부되었습니다. 주소창의 권한 설정에서 허용해 주세요.';
    if (err.name === 'NotFoundError') why = '사용 가능한 카메라/마이크가 없습니다.';
    if (err.name === 'NotReadableError') why = '다른 앱/탭이 카메라를 사용 중입니다. 같은 PC에서 탭 2개를 열면 생길 수 있으니 다른 브라우저/프로필을 쓰세요.';
    showError(`카메라를 켜지 못했습니다: ${why}\n카메라 없이 [접속]을 눌러 상대 영상만 받을 수도 있습니다.`);
    return setUi('nocam');
  }
  localVideo.srcObject = localStream;
  log('카메라 켜짐');
  setUi('camera');
}

// ---------- 단계 3: 시그널링 ----------
function sendSignal(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ---------- 단계 6: STUN/TURN 설정 받기 ----------
async function loadIceConfig() {
  let iceServers = [];
  try {
    const res = await fetch('/ice-config', { cache: 'no-store' });
    iceServers = (await res.json()).iceServers;
  } catch (err) {
    log(`ICE 설정을 받지 못했습니다 (${err.message}) → host 후보만 사용`);
  }
  rtcConfig = { iceServers, iceTransportPolicy: chkRelay.checked ? 'relay' : 'all' };

  const urls = iceServers.flatMap((s) => [].concat(s.urls)); // 자격증명은 화면/로그에 남기지 않는다
  $('iceServers').textContent = urls.length ? urls.join(', ') : '(없음: host 후보만)';
  log(`ICE 서버: ${urls.join(', ') || '(없음)'} · 정책: ${rtcConfig.iceTransportPolicy}`);

  if (chkRelay.checked && !urls.some((u) => u.startsWith('turn'))) {
    showError('[TURN만 사용]을 켰지만 TURN 서버가 설정되어 있지 않습니다.\n→ .env 의 TURN_URLS 를 설정하고 서버를 다시 시작하거나, 체크를 해제하세요.');
    return false;
  }
  return true;
}

async function join() {
  showError('');
  if (location.protocol === 'file:') {
    return showError('index.html 을 파일로 직접 열었습니다. 서버를 실행(npm start)하고 http://localhost:3000 으로 접속하세요.');
  }
  btnJoin.disabled = true; // 설정을 받는 동안 중복 클릭 방지
  if (!(await loadIceConfig())) return setUi(localStream ? 'camera' : 'nocam');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  log(`시그널링 접속 시도: ${proto}://${location.host}`);
  try {
    ws = new WebSocket(`${proto}://${location.host}`);
  } catch (err) {
    setUi(localStream ? 'camera' : 'nocam');
    return showError(`시그널링 주소가 올바르지 않습니다: ${err.message}`);
  }
  createPc(); // answer 쪽도 offer 를 받기 전에 pc 와 트랙이 준비되어 있어야 한다
  setUi('waiting');

  let opened = false;
  ws.onopen = () => { opened = true; setWsState(true); log('시그널링 연결됨'); };
  ws.onerror = () => {
    if (!opened) showError('시그널링 서버에 연결하지 못했습니다. 서버(npm start)가 실행 중인지, 방화벽이 3000 포트를 막지 않는지 확인하세요.');
  };
  ws.onclose = () => { setWsState(false); log('시그널링 끊김'); };
  ws.onmessage = (e) => onSignal(JSON.parse(e.data)).catch((err) => log(`시그널 처리 실패: ${err.name} - ${err.message}`));
}

// ---------- 단계 4: PeerConnection ----------
function updateCandStats() {
  const parts = Object.entries(candCount).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`);
  $('candStats').textContent = parts.join(' · ') || '-';
}

function createPc() {
  pc = new RTCPeerConnection(rtcConfig);
  pendingCandidates = [];
  candCount = { host: 0, srflx: 0, relay: 0 };
  updateCandStats();

  // 반드시 createOffer/createAnswer 이전에 addTrack
  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  } else {
    // 카메라 없이 접속: 보내지 않고 받기만 한다
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  pc.onicecandidate = (e) => {
    if (!e.candidate) return log('ICE 수집 완료');
    const c = e.candidate;
    candCount[c.type] = (candCount[c.type] || 0) + 1;
    updateCandStats();
    log(`내 candidate [${c.type}] ${c.address}:${c.port} (${c.protocol})`);
    sendSignal({ type: 'candidate', candidate: c });
  };

  // STUN/TURN 서버와 통신이 실패했을 때. 701: 서버에 닿지 못함, 401: TURN 인증 실패
  pc.onicecandidateerror = (e) => {
    log(`ICE 서버 오류 ${e.errorCode} ${e.errorText || ''} (${e.url})`);
  };

  pc.ontrack = (e) => {
    log(`ontrack: ${e.track.kind}`);
    if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
    $('placeholder').hidden = true;
  };

  pc.onconnectionstatechange = () => {
    $('state').textContent = pc.connectionState;
    log(`connectionState: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      showError('');
      setUi('connected');
      showSelectedPair();
    }
    if (pc.connectionState === 'failed') {
      showError(
        '연결 실패(ICE failed): 두 피어 사이에 통하는 경로를 찾지 못했습니다.\n' +
        '→ 서로 다른 네트워크라면 STUN 만으로는 부족할 수 있습니다. TURN 서버를 설정하세요.\n' +
        '→ [TURN만 사용]을 켰다면 TURN 주소·포트·인증을 확인하세요 (로그의 "ICE 서버 오류" 참고).'
      );
    }
  };
}

async function addCandidate(candidate) {
  if (!pc.remoteDescription) { // offer/answer 보다 candidate 가 먼저 오면 큐에 보관
    pendingCandidates.push(candidate);
    log('  (candidate 큐에 보관: remoteDescription 아직 없음)');
    return;
  }
  await pc.addIceCandidate(candidate);
}

async function flushCandidates() {
  const queue = pendingCandidates;
  pendingCandidates = [];
  for (const c of queue) await pc.addIceCandidate(c);
}

async function onSignal(msg) {
  switch (msg.type) {
    case 'joined':
      log(`방 입장 (현재 ${msg.count}명)`);
      break;

    case 'full':
      log('방이 가득 찼습니다 (최대 2명).');
      hangup();
      break;

    case 'ready': { // 내가 먼저 와 있었다 = caller
      isCaller = true;
      $('role').textContent = 'caller';
      log('상대 입장 → offer 생성');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', sdp: pc.localDescription });
      break;
    }

    case 'offer': { // callee
      isCaller = false;
      $('role').textContent = 'callee';
      log('offer 수신 → answer 생성');
      await pc.setRemoteDescription(msg.sdp);
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', sdp: pc.localDescription });
      break;
    }

    case 'answer':
      log('answer 수신');
      await pc.setRemoteDescription(msg.sdp);
      await flushCandidates();
      break;

    case 'candidate':
      await addCandidate(msg.candidate);
      break;

    case 'leave': // 상대가 나감: 다음 상대를 받을 수 있게 pc 를 새로 만들고 대기
      log('상대가 나갔습니다');
      await resetPeer();
      break;
  }
}

// ---------- 단계 5: 상태 표시 / 종료 ----------
async function showSelectedPair() {
  const stats = await pc.getStats();
  let pair = null;
  stats.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
  });
  if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
  if (!pair) return;
  const l = stats.get(pair.localCandidateId);
  const r = stats.get(pair.remoteCandidateId);
  const types = [l.candidateType, r.candidateType];
  // 영상이 실제로 어느 길로 흐르는지
  const path = types.includes('relay') ? 'TURN 서버 경유'
    : types.includes('srflx') ? 'P2P (STUN 공인 주소)'
    : 'P2P 직접';
  $('iceInfo').textContent = `${l.candidateType} ↔ ${r.candidateType} · ${path}`;
  const addr = (c) => (c.address ? `(${c.address}:${c.port})` : '(주소 숨김: mDNS)');
  const relay = l.candidateType === 'relay' && l.relayProtocol ? ` [TURN ${l.relayProtocol}]` : '';
  log(`선택된 후보 쌍: ${l.candidateType}${addr(l)}${relay} ↔ ${r.candidateType}${addr(r)} → ${path}`);
}

async function resetPeer() {
  if (pc) pc.close();
  remoteVideo.srcObject = null;
  $('placeholder').hidden = false;
  $('state').textContent = '-';
  $('iceInfo').textContent = '-';
  $('role').textContent = '-';
  btnMute.textContent = '🎤 음소거';
  await loadIceConfig(); // TURN 임시 자격증명이 만료됐을 수 있으니 다시 받는다
  createPc();
  setUi('waiting');
}

function toggleMute() {
  const audio = localStream && localStream.getAudioTracks()[0];
  if (!audio) return;
  audio.enabled = !audio.enabled;
  btnMute.textContent = audio.enabled ? '🎤 음소거' : '🔇 음소거 해제';
}

function hangup() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setWsState(false);
  if (pc) { pc.close(); pc = null; }
  pendingCandidates = [];
  remoteVideo.srcObject = null;
  $('placeholder').hidden = false;

  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  localVideo.srcObject = null;

  $('state').textContent = '-';
  $('iceInfo').textContent = '-';
  $('role').textContent = '-';
  $('candStats').textContent = '-';
  btnMute.textContent = '🎤 음소거';
  setUi('init');
  log('종료');
}

btnStart.addEventListener('click', startCamera);
btnJoin.addEventListener('click', join);
btnMute.addEventListener('click', toggleMute);
btnHangup.addEventListener('click', hangup);
setUi('init');
