# 00. 요약: 개발 방법과 실행 방법

이 문서 하나로 프로젝트 전체를 빠르게 파악할 수 있도록 정리한 요약본입니다. 자세한 내용은 각 항목의 링크 문서를 참고하세요.

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 목적 | WebRTC 로 브라우저끼리 카메라 영상을 주고받는 스터디 예제 |
| 기능 | 1:1 통화, **최대 4명 그룹 통화**, loopback 실습, STUN/TURN 시험 페이지 |
| 구조 | 서버는 연결 설정(시그널링)만, 영상은 브라우저끼리 직접(P2P) 또는 TURN 경유 |
| 서버 | Node.js + Express + `ws` (WebSocket) + Node `https` / `selfsigned` |
| 클라이언트 | 순수 HTML/CSS/JavaScript (프레임워크 없음) |
| NAT 통과 | STUN `stun.l.google.com:19302`, TURN coturn (Docker) |
| 저장소 | https://github.com/csnam-nature/WebRTCExam |

```
 브라우저 A ◄── HTTP(S) 페이지 · /ice-config · WebSocket 시그널링 ──► Node 서버 (server.js)
 브라우저 A ◄════════════ 영상·음성 (P2P 또는 TURN 경유) ════════════► 브라우저 B, C, D
```

## 2. 개발 방법 (진행 순서)

개념을 하나씩만 추가하도록 단계를 나눠 개발했습니다. 각 단계는 동작을 확인한 뒤 다음으로 넘어갔습니다.

| 단계 | 한 일 | 핵심 포인트 | 결과물 |
|---|---|---|---|
| 1 | 카메라 띄우기 | `getUserMedia`, `<video>.srcObject`, 내 영상은 `muted` | - |
| 2 | 한 페이지 loopback | `pc1 → pc2` 를 함수 호출로 직접 연결해 Offer/Answer/ICE 흐름만 익힘 | `loopback.html` |
| 3 | 시그널링 서버 | WebSocket 으로 메시지를 상대에게 그대로 전달, 2명 제한, 먼저 온 쪽이 caller | `server.js` |
| 4 | 두 탭 1:1 연결 | 단계 2 의 직접 호출을 WebSocket 메시지로 교체, candidate 큐 처리 | `call-1to1.html` |
| 5 | 마무리 | 연결 상태·선택된 후보 쌍 표시, 음소거, 종료, 재접속, 오류 안내 | - |
| 6 | STUN/TURN | `/ice-config`(.env 기반), 시간제한 TURN 자격증명, relay 강제, coturn | `ice-test.html`, `turn/` |
| 7 | HTTPS 모드 | 다른 PC 에서 카메라 사용(secure context), 자체 서명 인증서 자동 생성·재사용 | `npm run start:https` |
| 8 | 그룹 통화 | 최대 4명 Mesh, 참가자 ID·대상 지정 시그널링, 인원수별 배치, 크게 보기 | `index.html`, `group.js` |

### 개발하면서 지킨 원칙

- **순서 규칙**: `addTrack` 은 `createOffer`/`createAnswer` 전에, `remoteDescription` 이전에 온 candidate 는 큐에 보관 → [01](01-webrtc-concepts.md)
- **비밀값 분리**: TURN 비밀키는 `.env`(git 제외), 브라우저에는 서버가 발급한 임시 자격증명만 전달 → [03](03-stun-turn.md)
- **실패를 화면에 보이기**: 카메라 권한·보안 연결·시그널링·ICE 실패를 빨간 안내로 표시 → [05](05-troubleshooting.md)
- **그룹 통화의 충돌 방지**: 새로 들어온 사람만 offer → glare 없음. 시그널링 메시지는 도착 순서대로 직렬 처리 → [08](08-group-call.md)

### 검증 방법

- 자동 검증 환경에는 카메라가 없어서, 탭마다 `getUserMedia` 를 **canvas 영상(+오실레이터 음)** 으로 바꿔 끼워 시험했습니다.
- 탭 여러 개로 실제 연결을 만들고 `getStats()` 의 선택된 후보 쌍, 수신 프레임 수, 화면 스크린샷으로 확인했습니다.
- 실제 카메라로 **다른 PC 와의 연결**은 사용자 환경에서 확인했습니다.
- 결과 정리: [06-verification.md](06-verification.md), [08-group-call.md](08-group-call.md) 5절

## 3. 프로젝트 구조

```
영상/
├─ server.js            # 정적 서빙 + 시그널링(/ = 1:1, /group = 그룹) + /ice-config + HTTPS 모드
├─ package.json         # npm 스크립트, 의존성(express, ws, selfsigned)
├─ .env.example         # 설정 예시 → .env 로 복사 (git 제외)
├─ cert/                # HTTPS 자체 서명 인증서·개인키 (자동 생성, git 제외)
├─ turn/
│  ├─ turnserver.conf   # coturn 설정
│  └─ run-coturn.ps1    # coturn Docker 실행 (npm run turn)
├─ public/
│  ├─ index.html, group.js           # 그룹 통화 (최대 4명)
│  ├─ call-1to1.html, call-1to1.js   # 1:1 통화
│  ├─ loopback.html, loopback.js     # 한 페이지 loopback
│  ├─ ice-test.html, ice-test.js     # STUN/TURN 후보 수집 시험
│  └─ style.css
└─ DOC/                 # 기술 문서
```

## 4. 실행 방법

### 4.1 준비 (한 번만)

```bash
npm install
```

```bash
copy .env.example .env
```

- Node.js 22.9 이상 필요 (`--env-file-if-exists` 사용)
- 다른 PC 에서 새 버전을 받았다면 `npm install` 을 다시 실행

