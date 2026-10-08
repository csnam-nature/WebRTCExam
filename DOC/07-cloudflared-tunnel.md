# 07. cloudflared 터널로 외부망 접속하기

다른 네트워크(다른 공유기, LTE, 회사 밖 등)의 사람과 연결하기 위해,
내 PC 에서 돌고 있는 서버를 **공개 HTTPS 주소**로 열어 주는 방법입니다.

> 이 문서는 cloudflared 의 일반적인 사용법을 정리한 것으로, 이 프로젝트 환경에서 아직 직접 실행해 검증하지는 않았습니다.

## 1. 개념

```
[외부 사용자] ──https──► https://xxxx.trycloudflare.com (Cloudflare)
                                   │ 터널 (내 PC 가 먼저 연결해 둔 통로)
                                   ▼
                     내 PC: cloudflared ──► http://localhost:3000 (npm start)
```

- 내 PC 에서 Cloudflare 로 **나가는 연결**만 만들기 때문에 공유기 포트포워딩이나 방화벽 인바운드 설정이 필요 없습니다.
- Cloudflare 가 **정식 인증서**를 붙여 주므로 브라우저 인증서 경고가 없습니다 (자체 서명 인증서와의 차이).
- 터널이 전달하는 것은 **웹 트래픽(페이지, `/ice-config`, WebSocket 시그널링)** 뿐입니다.
  영상은 터널을 거치지 않고 P2P(STUN) 또는 TURN 으로 따로 흐릅니다.

외부망 연결에 필요한 두 경로:

| 경로 | 해결 방법 |
|---|---|
| ① 웹페이지 + 시그널링 | **cloudflared 터널** (이 문서) |
| ② 영상 | STUN (이미 설정됨) → 대부분 해결. 안 되는 망은 **공인 주소의 TURN** 필요 ([03-stun-turn.md](03-stun-turn.md)) |

## 2. 단계별 사용법

### 1단계. cloudflared 설치 (한 번만)

```bash
winget install --id Cloudflare.cloudflared
```

- winget 을 쓸 수 없으면 GitHub(`github.com/cloudflare/cloudflared/releases`)에서 `cloudflared-windows-amd64.exe` 를 받아 `cloudflared.exe` 로 이름을 바꿔 사용합니다.
- 설치 후 **터미널을 새로 열어야** PATH 가 적용됩니다.

설치 확인:

```bash
cloudflared --version
```

### 2단계. `.env` 정리 (외부 테스트용)

로컬 Docker coturn 은 relay 주소를 사설 IP(`192.168.x.x`)로 광고하므로 외부 상대에게 닿지 않고 오류(701)만 남깁니다.
외부 테스트 때는 TURN 값을 비우거나, 공인 TURN(관리형 서비스 등) 값으로 바꿉니다.

```
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
```

### 3단계. 서버 실행 (터미널 1)

**HTTP 모드**로 실행합니다. HTTPS 는 터널이 담당합니다.

```bash
npm start
```

`http://localhost:3000` 로그가 나오면 정상입니다.

### 4단계. 터널 실행 (터미널 2)

```bash
cloudflared tunnel --url http://localhost:3000
```

몇 초 뒤 다음과 같은 상자가 출력됩니다.

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://random-words-1234.trycloudflare.com                                               |
+--------------------------------------------------------------------------------------------+
```

- 이 주소가 외부에 공개되는 주소입니다. **실행할 때마다 바뀝니다.**
- 처음 몇 초~수십 초는 접속이 안 될 수 있습니다. 잠시 후 새로고침하세요.
- 서버(터미널 1)와 터널(터미널 2)을 **둘 다 켜 둔 상태**여야 합니다.

### 5단계. 양쪽에서 접속

1. 두 사람 모두 `https://random-words-1234.trycloudflare.com` 접속 (인증서 경고 없음)
2. 각자 **카메라 켜기 → 접속**
3. 상단 "● 시그널링: 연결됨" 확인 — 페이지가 HTTPS 이므로 `group.js`(그룹) / `call-1to1.js`(1:1) 가 자동으로 `wss://` 사용

### 6단계. 외부망 연결 확인

폰의 **Wi-Fi 를 끄고 LTE 로** 접속해 PC 와 연결해 봅니다. 화면의 **ICE** 표시로 경로를 확인합니다.

| 표시 | 의미 |
|---|---|
| `srflx ↔ srflx · P2P (STUN 공인 주소)` | 외부망 P2P 성공 |
| `relay ↔ … · TURN 서버 경유` | TURN 으로 성공 |
| `연결 실패(ICE failed)` | STUN 만으로 안 되는 망 → 공인 TURN 필요 |

같은 터널 주소의 `/ice-test.html` 에서 srflx 후보가 나오는지도 확인할 수 있습니다.

