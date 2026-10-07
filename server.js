// 정적 파일 서빙 + WebSocket 시그널링 서버 (단계 3)
// 서버는 SDP/candidate 내용을 해석하지 않고 상대에게 그대로 전달만 한다.
// 접속자는 최대 2명. 두 번째 사람이 들어오면 먼저 있던 사람(caller)에게 'ready' 를 보낸다.
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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
});
