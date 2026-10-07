# 04. 다른 PC 에서 접속하기

## 1. 핵심 제약: Secure Context

`getUserMedia`(카메라·마이크)는 **secure context** 에서만 동작합니다.

| 접속 주소 | secure context | 카메라 |
|---|---|---|
| `http://localhost:3000` | ✔ (예외 허용) | 사용 가능 |
| `https://...` | ✔ | 사용 가능 |
| `http://192.168.x.x:3000` | ✘ | **`navigator.mediaDevices` 자체가 `undefined`** |
| `file:///.../index.html` | - | WebSocket 주소가 잘못되어 시그널링 불가 |

IP 주소로 접속하면 연결은 되지만 카메라가 막힙니다.
이 예제는 이 경우 빨간 안내를 띄우고, **카메라 없이 수신 전용으로 접속**할 수 있게 합니다 (`recvonly` transceiver).

## 2. 경우 1 — 같은 공유기(LAN) 안의 다른 PC

1. 서버 PC 의 IP 확인: `ipconfig` → IPv4 주소
2. **방화벽**: Windows 방화벽에서 Node(포트 3000) 인바운드 허용 ("개인 네트워크")
3. **HTTPS** 해결 (택 1)

| 방법 | 방법 요약 | 장단점 |
|---|---|---|
| 터널 (cloudflared / ngrok) | `cloudflared tunnel --url http://localhost:3000` → `https://xxxx.trycloudflare.com` | 가장 쉬움, 코드 수정 없음 (`wss` 자동 선택) |
| mkcert | `mkcert 192.168.x.x localhost` 로 인증서 생성, `https.createServer` 로 변경 | 상대 PC 에 루트 CA 설치 또는 경고 무시 필요 |
| Chrome 플래그 (임시) | 상대 PC `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 에 `http://192.168.x.x:3000` 등록 | 스터디용. 브라우저 재시작 필요 |

4. 영상 경로: 같은 LAN 이면 `host ↔ host` 로 직접 연결 (STUN/TURN 불필요)

## 3. 경우 2 — 다른 네트워크(다른 공유기, LTE 등)

두 가지가 **동시에** 필요합니다.

| 필요한 것 | 이유 | 방법 |
|---|---|---|
| 시그널링 서버를 양쪽에서 접근 | 내 PC 는 사설 IP 라 외부에서 접속 불가 | 터널, 또는 공인 IP 클라우드 서버 |
| STUN | 사설 IP·mDNS 이름은 다른 망에서 해석 불가 → 공인 주소(srflx) 필요 | `.env` 의 `STUN_URLS` (기본값 사용) |
| TURN | NAT 조합·방화벽으로 STUN 만으로 안 되는 경우(약 15~20%) | 공인 IP 서버의 coturn 또는 관리형 TURN |

> 터널은 **시그널링(웹페이지·WebSocket)만** 전달합니다. 영상은 P2P(srflx) 또는 TURN 으로 따로 흐릅니다.

> 로컬 Docker coturn 은 relay 주소를 사설 IP(`192.168.x.x`)로 광고하므로 **같은 LAN 안에서만** 쓸 수 있습니다.

## 4. 단계별 확인 순서

1. 같은 PC 에서 탭 2개 → `host ↔ host`
2. 같은 와이파이의 다른 PC/폰 (터널 HTTPS) → `host ↔ host`
3. 폰을 LTE 로 전환 → `srflx` 경로 (STUN)
4. 연결 실패(`failed`) 시 TURN 추가, `chrome://webrtc-internals` 에서 후보 쌍 확인
