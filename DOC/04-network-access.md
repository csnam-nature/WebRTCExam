# 04. 다른 PC 에서 접속하기

## 1. 핵심 제약: Secure Context

`getUserMedia`(카메라·마이크)는 **secure context** 에서만 동작합니다.

| 접속 주소 | secure context | 카메라 |
|---|---|---|
| `http://localhost:3000` | ✔ (예외 허용) | 사용 가능 |
| `https://...` | ✔ | 사용 가능 |
| `http://192.168.x.x:3000` | ✘ | **`navigator.mediaDevices` 자체가 `undefined`** |
| `https://192.168.x.x:3000` (HTTPS 모드, 자체 서명) | ✔ | 첫 접속 시 인증서 경고를 넘기면 사용 가능 (실제 검증 완료) |
| `file:///.../index.html` | - | WebSocket 주소가 잘못되어 시그널링 불가 |

IP 주소로 접속하면 연결은 되지만 카메라가 막힙니다.
이 예제는 이 경우 빨간 안내를 띄우고, **카메라 없이 수신 전용으로 접속**할 수 있게 합니다 (`recvonly` transceiver).

## 2. 경우 1 — 같은 공유기(LAN) 안의 다른 PC

1. 서버 PC 의 IP 확인: `ipconfig` → IPv4 주소
2. **방화벽**: Windows 방화벽에서 Node(포트 3000) 인바운드 허용 ("개인 네트워크")
3. **HTTPS** 해결 (택 1)

| 방법 | 방법 요약 | 장단점 |
|---|---|---|
| **내장 HTTPS 모드 (권장)** | 서버 PC 에서 `npm run start:https` → 다른 PC 에서 `https://192.168.x.x:3000` | 설치 없음. 자체 서명 인증서 경고를 한 번 넘겨야 함 |
| 터널 (cloudflared / ngrok) | `cloudflared tunnel --url http://localhost:3000` → `https://xxxx.trycloudflare.com` | 경고 없음, 코드 수정 없음 (`wss` 자동 선택). 별도 프로그램 필요 |
| mkcert | `mkcert 192.168.x.x localhost` 로 인증서 생성 → `.env` 에 `TLS_CERT`, `TLS_KEY` 지정 후 `npm run start:https` | 상대 PC 에 mkcert 루트 CA 를 설치하면 경고 없음 |
| Chrome 플래그 (임시) | 상대 PC `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 에 `http://192.168.x.x:3000` 등록 | 스터디용. 브라우저 재시작 필요 |

4. 영상 경로: 같은 LAN 이면 `host ↔ host` 로 직접 연결 (STUN/TURN 불필요)

### 내장 HTTPS 모드 상세

```bash
npm run start:https          # 또는 .env 에 HTTPS=1 후 npm start
```

- 실행하면 접속 가능한 주소가 출력됩니다: `https://192.168.x.x:3000   ← 다른 PC 에서 접속`
- 인증서 선택 순서
  1. `.env` 의 `TLS_CERT` / `TLS_KEY` (mkcert 등)
  2. 없으면 `cert/selfsigned.crt`, `cert/selfsigned.key` 를 **자동 생성**
     (SAN: `localhost`, `127.0.0.1`, 이 PC 의 모든 LAN IPv4, 유효기간 1년, `selfsigned` 패키지 사용)
- 다음 실행부터는 같은 인증서를 **재사용**합니다. 브라우저에서 승인한 예외가 유지되도록 하기 위해서입니다.
  IP 가 바뀌었거나 만료가 1일 이내로 다가오면 다시 만듭니다.
- `cert/` 에는 개인키가 들어 있으므로 git 에서 제외합니다 (`.gitignore`).
- 브라우저 경고("연결이 비공개로 설정되어 있지 않습니다") → **[고급] → [192.168.x.x(안전하지 않음)(으)로 이동]**
- HTTPS 페이지에서는 시그널링도 자동으로 `wss://` 를 사용합니다.

> `http` 로 실행 중인 서버에 `https://` 로 접속하면 `ERR_SSL_PROTOCOL_ERROR` 가 납니다.
> 반대로 HTTPS 모드 서버에는 `http://` 로 접속할 수 없습니다.

#### 인증서 경고 (`NET::ERR_CERT_AUTHORITY_INVALID`)

- 자체 서명 인증서는 브라우저가 신뢰하는 인증기관(CA) 목록에 없어서 경고가 뜹니다. **예상된 동작**입니다.
- 연결은 암호화됩니다. 경고는 "상대가 진짜 그 서버인지 확인할 수 없다"는 뜻입니다.
- 접속하는 PC·브라우저마다 한 번 넘기면, 서버가 같은 인증서를 재사용하므로 보통 다시 묻지 않습니다.
  (브라우저를 완전히 껐다 켜면 다시 물을 수 있음)
- 경고를 넘긴 HTTPS 페이지에서 카메라·`wss://` 시그널링이 정상 동작하고, **다른 PC 와 영상 연결이 되는 것을 실제로 확인**했습니다.

#### 경고를 없애려면 (선택)

| 방법 | 내용 | 주의 |
|---|---|---|
| mkcert / 로컬 CA | 로컬 인증기관으로 서버 인증서 발급 → 각 PC 에 CA 인증서를 "신뢰할 수 있는 루트 인증 기관"으로 설치 → `.env` 에 `TLS_CERT`, `TLS_KEY` | CA 를 설치한 PC 는 그 CA 가 서명한 모든 인증서를 신뢰. CA 개인키 관리, 실습 후 CA 제거 권장 |
| cloudflared 터널 | 정식 인증서가 붙은 `https://xxxx.trycloudflare.com` | 별도 프로그램, 외부 경유 |

## 3. 경우 2 — 다른 네트워크(다른 공유기, LTE 등)

두 가지가 **동시에** 필요합니다.

| 필요한 것 | 이유 | 방법 |
|---|---|---|
| 시그널링 서버를 양쪽에서 접근 | 내 PC 는 사설 IP 라 외부에서 접속 불가 | 터널, 또는 공인 IP 클라우드 서버 |
| STUN | 사설 IP·mDNS 이름은 다른 망에서 해석 불가 → 공인 주소(srflx) 필요 | `.env` 의 `STUN_URLS` (기본값 사용) |
| TURN | NAT 조합·방화벽으로 STUN 만으로 안 되는 경우(약 15~20%) | 공인 IP 서버의 coturn 또는 관리형 TURN |

> 터널은 **시그널링(웹페이지·WebSocket)만** 전달합니다. 영상은 P2P(srflx) 또는 TURN 으로 따로 흐릅니다.
> 터널 사용법은 [07-cloudflared-tunnel.md](07-cloudflared-tunnel.md) 참고.

> 로컬 Docker coturn 은 relay 주소를 사설 IP(`192.168.x.x`)로 광고하므로 **같은 LAN 안에서만** 쓸 수 있습니다.

## 4. 단계별 확인 순서

1. 같은 PC 에서 탭 2개 (`npm start`, `http://localhost:3000`) → `host ↔ host`
2. 같은 와이파이의 다른 PC/폰 (`npm run start:https`, `https://<서버 IP>:3000`) → `host ↔ host` ✔ 검증 완료
3. 폰을 LTE 로 전환 → `srflx` 경로 (STUN)
4. 연결 실패(`failed`) 시 TURN 추가, `chrome://webrtc-internals` 에서 후보 쌍 확인
