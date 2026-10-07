# WebRTC 1:1 영상 통화 스터디 — 기술 문서

두 개의 웹 브라우저가 WebRTC로 서로의 카메라 영상을 주고받는 스터디 예제의 기술 정리입니다.
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

## 학습 단계

| 단계 | 주제 | 결과물 |
|---|---|---|
| 1 | 내 카메라 띄우기 | `getUserMedia` 로 로컬 영상 표시 |
| 2 | 한 페이지 loopback | `pc1 → pc2` 를 같은 페이지에서 직접 연결 (`loopback.html`) |
| 3 | 시그널링 서버 | WebSocket 으로 두 탭이 메시지 교환 |
| 4 | 두 탭 영상 연결 | Offer/Answer/ICE 를 시그널링으로 교환해 1:1 통화 (`index.html`) |
| 5 | 마무리 | 연결 상태·후보 쌍 표시, 음소거, 종료, 재접속 |
| 6 | STUN/TURN | `/ice-config`, relay 강제, ICE 테스트 페이지, coturn (`ice-test.html`) |

## 빠른 시작

```bash
npm install
copy .env.example .env      # 필요 시 STUN/TURN 값 수정
npm start                   # http://localhost:3000
```

- 탭 2개(또는 브라우저 2개)에서 `http://localhost:3000` → **카메라 켜기 → 접속**
- TURN 서버까지 실습하려면 Docker Desktop 을 켜고 `npm run turn` 실행 후 안내대로 `.env` 설정

| 페이지 | 용도 |
|---|---|
| `/` (`index.html`) | 1:1 영상 통화 |
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
| NAT 통과 | STUN (`stun.l.google.com:19302`) | 공인 IP:포트 확인 |
| 중계 | TURN (coturn, Docker) | 직접 연결이 안 될 때 미디어 중계 |
| 디버깅 | `chrome://webrtc-internals`, `getStats()` | 연결 상태·후보 쌍·비트레이트 확인 |

## 환경

- Node.js 22.9 이상 (`--env-file-if-exists` 사용). 개발 환경: Node 24
- Chrome / Edge 최신
- (선택) Docker Desktop — coturn 실행용
