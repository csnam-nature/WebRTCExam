// 정적 파일 서빙 + WebSocket 시그널링 서버 (단계 3) + ICE 서버 설정 제공 (단계 6) + HTTPS 모드
// 서버는 SDP/candidate 내용을 해석하지 않고 상대에게 그대로 전달만 한다.
// 접속자는 최대 2명. 두 번째 사람이 들어오면 먼저 있던 사람(caller)에게 'ready' 를 보낸다.
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
// 다른 PC 에서 카메라를 쓰려면 HTTPS 가 필요하다 (http://IP 는 secure context 가 아님)
const USE_HTTPS = process.argv.includes('--https') || process.env.HTTPS === '1';

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

// ---------- HTTPS 인증서 ----------
const lanIPv4 = () =>
  Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);

// 1) .env 의 TLS_CERT / TLS_KEY (mkcert 등으로 만든 인증서) 가 있으면 사용
// 2) 없으면 cert/ 에 자체 서명 인증서를 만들어 재사용한다.
//    매번 새로 만들면 브라우저 경고를 다시 승인해야 하므로, 현재 IP 가 모두 들어 있고 유효하면 그대로 쓴다.
async function loadTls() {
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), source: process.env.TLS_CERT };
  }
  const dir = path.join(__dirname, 'cert');
  const certFile = path.join(dir, 'selfsigned.crt');
  const keyFile = path.join(dir, 'selfsigned.key');
  const ips = lanIPv4();

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const cert = fs.readFileSync(certFile);
    const x509 = new crypto.X509Certificate(cert);
    const san = x509.subjectAltName || '';
    const valid = new Date(x509.validTo) > new Date(Date.now() + 24 * 3600 * 1000);
    if (valid && ips.every((ip) => san.includes(`IP Address:${ip}`))) {
      return { cert, key: fs.readFileSync(keyFile), source: `${certFile} (재사용)` };
    }
    console.log('인증서에 현재 IP 가 없거나 만료가 가까워 새로 만듭니다.');
  }

  const selfsigned = require('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'webrtc-study' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private);
  return { cert: pems.cert, key: pems.private, source: `${certFile} (새로 생성: localhost, ${ips.join(', ')})` };
}

// ---------- 시그널링 ----------
const clients = []; // 최대 2명

const send = (ws, obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
const other = (ws) => clients.find((c) => c !== ws);

function onConnection(ws) {
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
}

// ---------- 시작 ----------
async function main() {
  let server;
  if (USE_HTTPS) {
    const tls = await loadTls();
    server = https.createServer({ cert: tls.cert, key: tls.key }, app);
    console.log(`인증서: ${tls.source}`);
  } else {
    server = http.createServer(app);
  }
  new WebSocketServer({ server }).on('connection', onConnection);

  server.listen(PORT, () => {
    const proto = USE_HTTPS ? 'https' : 'http';
    console.log(`${proto}://localhost:${PORT}`);
    lanIPv4().forEach((ip) => console.log(`${proto}://${ip}:${PORT}   ← 다른 PC 에서 접속`));
    if (USE_HTTPS) console.log('자체 서명 인증서 경고가 나오면 [고급] → [계속 진행]을 누르세요.');
    else console.log('다른 PC 에서 카메라를 쓰려면 HTTPS 모드로 실행하세요: npm run start:https');
    console.log(`STUN: ${STUN_URLS.join(', ') || '(없음)'}`);
    const turnAuth = process.env.TURN_SECRET ? '시간제한 자격증명' : '고정 계정';
    console.log(`TURN: ${TURN_URLS.length ? `${TURN_URLS.join(', ')} (${turnAuth})` : '(없음)'}`);
  });
}

main().catch((err) => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
