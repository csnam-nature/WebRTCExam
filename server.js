// 단계 1~2: 정적 파일만 서빙한다. (시그널링 서버는 단계 3에서 추가)
// localhost 는 secure context 로 취급되어 getUserMedia 를 쓸 수 있다.
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
