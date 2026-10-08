# WebRTC 영상 통화 스터디 — 기술 문서

웹 브라우저끼리 WebRTC로 서로의 카메라 영상을 주고받는 스터디 예제의 기술 정리입니다. 1:1 통화와 최대 4명 그룹 통화를 다룹니다.
서버는 **연결 설정(시그널링)** 에만 관여하고, 영상은 브라우저끼리 직접(P2P) 또는 TURN 서버를 거쳐 흐릅니다.

## 문서 목차

| 문서 | 내용 |
|---|---|
| [01-webrtc-concepts.md](01-webrtc-concepts.md) | WebRTC 핵심 개념: MediaStream, RTCPeerConnection, SDP, ICE |
| [02-architecture.md](02-architecture.md) | 프로젝트 구조, 시그널링 프로토콜, 코드 흐름, 화면 구성 |
| [03-stun-turn.md](03-stun-turn.md) | NAT, STUN, TURN, coturn 구성과 시간제한 자격증명 |
| [04-network-access.md](04-network-access.md) | 다른 PC 접속: secure context(HTTPS), 방화벽, 다른 네트워크 |
| [05-troubleshooting.md](05-troubleshooting.md) | 실습 중 겪은 문제와 해결, 자주 막히는 지점 |
| [06-verification.md](06-verification.md) | 단계별 검증 방법과 결과 |
| [07-cloudflared-tunnel.md](07-cloudflared-tunnel.md) | cloudflared 터널로 외부망(다른 네트워크)에서 접속하기 |
| [08-group-call.md](08-group-call.md) | 그룹 영상통화 (최대 4명, Mesh): 시그널링, 화면 배치, 크게 보기, 검증 |

## 학습 단계

| 단계 | 주제 | 결과물 |
|---|---|---|
| 1 | 내 카메라 띄우기 | `getUserMedia` 로 로컬 영상 표시 |
| 2 | 한 페이지 loopback | `pc1 → pc2` 를 같은 페이지에서 직접 연결 (`loopback.html`) |
| 3 | 시그널링 서버 | WebSocket 으로 두 탭이 메시지 교환 |
| 4 | 두 탭 영상 연결 | Offer/Answer/ICE 를 시그널링으로 교환해 1:1 통화 (`call-1to1.html`) |
| 5 | 마무리 | 연결 상태·후보 쌍 표시, 음소거, 종료, 재접속 |
| 6 | STUN/TURN | `/ice-config`, relay 강제, ICE 테스트 페이지, coturn (`ice-test.html`) |
| 7 | HTTPS 모드 | `npm run start:https`, 자체 서명 인증서 자동 생성 → **다른 PC 와 실제 카메라로 영상 연결 성공** |
| 8 | 그룹 통화 | 최대 4명 Mesh, 인원수별 자동 배치, 이름·음소거·카메라 상태 표시, 타일 클릭 크게 보기 (`index.html`) |

## 빠른 시작

```bash
npm install
copy .env.example .env      # 필요 시 STUN/TURN 값 수정
npm start                   # http://localhost:3000  (같은 PC 의 탭끼리)
npm run start:https         # https://<서버 IP>:3000 (다른 PC 와 연결)
```

- 탭(또는 브라우저) 여러 개에서 `http://localhost:3000` → **이름 입력 → 카메라 켜기 → 접속** (그룹 통화, 최대 4명)
- **다른 PC** 와 연결하려면 `npm run start:https` 로 실행하고 `https://<서버 IP>:3000` 으로 접속 (인증서 경고 → [고급] → [계속 진행])
- TURN 서버까지 실습하려면 Docker Desktop 을 켜고 `npm run turn` 실행 후 안내대로 `.env` 설정

| 페이지 | 용도 |
|---|---|
| `/` (`index.html`) | 그룹 영상 통화 (최대 4명) |
| `/call-1to1.html` | 1:1 영상 통화 |
| `/loopback.html` | 단계 2: 한 페이지 안에서 PeerConnection 2개 연결 |
| `/ice-test.html` | 상대 없이 STUN/TURN 동작 확인 |

## 사용 기술 요약

| 구분 | 기술 | 역할 |
|---|---|---|
| 미디어 | `navigator.mediaDevices.getUserMedia` | 카메라/마이크 스트림 획득 |
| P2P 연결 | `RTCPeerConnection` | 연결·암호화(DTLS-SRTP)·미디어 전송 |
| 협상 | SDP Offer/Answer | 코덱·미디어 방향 등 능력 교환 |
| 경로 탐색 | ICE (host / srflx / relay 후보) | 통하는 네트워크 경로 탐색 |
| 시그널링 | WebSocket (`ws`) | SDP·ICE 후보 전달 (WebRTC 표준에 없음 → 직접 구현) |
| 서버 | Node.js + Express | 정적 파일, 시그널링, ICE 설정 제공 |
| 보안 연결 | Node `https` + `selfsigned` | 다른 PC 에서 카메라를 쓰기 위한 HTTPS (secure context), `wss://` 시그널링 |
| NAT 통과 | STUN (`stun.l.google.com:19302`) | 공인 IP:포트 확인 |
| 중계 | TURN (coturn, Docker) | 직접 연결이 안 될 때 미디어 중계 |
| 디버깅 | `chrome://webrtc-internals`, `getStats()` | 연결 상태·후보 쌍·비트레이트 확인 |

## 환경

- Node.js 22.9 이상 (`--env-file-if-exists` 사용). 개발 환경: Node 24
- Chrome / Edge 최신
- (선택) Docker Desktop — coturn 실행용

## 저장소

- GitHub: https://github.com/csnam-nature/WebRTCExam (`main` 브랜치)
- git 에 올리지 않는 파일: `.env` (TURN 비밀값), `cert/` (인증서 개인키), `node_modules/`
