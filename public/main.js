// 단계 1~2: 카메라 + 한 페이지 loopback (pc1 → pc2)
// iceServers 를 비워 두므로 host 후보만 사용한다. (STUN/TURN 은 이후 단계)

const $ = (id) => document.getElementById(id);
const localVideo = $('local');
const remoteVideo = $('remote');
const btnStart = $('btnStart');
const btnCall = $('btnCall');
const btnHangup = $('btnHangup');
const logEl = $('log');

let localStream = null;
let pc1 = null;
let pc2 = null;

function log(msg) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- 단계 1: 카메라 ----------
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    log(`카메라 실패: ${err.name} - ${err.message}`);
    if (err.name === 'NotAllowedError') log('→ 브라우저 주소창에서 카메라 권한을 허용해 주세요.');
    if (err.name === 'NotFoundError') log('→ 사용 가능한 카메라/마이크가 없습니다.');
    if (err.name === 'NotReadableError') log('→ 다른 앱/탭이 카메라를 사용 중일 수 있습니다.');
    return;
  }
  localVideo.srcObject = localStream;
  const tracks = localStream.getTracks().map((t) => `${t.kind}(${t.label})`).join(', ');
  log(`카메라 켜짐: ${tracks}`);
  btnStart.disabled = true;
  btnCall.disabled = false;
}

// ---------- 단계 2: loopback ----------
// remoteDescription 이 설정되기 전에 도착한 candidate 는 큐에 보관했다가 처리한다.
const pendingCandidates = new Map();

async function addCandidate(pc, candidate) {
  if (!pc.remoteDescription) {
    if (!pendingCandidates.has(pc)) pendingCandidates.set(pc, []);
    pendingCandidates.get(pc).push(candidate);
    log('  (candidate 큐에 보관: remoteDescription 아직 없음)');
    return;
  }
  await pc.addIceCandidate(candidate);
}

async function flushCandidates(pc) {
  const queue = pendingCandidates.get(pc) || [];
  pendingCandidates.delete(pc);
  for (const c of queue) await pc.addIceCandidate(c);
}

function summarizeSdp(label, sdp) {
  const lines = sdp.split('\r\n');
  const media = lines.filter((l) => l.startsWith('m=')).map((l) => l.split(' ')[0]);
  log(`${label}: ${lines.length}줄, ${media.join(' ')}`);
  console.log(`--- ${label} ---\n${sdp}`);
}

function wirePc(pc, name, stateEl, peer) {
  pc.onicecandidate = (e) => {
    if (!e.candidate) {
      log(`${name} ICE 수집 완료`);
      return;
    }
    log(`${name} candidate [${e.candidate.type}] ${e.candidate.address}:${e.candidate.port} (${e.candidate.protocol})`);
    addCandidate(peer(), e.candidate).catch((err) => log(`addIceCandidate 실패: ${err.message}`));
  };
  pc.onconnectionstatechange = () => {
    stateEl.textContent = pc.connectionState;
    log(`${name} connectionState: ${pc.connectionState}`);
  };
  pc.oniceconnectionstatechange = () => log(`${name} iceConnectionState: ${pc.iceConnectionState}`);
}

async function call() {
  btnCall.disabled = true;
  btnHangup.disabled = false;

  const config = { iceServers: [] }; // STUN/TURN 없음
  pc1 = new RTCPeerConnection(config);
  pc2 = new RTCPeerConnection(config);
  wirePc(pc1, 'pc1', $('state1'), () => pc2);
  wirePc(pc2, 'pc2', $('state2'), () => pc1);

  // pc2 가 트랙을 받으면 오른쪽 video 에 연결
  pc2.ontrack = (e) => {
    log(`pc2 ontrack: ${e.track.kind}`);
    if (remoteVideo.srcObject !== e.streams[0]) remoteVideo.srcObject = e.streams[0];
  };

  // 반드시 createOffer 이전에 addTrack
  localStream.getTracks().forEach((t) => pc1.addTrack(t, localStream));

  try {
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer); // 이 시점부터 pc1 의 ICE 수집이 시작된다
    summarizeSdp('offer', offer.sdp);

    await pc2.setRemoteDescription(offer);
    await flushCandidates(pc2);

    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    summarizeSdp('answer', answer.sdp);

    await pc1.setRemoteDescription(answer);
    await flushCandidates(pc1);
  } catch (err) {
    log(`협상 실패: ${err.name} - ${err.message}`);
  }
}

function hangup() {
  [pc1, pc2].forEach((pc) => pc && pc.close());
  pc1 = pc2 = null;
  pendingCandidates.clear();
  remoteVideo.srcObject = null;

  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  localVideo.srcObject = null;

  $('state1').textContent = '-';
  $('state2').textContent = '-';
  btnStart.disabled = false;
  btnCall.disabled = true;
  btnHangup.disabled = true;
  log('종료');
}

btnStart.addEventListener('click', startCamera);
btnCall.addEventListener('click', call);
btnHangup.addEventListener('click', hangup);
