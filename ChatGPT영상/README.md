# WebRTC 로컬 맛보기

STUN/TURN 없이 `localhost`의 브라우저 탭 두 개 사이에서 영상과 음성을 교환하는 학습용 예제입니다.

## 실행

Node.js 18 이상이 필요합니다.

```bash
npm install
npm start
```

브라우저에서 <http://localhost:3000>을 탭 두 개로 연 뒤, 두 탭 모두 같은 방 이름으로 입장합니다.

## 학습 포인트

- `getUserMedia()`로 카메라와 마이크 스트림 획득
- Socket.IO로 SDP Offer/Answer 교환
- Trickle ICE 방식으로 ICE Candidate 교환
- `RTCPeerConnection`을 통한 브라우저 간 미디어 전송
- 마이크와 카메라 트랙 활성화/비활성화
- 연결 종료 및 미디어 자원 정리

`RTCPeerConnection`에는 의도적으로 `iceServers: []`를 사용했습니다. 따라서 이 예제는 같은 PC의 두 탭 또는 연결 가능한 로컬 환경에서 WebRTC 흐름을 학습하는 용도이며, 인터넷을 통한 안정적인 연결은 지원하지 않습니다.

## 주요 시그널링 이벤트

| 이벤트 | 설명 |
| --- | --- |
| `join-room` | 최대 두 명까지 방 입장 |
| `offer` | 최초 사용자가 생성한 SDP Offer 전달 |
| `answer` | 두 번째 사용자가 생성한 SDP Answer 전달 |
| `ice-candidate` | 로컬 연결 후보 전달 |
| `leave-room` | 방 퇴장 및 상대방 알림 |

## 문제 해결

- 카메라가 열리지 않으면 브라우저 주소창의 카메라/마이크 권한을 확인합니다.
- 카메라 한 대를 두 탭에서 동시에 열 수 없는 환경에서는 `public/app.js`의 미디어 설정에서 `audio: false`로 먼저 영상만 테스트합니다.
- 세 번째 탭은 같은 방에 입장할 수 없습니다.
- 외부 기기에서 HTTP로 접속하면 보안 컨텍스트 제한으로 카메라 사용이 차단될 수 있습니다. 이 예제는 `localhost` 실행을 기준으로 합니다.
