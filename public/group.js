// 그룹 영상통화 (최대 4명, Mesh): 다른 참가자마다 RTCPeerConnection 을 하나씩 맺는다.
// 시그널링: WebSocket /group (server.js 의 onGroupConnection)
//  - 새로 들어온 사람이 기존 참가자 전원에게 offer 를 보낸다 (양쪽 동시 offer 충돌 방지)
//  - offer/answer/candidate/state 는 to 로 대상을 지정하고, 서버가 from 을 붙여 전달한다

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const nameInput = $('name');
const btnStart = $('btnStart');
const btnJoin = $('btnJoin');
const btnMute = $('btnMute');
const btnCam = $('btnCam');
const btnHangup = $('btnHangup');
const chkRelay = $('chkRelay');
const logEl = $('log');

const NAME_KEY = 'webrtc-study.name';
// Mesh 는 내 영상을 참가자 수만큼 따로 보내므로 해상도를 낮춰 업로드량을 줄인다
const MEDIA = { audio: true, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } };

let rtcConfig = { iceServers: [] };
let localStream = null;
let ws = null;
let myId = null;
let joined = false;
let maxPeers = 4;
let spotlightId = null;
const me = { muted: false, camOff: false };
const peers = new Map(); // id → { id, name, pc, pending, tile, row, state, hasVideo, candCount, path }
let localTile = null;

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

// 버튼 상태: init → camera(또는 nocam) → joining → joined
function setUi(mode) {
  const hasStream = !!localStream;
  btnStart.disabled = !(mode === 'init' || mode === 'nocam');
  btnJoin.disabled = !(mode === 'camera' || mode === 'nocam');
  btnMute.disabled = !hasStream || !localStream.getAudioTracks().length || mode === 'init';
  btnCam.disabled = !hasStream || !localStream.getVideoTracks().length || mode === 'init';
  btnHangup.disabled = mode === 'init';
  nameInput.disabled = mode === 'joining' || mode === 'joined';
  chkRelay.disabled = mode === 'joining' || mode === 'joined';
}

function setWsState(open) {
  $('wsDot').classList.toggle('on', open);
  $('wsState').textContent = open ? '시그널링: 연결됨' : '시그널링: 끊김';
}

// ---------- 타일 ----------
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

function makeTile(id) {
  const el = $('tileTpl').content.firstElementChild.cloneNode(true);
  el.dataset.id = id;
  el.addEventListener('click', () => toggleSpotlight(id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSpotlight(id); }
  });
  return el;
}

function updateLocalTile() {
  const name = nameInput.value.trim() || '나';
  const video = localTile.querySelector('video');
  if (video.srcObject !== localStream) video.srcObject = localStream;
  const hasVideo = !!localStream && localStream.getVideoTracks().length > 0;
  localTile.querySelector('.who').textContent = `${name} (나)`;
  localTile.querySelector('.avatar span').textContent = initial(name);
  localTile.classList.toggle('no-video', !hasVideo || me.camOff);
  localTile.querySelector('.mic').hidden = !(me.muted || (localStream && !localStream.getAudioTracks().length));
  localTile.querySelector('.overlay').textContent = localStream ? '' : (joined ? '카메라 없음 (수신 전용)' : '카메라 꺼짐');
}

const STATE_TEXT = { new: '연결 중…', connecting: '연결 중…', disconnected: '연결 끊김 (복구 중)', failed: '연결 실패', closed: '종료됨' };

function updatePeerTile(peer) {
  const t = peer.tile;
  const st = peer.pc.connectionState;
  t.querySelector('.who').textContent = peer.name;
  t.querySelector('.avatar span').textContent = initial(peer.name);
  t.classList.toggle('no-video', !peer.hasVideo || peer.state.camOff || peer.state.noCam);
  t.querySelector('.mic').hidden = !(peer.state.muted || peer.state.noMic);
  t.querySelector('.overlay').textContent = st === 'connected' ? '' : STATE_TEXT[st] || '';
  const badge = t.querySelector('.badge');
  badge.className = `badge s-${st}`;
  badge.textContent = st === 'connected' ? `● ${peer.path || '연결됨'}` : '●';
  updatePeerRow(peer);
}

