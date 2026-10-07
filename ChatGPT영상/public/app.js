const socket = io();

const roomInput = document.querySelector("#roomInput");
const joinButton = document.querySelector("#joinButton");
const micButton = document.querySelector("#micButton");
const cameraButton = document.querySelector("#cameraButton");
const leaveButton = document.querySelector("#leaveButton");
const localVideo = document.querySelector("#localVideo");
const remoteVideo = document.querySelector("#remoteVideo");
const localPlaceholder = document.querySelector("#localPlaceholder");
const remotePlaceholder = document.querySelector("#remotePlaceholder");
const statusElement = document.querySelector("#status");
const eventLog = document.querySelector("#eventLog");

let localStream = null;
let peerConnection = null;
let currentRoomId = "";
let isInitiator = false;
let pendingCandidates = [];

function log(message) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  item.textContent = `[${time}] ${message}`;
  eventLog.append(item);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function setStatus(message, state = "idle") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

function setJoinedUi(joined) {
  roomInput.disabled = joined;
  joinButton.disabled = joined;
  leaveButton.disabled = !joined;
}

async function startLocalMedia() {
  if (localStream) return;

  log("카메라와 마이크 권한 요청");
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: true,
  });

  localVideo.srcObject = localStream;
  localPlaceholder.hidden = true;
  micButton.disabled = false;
  cameraButton.disabled = false;
  log("로컬 미디어 스트림 준비 완료");
}

function createPeerConnection() {
  if (peerConnection) return peerConnection;

  // 이 예제의 핵심: STUN/TURN 서버를 전혀 지정하지 않습니다.
  peerConnection = new RTCPeerConnection({ iceServers: [] });
  log("RTCPeerConnection 생성 (iceServers: [])");

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });
  log("로컬 오디오/비디오 트랙을 PeerConnection에 추가");

  peerConnection.addEventListener("track", (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
      remotePlaceholder.hidden = true;
      log(`원격 ${event.track.kind} 트랙 수신`);
    }
  });

  peerConnection.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      log("ICE Candidate 수집 완료");
      return;
    }

    socket.emit("ice-candidate", {
      roomId: currentRoomId,
      candidate: event.candidate,
    });
    log(`ICE Candidate 전송 (${event.candidate.type || "host"})`);
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    const state = peerConnection?.connectionState;
    log(`연결 상태: ${state}`);

    if (state === "connected") {
      setStatus("상대방과 영상이 연결되었습니다.", "active");
    } else if (state === "failed") {
      setStatus("연결에 실패했습니다. 두 탭이 localhost에서 실행 중인지 확인하세요.", "error");
    } else if (state === "disconnected") {
      setStatus("연결이 일시적으로 끊어졌습니다.", "error");
    }
  });

  peerConnection.addEventListener("iceconnectionstatechange", () => {
    log(`ICE 상태: ${peerConnection?.iceConnectionState}`);
  });

  return peerConnection;
}

async function sendOffer() {
  const connection = createPeerConnection();
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);

  socket.emit("offer", {
    roomId: currentRoomId,
    description: connection.localDescription,
  });
  log("SDP Offer 생성 및 전송");
}

async function flushPendingCandidates() {
  if (!peerConnection?.remoteDescription) return;

  for (const candidate of pendingCandidates) {
    await peerConnection.addIceCandidate(candidate);
  }

  if (pendingCandidates.length > 0) {
    log(`대기 중이던 ICE Candidate ${pendingCandidates.length}개 등록`);
  }
  pendingCandidates = [];
}

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
  }

  pendingCandidates = [];
  remoteVideo.srcObject = null;
  remotePlaceholder.hidden = false;
}

function stopLocalMedia() {
  if (!localStream) return;

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  localPlaceholder.hidden = false;
  micButton.disabled = true;
  cameraButton.disabled = true;
  micButton.textContent = "마이크 끄기";
  cameraButton.textContent = "카메라 끄기";
}

function resetRoom({ stopMedia = false } = {}) {
  closePeerConnection();
  if (stopMedia) stopLocalMedia();

  currentRoomId = "";
  isInitiator = false;
  setJoinedUi(false);
}

