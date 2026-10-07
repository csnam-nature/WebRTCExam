// 정적 파일 서빙 + WebSocket 시그널링 서버 (단계 3) + ICE 서버 설정 제공 (단계 6)
// 서버는 SDP/candidate 내용을 해석하지 않고 상대에게 그대로 전달만 한다.
// 접속자는 최대 2명. 두 번째 사람이 들어오면 먼저 있던 사람(caller)에게 'ready' 를 보낸다.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---------- 단계 6: STUN/TURN 설정 (.env, .env.example 참고) ----------
const splitUrls = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const STUN_URLS = splitUrls(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302'); // 빈 값이면 STUN 끔
const TURN_URLS = splitUrls(process.env.TURN_URLS);
const TURN_TTL = Number(process.env.TURN_TTL || 3600);

function iceServers() {
  const list = [];
  if (STUN_URLS.length) list.push({ urls: STUN_URLS });
  if (TURN_URLS.length) {
    if (process.env.TURN_SECRET) {
      // coturn use-auth-secret 방식: 고정 비밀번호를 브라우저에 노출하지 않고 시간제한 자격증명을 발급한다.
      //   username   = 만료시각(unix초):아무이름
      //   credential = base64(HMAC-SHA1(secret, username))
      const username = `${Math.floor(Date.now() / 1000) + TURN_TTL}:study`;
      const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
      list.push({ urls: TURN_URLS, username, credential });
    } else {
      // 고정 계정 (관리형 TURN 서비스에서 받은 값 등)
      list.push({ urls: TURN_URLS, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
    }
  }
  return list;
}

app.get('/ice-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers: iceServers() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = []; // 최대 2명

const send = (ws, obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
const other = (ws) => clients.find((c) => c !== ws);

wss.on('connection', (ws) => {
  if (clients.length >= 2) {
    send(ws, { type: 'full' });
    ws.close();
    console.log('접속 거부: 방이 가득 참');
    return;
  }

  clients.push(ws);
  console.log(`접속 (${clients.length}/2)`);
  send(ws, { type: 'joined', count: clients.length });

  if (clients.length === 2) send(clients[0], { type: 'ready' }); // 먼저 온 쪽이 offer 를 만든다

  ws.on('message', (data) => {
    const peer = other(ws);
    if (peer && peer.readyState === peer.OPEN) peer.send(data.toString());
  });

  ws.on('close', () => {
    const i = clients.indexOf(ws);
    if (i >= 0) clients.splice(i, 1);
    console.log(`종료 (${clients.length}/2)`);
    clients.forEach((c) => send(c, { type: 'leave' }));
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  console.log(`STUN: ${STUN_URLS.join(', ') || '(없음)'}`);
  const turnAuth = process.env.TURN_SECRET ? '시간제한 자격증명' : '고정 계정';
  console.log(`TURN: ${TURN_URLS.length ? `${TURN_URLS.join(', ')} (${turnAuth})` : '(없음)'}`);
});
