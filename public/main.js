// 단계 3~5: WebSocket 시그널링으로 두 탭 연결 (1:1 통화)
// iceServers 는 비워 둔다 (host 후보만). STUN/TURN 은 이후 단계에서 추가.

const $ = (id) => document.getElementById(id);
const localVideo = $('local');
const remoteVideo = $('remote');
const btnStart = $('btnStart');
const btnJoin = $('btnJoin');
const btnMute = $('btnMute');
const btnHangup = $('btnHangup');
const logEl = $('log');

const RTC_CONFIG = { iceServers: [] };

let localStream = null;
let ws = null;
let pc = null;
let pendingCandidates = [];
let isCaller = false;

function log(msg) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// 버튼 상태: init → camera → waiting → connected
function setUi(mode) {
  btnStart.disabled = mode !== 'init';
  btnJoin.disabled = mode !== 'camera';
  btnMute.disabled = mode !== 'connected';
  btnHangup.disabled = mode === 'init' || mode === 'camera';
  $('hint').textContent = mode === 'waiting' ? '상대를 기다리는 중… 다른 탭에서 접속하세요.' : '';
}

function setWsState(open) {
  $('wsDot').classList.toggle('on', open);
  $('wsState').textContent = open ? '시그널링: 연결됨' : '시그널링: 끊김';
}

// ---------- 단계 1: 카메라 ----------
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    log(`카메라 실패: ${err.name} - ${err.message}`);
    if (err.name === 'NotReadableError') log('→ 같은 PC에서 탭 2개를 열면 카메라 점유로 실패할 수 있습니다. 다른 브라우저/프로필을 쓰거나 한쪽은 카메라 없이 시험하세요.');
    return;
  }
  localVideo.srcObject = localStream;
  log('카메라 켜짐');
  setUi('camera');
}

// ---------- 단계 3: 시그널링 ----------
function sendSignal(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function join() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  createPc(); // answer 쪽도 offer 를 받기 전에 pc 와 트랙이 준비되어 있어야 한다
  setUi('waiting');

  ws.onopen = () => { setWsState(true); log('시그널링 연결됨'); };
  ws.onclose = () => { setWsState(false); log('시그널링 끊김'); };
  ws.onmessage = (e) => onSignal(JSON.parse(e.data)).catch((err) => log(`시그널 처리 실패: ${err.name} - ${err.message}`));
}

// ---------- 단계 4: PeerConnection ----------
function createPc() {
  pc = new RTCPeerConnection(RTC_CONFIG);
  pendingCandidates = [];

  // 반드시 createOffer/createAnswer 이전에 addTrack
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (!e.candidate) return log('ICE 수집 완료');
    log(`내 candidate [${e.candidate.type}] ${e.candidate.address}:${e.candidate.port}`);
    sendSignal({ type: 'candidate', candidate: e.candidate });
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
      setUi('connected');
      showSelectedPair();
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
      resetPeer();
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
  $('iceInfo').textContent = `${l.candidateType} ↔ ${r.candidateType}`;
  const addr = (c) => (c.address ? `(${c.address})` : '(주소 숨김: mDNS)');
  log(`선택된 후보 쌍: ${l.candidateType}${addr(l)} ↔ ${r.candidateType}${addr(r)}`);
}

function resetPeer() {
  if (pc) pc.close();
  remoteVideo.srcObject = null;
  $('placeholder').hidden = false;
  $('state').textContent = '-';
  $('iceInfo').textContent = '-';
  $('role').textContent = '-';
  btnMute.textContent = '🎤 음소거';
  createPc();
  setUi('waiting');
}

function toggleMute() {
  const audio = localStream.getAudioTracks()[0];
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
  btnMute.textContent = '🎤 음소거';
  setUi('init');
  log('종료');
}

btnStart.addEventListener('click', startCamera);
btnJoin.addEventListener('click', join);
btnMute.addEventListener('click', toggleMute);
btnHangup.addEventListener('click', hangup);
setUi('init');