### 4.2 npm 스크립트

| 명령 | 용도 |
|---|---|
| `npm start` | HTTP 로 실행 (`http://localhost:3000`) — 같은 PC 의 탭끼리 |
| `npm run start:https` | HTTPS 로 실행 (`https://<서버 IP>:3000`) — 같은 LAN 의 다른 PC 와 |
| `npm run turn` | coturn(TURN 서버)을 Docker 로 실행 (Docker Desktop 필요) |

서버를 시작하면 접속 가능한 주소(`localhost` 와 각 LAN IP)가 출력됩니다.

### 4.3 상황별 실행

| 상황 | 서버 PC 에서 | 접속 주소 | 비고 |
|---|---|---|---|
| **같은 PC 에서 시험** | `npm start` | `http://localhost:3000` | 탭/브라우저 여러 개. 카메라 점유 시 Chrome·Edge 로 나눠 열기 |
| **같은 공유기(LAN)의 다른 PC** | `npm run start:https` | `https://<서버 IP>:3000` | 첫 접속 인증서 경고 → [고급] → [이동]. Windows 방화벽에서 포트 허용 → [04](04-network-access.md) |
| **다른 네트워크(외부망)** | `npm start` + `cloudflared tunnel --url http://localhost:3000` | `https://xxxx.trycloudflare.com` | 주소는 실행마다 바뀜. 안 되는 망은 공인 TURN 필요 → [07](07-cloudflared-tunnel.md) |
| **TURN 시험 (LAN)** | `npm run turn` → `.env` 에 `TURN_URLS`, `TURN_SECRET` → `npm start` | `/ice-test.html` 에서 relay 확인 | [TURN만 사용] 체크로 relay 강제 → [03](03-stun-turn.md) |

### 4.4 페이지

| 주소 | 용도 | 사용법 |
|---|---|---|
| `/` | 그룹 통화 (최대 4명) | 이름 입력 → 카메라 켜기 → 접속. 타일 클릭 시 크게 보기, Esc 로 해제 |
| `/call-1to1.html` | 1:1 통화 | 카메라 켜기 → 접속 (2명) |
| `/loopback.html` | loopback 실습 | 카메라 켜기 → 연결 시작 (한 페이지 안에서 연결) |
| `/ice-test.html` | STUN/TURN 시험 | 후보 수집 → host / srflx / relay 판정 |

### 4.5 `.env` 주요 설정

| 변수 | 예시 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `HTTPS` | `1` | HTTPS 모드 (`npm run start:https` 와 같음) |
| `TLS_CERT` / `TLS_KEY` | `cert/mycert.pem` | mkcert 등 인증서 지정 (없으면 자체 서명 자동 생성) |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | 비우면 STUN 끔 |
| `TURN_URLS` | `turn:192.168.x.x:3478?transport=udp,...` | 비우면 TURN 끔 |
| `TURN_SECRET` | coturn `static-auth-secret` 과 같은 값 | 시간제한 자격증명 발급 |
| `TURN_USER` / `TURN_PASS` | - | 관리형 TURN 의 고정 계정 (`TURN_SECRET` 이 없을 때) |

## 5. 연결이 안 될 때 빠른 점검

| 증상 | 확인할 것 |
|---|---|
| [접속] 버튼이 회색 / 카메라 오류 | `http://IP` 로 접속하지 않았는지 → `localhost` 또는 `https` 사용 |
| `ERR_SSL_PROTOCOL_ERROR` | HTTP 서버에 `https://` 로 접속 → `npm run start:https` 로 실행 |
| `ERR_CERT_AUTHORITY_INVALID` | 자체 서명 인증서라 정상 → [고급] → [이동] |
| "시그널링 서버에 연결하지 못했습니다" | 서버 실행 여부, 포트, 방화벽 |
| 그룹 통화 접속이 안 됨 | 서버를 최신 코드로 **재시작**했는지 (`/group` 경로는 새 서버에만 있음) |
| "방이 가득 찼습니다" | 1:1 은 2명, 그룹은 4명 제한 |
| `연결 실패(ICE failed)` | 다른 네트워크라면 TURN 필요, relay 강제 시 TURN 설정 확인 |
| TURN 오류 401 / 701 | 401 = 비밀값 불일치·만료, 701 = 서버에 닿지 못함 |

자세한 사례: [05-troubleshooting.md](05-troubleshooting.md)

## 6. git 작업 흐름

- 원격: `origin` → `csnam-nature/WebRTCExam`
- 기능 단위로 브랜치를 만들어 커밋·푸시하고, 확인 후 `main` 에 병합
  - 예: `feature/stun-turn`(STUN/TURN·HTTPS) → `main` 병합, `branch_multiUser`(그룹 통화)
- 커밋하지 않는 파일: `.env`, `cert/`, `node_modules/`

## 7. 문서 목록

| 문서 | 내용 |
|---|---|
| [01-webrtc-concepts.md](01-webrtc-concepts.md) | WebRTC 핵심 개념 |
| [02-architecture.md](02-architecture.md) | 구조, 시그널링, 코드 흐름, 화면 (1:1 기준) |
| [03-stun-turn.md](03-stun-turn.md) | STUN/TURN, coturn |
| [04-network-access.md](04-network-access.md) | 다른 PC 접속, HTTPS 모드 |
| [05-troubleshooting.md](05-troubleshooting.md) | 문제 해결 기록 |
| [06-verification.md](06-verification.md) | 검증 결과 |
| [07-cloudflared-tunnel.md](07-cloudflared-tunnel.md) | 외부망 접속 (터널) |
| [08-group-call.md](08-group-call.md) | 그룹 통화 (최대 4명) |