joinButton.addEventListener("click", async () => {
  const requestedRoomId = roomInput.value.trim();
  if (!requestedRoomId) {
    setStatus("방 이름을 입력해 주세요.", "error");
    return;
  }

  joinButton.disabled = true;
  try {
    await startLocalMedia();
    setStatus("방에 입장하는 중입니다…");
    socket.emit("join-room", requestedRoomId);
  } catch (error) {
    joinButton.disabled = false;
    setStatus(`미디어를 열 수 없습니다: ${error.message}`, "error");
    log(`미디어 오류: ${error.name}`);
  }
});

roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !joinButton.disabled) {
    joinButton.click();
  }
});

micButton.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  micButton.textContent = track.enabled ? "마이크 끄기" : "마이크 켜기";
  log(`마이크 ${track.enabled ? "켜짐" : "꺼짐"}`);
});

cameraButton.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  cameraButton.textContent = track.enabled ? "카메라 끄기" : "카메라 켜기";
  log(`카메라 ${track.enabled ? "켜짐" : "꺼짐"}`);
});

leaveButton.addEventListener("click", () => {
  socket.emit("leave-room");
  resetRoom({ stopMedia: true });
  setStatus("통화를 종료했습니다.");
  log("방 퇴장 및 미디어 자원 정리");
});

socket.on("connect", () => {
  log(`시그널링 서버 연결 (${socket.id})`);
});

socket.on("disconnect", () => {
  closePeerConnection();
  setStatus("시그널링 서버 연결이 끊어졌습니다.", "error");
  log("시그널링 서버 연결 종료");
});

socket.on("room-joined", ({ roomId, isInitiator: initiator }) => {
  currentRoomId = roomId;
  isInitiator = initiator;
  setJoinedUi(true);
  log(`방 입장: ${roomId} (${initiator ? "Offer 생성 역할" : "Answer 생성 역할"})`);
});

socket.on("waiting", () => {
  setStatus("방에 입장했습니다. 두 번째 탭을 기다리는 중입니다.", "active");
});

socket.on("room-ready", async () => {
  setStatus("상대방이 입장했습니다. 연결을 준비합니다…", "active");
  log("두 명 입장 완료");

  try {
    createPeerConnection();
    if (isInitiator) await sendOffer();
  } catch (error) {
    setStatus(`연결 준비 중 오류가 발생했습니다: ${error.message}`, "error");
    log(`연결 준비 오류: ${error.message}`);
  }
});

socket.on("offer", async (description) => {
  try {
    const connection = createPeerConnection();
    await connection.setRemoteDescription(description);
    log("SDP Offer 수신 및 Remote Description 등록");
    await flushPendingCandidates();

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    socket.emit("answer", {
      roomId: currentRoomId,
      description: connection.localDescription,
    });
    log("SDP Answer 생성 및 전송");
  } catch (error) {
    setStatus(`Offer 처리 오류: ${error.message}`, "error");
    log(`Offer 처리 오류: ${error.message}`);
  }
});

socket.on("answer", async (description) => {
  try {
    await peerConnection.setRemoteDescription(description);
    log("SDP Answer 수신 및 Remote Description 등록");
    await flushPendingCandidates();
  } catch (error) {
    setStatus(`Answer 처리 오류: ${error.message}`, "error");
    log(`Answer 처리 오류: ${error.message}`);
  }
});

socket.on("ice-candidate", async (candidate) => {
  try {
    if (peerConnection?.remoteDescription) {
      await peerConnection.addIceCandidate(candidate);
      log("원격 ICE Candidate 등록");
    } else {
      pendingCandidates.push(candidate);
      log("ICE Candidate 임시 보관 (Remote Description 대기)");
    }
  } catch (error) {
    setStatus(`ICE Candidate 처리 오류: ${error.message}`, "error");
    log(`ICE Candidate 처리 오류: ${error.message}`);
  }
});

socket.on("peer-left", () => {
  closePeerConnection();
  isInitiator = true;
  setStatus("상대방이 나갔습니다. 새 사용자를 기다리는 중입니다.", "active");
  log("상대방 퇴장; 다음 연결에서는 Offer 생성 역할로 전환");
});

socket.on("room-full", () => {
  resetRoom({ stopMedia: true });
  setStatus("이미 두 명이 사용 중인 방입니다.", "error");
  log("방 입장 거절: 정원 초과");
});

socket.on("room-error", (message) => {
  resetRoom({ stopMedia: true });
  setStatus(message, "error");
  log(`방 오류: ${message}`);
});