function renderGrid() {
  const count = 1 + peers.size;
  grid.dataset.count = count;
  // 순서: 나 → 들어온 순서
  [localTile, ...[...peers.values()].map((p) => p.tile)].forEach((t) => grid.appendChild(t));
  applySpotlight();
  $('count').textContent = joined ? count : 0;
  $('waiting').hidden = !(joined && peers.size === 0);
  $('peerRows').querySelector('.empty').hidden = peers.size > 0;
}

// ---------- 타일 클릭: 크게 보기 ----------
function toggleSpotlight(id) {
  spotlightId = spotlightId === id ? null : id;
  applySpotlight();
}

function applySpotlight() {
  const tiles = [...grid.querySelectorAll('.tile')];
  if (spotlightId && !tiles.some((t) => t.dataset.id === spotlightId)) spotlightId = null;
  const on = !!spotlightId && tiles.length > 1;
  grid.classList.toggle('spotlight', on);
  tiles.forEach((t) => t.classList.toggle('big', on && t.dataset.id === spotlightId));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && spotlightId) toggleSpotlight(spotlightId);
});

// ---------- 연결 상태 표 ----------
function updatePeerRow(peer) {
  const cells = peer.row.children;
  const c = peer.candCount;
  cells[0].textContent = peer.name;
  cells[1].textContent = peer.pc.connectionState;
  cells[1].className = `s-${peer.pc.connectionState}`;
  cells[2].textContent = peer.pairText || '-';
  cells[3].textContent = Object.entries(c).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(' · ') || '-';
}

// ---------- 카메라 ----------
async function startCamera() {
  showError('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      `이 주소(${location.origin})는 보안 연결이 아니라서 브라우저가 카메라를 막습니다.\n` +
      '카메라는 https:// 또는 http://localhost 에서만 사용할 수 있습니다.\n' +
      `→ 해결: 서버를 HTTPS 모드(npm run start:https)로 실행하고 https://${location.hostname}:${location.port || 443} 로 접속하세요.\n` +
      '→ 지금은 카메라 없이 [접속]을 눌러 다른 사람 영상만 받을 수 있습니다.'
    );
    return setUi('nocam');
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia(MEDIA);
  } catch (err) {
    let why = `${err.name} - ${err.message}`;
    if (err.name === 'NotAllowedError') why = '카메라/마이크 권한이 거부되었습니다. 주소창의 권한 설정에서 허용해 주세요.';
    if (err.name === 'NotFoundError') why = '사용 가능한 카메라/마이크가 없습니다.';
    if (err.name === 'NotReadableError') why = '다른 앱/탭이 카메라를 사용 중입니다. 같은 PC에서 여러 탭을 열면 생길 수 있으니 다른 브라우저/프로필을 쓰세요.';
    showError(`카메라를 켜지 못했습니다: ${why}\n카메라 없이 [접속]을 눌러 다른 사람 영상만 받을 수도 있습니다.`);
    return setUi('nocam');
  }
  me.muted = false;
  me.camOff = false;
  log('카메라 켜짐');
  updateLocalTile();
  setUi('camera');
}

// ---------- STUN/TURN 설정 ----------
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

// ---------- 시그널링 ----------
function sendSignal(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function myState() {
  return {
    muted: me.muted,
    camOff: me.camOff,
    noCam: !localStream || !localStream.getVideoTracks().length,
    noMic: !localStream || !localStream.getAudioTracks().length,
  };
}

async function join() {
  showError('');
  if (location.protocol === 'file:') {
    return showError('index.html 을 파일로 직접 열었습니다. 서버를 실행(npm start)하고 http://localhost:3000 으로 접속하세요.');
  }
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return showError('이름을 입력해 주세요.');
  }
  try { localStorage.setItem(NAME_KEY, name); } catch { /* 저장 불가 환경은 무시 */ }

  setUi('joining');
  if (!(await loadIceConfig())) return setUi(localStream ? 'camera' : 'nocam');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  log(`시그널링 접속 시도: ${proto}://${location.host}/group`);
  try {
    ws = new WebSocket(`${proto}://${location.host}/group`);
  } catch (err) {
    setUi(localStream ? 'camera' : 'nocam');
    return showError(`시그널링 주소가 올바르지 않습니다: ${err.message}`);
  }

  let opened = false;
  ws.onopen = () => {
    opened = true;
    setWsState(true);
    sendSignal({ type: 'join', name });
  };
  ws.onerror = () => {
    if (!opened) showError('시그널링 서버에 연결하지 못했습니다. 서버(npm start)가 실행 중인지, 방화벽이 포트를 막지 않는지 확인하세요.');
  };
  ws.onclose = () => {
    setWsState(false);
    log('시그널링 끊김');
    if (joined) {
      showError('시그널링 서버와 연결이 끊겼습니다. [나가기] 후 다시 접속하세요.');
    } else if (opened) {
      setUi(localStream ? 'camera' : 'nocam');
    }
  };
  // 메시지는 도착 순서대로 하나씩 처리한다.
  // (welcome 처리 중 offer 를 만드는 동안 도착한 state/candidate 가 아직 없는 참가자 앞으로 와서 버려지는 것을 방지)
  let queue = Promise.resolve();
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    queue = queue
      .then(() => onSignal(msg))
      .catch((err) => log(`시그널 처리 실패(${msg.type}): ${err.name} - ${err.message}`));
  };
}