### 7단계. 종료

터널 터미널과 서버 터미널에서 각각 **Ctrl+C**. 터널을 끄면 그 주소는 즉시 사용할 수 없게 됩니다.

## 3. 자주 생기는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `502 Bad Gateway` | 서버가 꺼져 있거나 포트가 다름 → `npm start` 가 3000 에서 도는지 확인 |
| Cloudflare `1033` 오류 | 터널이 끊김 → 4단계 다시 실행 (주소가 바뀜) |
| 터널 연결이 계속 실패 (회사망) | 기본 프로토콜(QUIC, UDP 7844)이 막혔을 수 있음 → `--protocol http2` 로 실행 (아래) |
| 페이지는 열리는데 "시그널링: 끊김" | 서버 로그·브라우저 콘솔 확인 (터널은 WebSocket 지원) |
| 서버를 HTTPS 모드로 켜 둔 경우 | `--url https://localhost:3000 --no-tls-verify` 로 실행 (HTTP 모드 권장) |
| 접속·시그널링은 되는데 ICE failed | 영상 경로가 막힘 → TURN 추가 |
| quick tunnel 이 만들어지지 않음 | 사용자 폴더의 `.cloudflared\config.yml` 이 있으면 quick tunnel 대신 그 설정을 사용하려 함 → 임시로 이름 변경 후 재시도 |

회사망 등에서 QUIC 이 막힌 경우:

```bash
cloudflared tunnel --protocol http2 --url http://localhost:3000
```

HTTPS 모드 서버에 연결하는 경우 (자체 서명 인증서 검증 생략):

```bash
cloudflared tunnel --no-tls-verify --url https://localhost:3000
```

## 4. 알아둘 점

### Quick Tunnel 의 한계

- 계정 없이 쓰는 **테스트용**입니다. 주소가 매번 바뀌고, 가용성 보장이 없습니다.
- 운영 용도로는 권장되지 않습니다.

### 고정 주소가 필요하면 (Named Tunnel)

Cloudflare 계정과 **Cloudflare 에 등록된 내 도메인**이 필요합니다. 절차 개요:

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create webrtc-study
```

```bash
cloudflared tunnel route dns webrtc-study webrtc.example.com
```

```bash
cloudflared tunnel run --url http://localhost:3000 webrtc-study
```

### 보안

- 터널 주소를 아는 사람은 **누구나 접속**할 수 있습니다.
- 이 예제는 방이 하나(최대 2명)라서, 모르는 사람이 먼저 들어오면 자리를 차지할 수 있습니다.
- 스터디 중에만 터널을 켜 두고, 주소는 상대에게만 전달하세요. 필요하면 방 비밀번호 기능을 추가합니다.

### TURN 과의 관계

- 터널은 HTTP(S)/WebSocket 만 전달하며, TURN 이 쓰는 **UDP 트래픽은 전달할 수 없습니다.**
- STUN 으로 연결되지 않는 망(회사·학교 방화벽, 일부 모바일망)을 지원하려면 공인 주소의 TURN 이 따로 필요합니다.

| TURN 방법 | 내용 |
|---|---|
| 관리형 TURN (가장 쉬움) | 무료 구간이 있는 서비스(Metered, Cloudflare 등)의 값을 `.env` 의 `TURN_URLS`, `TURN_USER`, `TURN_PASS` 에 입력 (`TURN_SECRET` 은 비움) |
| 클라우드 VM 에 coturn | `external-ip` 를 VM 공인 IP 로, 3478·49160-49200/udp 포트 개방 |
| 공유기 포트포워딩 | 3478·릴레이 포트를 이 PC 로 포워딩, `external-ip=공인IP/사설IP` (회사망이면 어려움) |

UDP 가 막힌 망을 고려하면 TURN 이 **TCP/TLS 443** 을 지원하는 것이 좋습니다.

## 5. 다른 방법과 비교

| 방법 | 공개 주소 | 인증서 경고 | 준비 | 비고 |
|---|---|---|---|---|
| 내장 HTTPS 모드 | ✘ (LAN 만) | 있음 (1회) | 없음 | 같은 공유기 안에서 사용 ([04](04-network-access.md)) |
| **cloudflared quick tunnel** | ✔ (매번 바뀜) | 없음 | cloudflared 설치 | 외부망 테스트에 가장 간단 |
| cloudflared named tunnel | ✔ (고정) | 없음 | 계정 + 도메인 | 계속 쓸 때 |
| ngrok | ✔ | 없음 | 계정 가입 | quick tunnel 과 유사 |
| 클라우드 서버 배포 | ✔ (고정) | 없음 (Let's Encrypt) | 서버 운영 | TURN 까지 함께 해결 가능 |