async function onSignal(msg) {
  const peer = msg.from ? peers.get(msg.from) : null;

  switch (msg.type) {
    case 'welcome': {
      myId = msg.id;
      maxPeers = msg.max;
      joined = true;
      $('max').textContent = maxPeers;
      log(`입장: ${msg.name} (id ${myId}) · 기존 참가자 ${msg.peers.length}명`);
      setUi('joined');
      updateLocalTile();
      renderGrid();
      // 새로 들어온 내가 기존 참가자 전원에게 offer 를 보낸다 (참가자 객체를 먼저 모두 만든 뒤)
      const newPeers = msg.peers.map((p) => addPeer(p.id, p.name));
      for (const np of newPeers) {
        const offer = await np.pc.createOffer();
        await np.pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', to: np.id, sdp: np.pc.localDescription });
        log(`→ ${np.name} 에게 offer`);
      }
      sendSignal({ type: 'state', ...myState() });
      break;
    }

    case 'peer-joined':
      log(`참가자 입장: ${msg.name}`);
      addPeer(msg.id, msg.name);
      sendSignal({ type: 'state', to: msg.id, ...myState() }); // 새 사람에게 내 음소거/카메라 상태 알림
      break;

    case 'offer': {
      const p = peer || addPeer(msg.from, '참가자');
      log(`← ${p.name} 의 offer → answer`);
      await p.pc.setRemoteDescription(msg.sdp);
      await flushCandidates(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', to: p.id, sdp: p.pc.localDescription });
      break;
    }

    case 'answer':
      if (!peer) return;
      log(`← ${peer.name} 의 answer`);
      await peer.pc.setRemoteDescription(msg.sdp);
      await flushCandidates(peer);
      break;

    case 'candidate':
      if (peer) await addCandidate(peer, msg.candidate);
      break;

    case 'state':
      if (!peer) return;
      peer.state = { muted: !!msg.muted, camOff: !!msg.camOff, noCam: !!msg.noCam, noMic: !!msg.noMic };
      updatePeerTile(peer);
      break;

    case 'peer-left':
      if (peers.has(msg.id)) log(`참가자 퇴장: ${peers.get(msg.id).name}`);
      removePeer(msg.id);
      break;

    case 'full':
      showError(`방이 가득 찼습니다 (최대 ${msg.max}명). 누군가 나간 뒤 다시 접속하세요.`);
      leaveRoom();
      setUi(localStream ? 'camera' : 'nocam');
      break;
  }
}

// ---------- PeerConnection (참가자마다 하나) ----------
function addPeer(id, name) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(rtcConfig);
  const peer = {
    id, name, pc,
    pending: [],
    state: {},
    hasVideo: false,
    candCount: { host: 0, srflx: 0, relay: 0 },
    path: '',
    pairText: '',
    tile: makeTile(id),
    row: document.createElement('tr'),
  };
  peer.row.innerHTML = '<td></td><td></td><td></td><td></td>';
  $('peerRows').appendChild(peer.row);
  peers.set(id, peer);

  // 반드시 offer/answer 생성 이전에 트랙 추가
  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  } else {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    peer.candCount[e.candidate.type] = (peer.candCount[e.candidate.type] || 0) + 1;
    updatePeerRow(peer);
    sendSignal({ type: 'candidate', to: id, candidate: e.candidate });
  };
  pc.onicecandidateerror = (e) => log(`[${peer.name}] ICE 서버 오류 ${e.errorCode} ${e.errorText || ''} (${e.url})`);

  pc.ontrack = (e) => {
    const video = peer.tile.querySelector('video');
    if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
    if (e.track.kind === 'video') peer.hasVideo = true;
    updatePeerTile(peer);
  };

  pc.onconnectionstatechange = () => {
    log(`[${peer.name}] connectionState: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') showSelectedPair(peer);
    if (pc.connectionState === 'failed') {
      showError(
        `${peer.name} 님과 연결 실패(ICE failed): 통하는 경로를 찾지 못했습니다.\n` +
        '→ 서로 다른 네트워크라면 TURN 서버가 필요할 수 있습니다. [TURN만 사용]을 켰다면 TURN 설정을 확인하세요.'
      );
    }
    updatePeerTile(peer);
  };

  updatePeerTile(peer);
  renderGrid();
  return peer;
}

async function addCandidate(peer, candidate) {
  if (!peer.pc.remoteDescription) { // offer/answer 보다 candidate 가 먼저 오면 큐에 보관
    peer.pending.push(candidate);
    return;
  }
  await peer.pc.addIceCandidate(candidate);
}

async function flushCandidates(peer) {
  const queue = peer.pending;
  peer.pending = [];
  for (const c of queue) await peer.pc.addIceCandidate(c);
}

async function showSelectedPair(peer) {
  const stats = await peer.pc.getStats();
  let pair = null;
  stats.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
  });
  if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
  if (!pair) return;
  const l = stats.get(pair.localCandidateId);
  const r = stats.get(pair.remoteCandidateId);
  const types = [l.candidateType, r.candidateType];
  const [path, short] = types.includes('relay') ? ['TURN 서버 경유', 'TURN']
    : types.includes('srflx') ? ['P2P (STUN 공인 주소)', 'STUN']
    : ['P2P 직접', 'P2P'];
  peer.path = short;
  peer.pairText = `${l.candidateType} ↔ ${r.candidateType} · ${path}`;
  log(`[${peer.name}] 선택된 후보 쌍: ${peer.pairText}`);
  updatePeerTile(peer);
}

function removePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  peer.tile.remove();
  peer.row.remove();
  peers.delete(id);
  renderGrid();
}

// ---------- 음소거 / 카메라 끄기 / 나가기 ----------
function toggleMute() {
  const audio = localStream && localStream.getAudioTracks()[0];
  if (!audio) return;
  me.muted = !me.muted;
  audio.enabled = !me.muted;
  btnMute.textContent = me.muted ? '🔇 음소거 해제' : '🎤 음소거';
  updateLocalTile();
  sendSignal({ type: 'state', ...myState() });
}

function toggleCam() {
  const video = localStream && localStream.getVideoTracks()[0];
  if (!video) return;
  me.camOff = !me.camOff;
  video.enabled = !me.camOff; // 연결은 유지하고 영상만 끈다 (상대에게는 검은 화면 대신 이니셜 표시)
  btnCam.textContent = me.camOff ? '📷 카메라 켜기' : '📷 카메라 끄기';
  updateLocalTile();
  sendSignal({ type: 'state', ...myState() });
}

// 방에서만 나간다 (카메라는 유지)
function leaveRoom() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setWsState(false);
  [...peers.keys()].forEach(removePeer);
  joined = false;
  myId = null;
  renderGrid();
  updateLocalTile();
}

function hangup() {
  leaveRoom();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  me.muted = false;
  me.camOff = false;
  btnMute.textContent = '🎤 음소거';
  btnCam.textContent = '📷 카메라 끄기';
  updateLocalTile();
  setUi('init');
  log('나가기');
}

// ---------- 시작 ----------
try { nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch { /* 저장소 사용 불가 */ }
localTile = makeTile('local');
localTile.classList.add('local');
localTile.querySelector('video').muted = true; // 내 소리가 다시 나오지 않게
nameInput.addEventListener('input', updateLocalTile);
btnStart.addEventListener('click', startCamera);
btnJoin.addEventListener('click', join);
btnMute.addEventListener('click', toggleMute);
btnCam.addEventListener('click', toggleCam);
btnHangup.addEventListener('click', hangup);
updateLocalTile();
renderGrid();
setUi('init');
