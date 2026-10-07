# 03. STUN / TURN

## 1. 왜 필요한가 — NAT

대부분의 PC·폰은 공유기(NAT) 뒤에서 `192.168.x.x` 같은 **사설 IP** 만 가집니다.
상대는 이 주소로 나에게 직접 접근할 수 없으므로,

- **STUN**: "밖에서 보이는 내 주소"를 알아내고
- **TURN**: 그래도 안 되면 서버가 미디어를 대신 **중계**합니다.

```
[PC A 192.168.0.10] ─ NAT(공인 a.a.a.a) ─┐                ┌─ NAT(공인 b.b.b.b) ─ [PC B 10.0.0.5]
                                       인터넷 ── STUN 서버 ──┤
                                         └──── TURN 서버 ────┘
```

## 2. STUN vs TURN

| | STUN | TURN |
|---|---|---|
| 역할 | 공인 IP:포트 조회 (요청 1회) | 미디어 트래픽 **중계** |
| 결과 후보 | `srflx` | `relay` |
| 비용 | 거의 없음 | 서버 대역폭 소모 큼 (영상 전체가 서버 경유) |
| 성공률 | 대부분의 가정용 NAT (약 80~85%) | 거의 100% (최후 수단) |
| 실패 사례 | Symmetric NAT, 기업/학교 방화벽, 일부 LTE | 거의 없음 |
| 서버 | 무료 공개 서버 사용 가능 | 인증 필요 → 직접 운영 또는 유료 서비스 |
| 포트 | 3478/udp | 3478/udp·tcp, 5349/tls, 릴레이용 UDP 범위 |

ICE 는 우선순위 `host > srflx > relay` 로 시도하므로,
같은 LAN 이면 host, 다른 망이면 srflx, 그것도 안 되면 relay 로 **자동 전환**됩니다.

## 3. 이 예제의 STUN/TURN 구성

### 3.1 서버가 ICE 설정을 발급 (`GET /ice-config`)

브라우저 코드에 TURN 비밀번호를 하드코딩하지 않기 위해, 서버가 접속 시점마다 설정을 내려줍니다.

```json
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302"] },
    {
      "urls": ["turn:192.168.x.x:3478?transport=udp", "turn:192.168.x.x:3478?transport=tcp"],
      "username": "1791365211:study",
      "credential": "base64-HMAC-SHA1..."
    }
  ]
}
```

### 3.2 시간제한 자격증명 (coturn `use-auth-secret`)

coturn 과 Node 서버가 **같은 비밀키(secret)** 를 공유하고, Node 서버가 임시 계정을 계산해 줍니다.

```
username   = <만료시각(unix 초)>:<임의 이름>
credential = base64( HMAC-SHA1(secret, username) )
```

```js
const username = `${Math.floor(Date.now() / 1000) + TURN_TTL}:study`;
const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
```

- coturn 은 같은 계산으로 검증하고, 만료시각이 지나면 거부합니다 (기본 1시간).
- 비밀키는 브라우저에 노출되지 않습니다. 유출되더라도 임시 계정은 곧 만료됩니다.
- 상대가 나갔다가 다시 들어오는 경우를 위해 `resetPeer()` 에서 설정을 다시 받습니다.

### 3.3 relay 강제 (`iceTransportPolicy: 'relay'`)

같은 PC/LAN 에서는 host 로 바로 연결되어 TURN 이 쓰이지 않습니다.
TURN 동작을 확인하려면 **TURN만 사용** 체크박스로 relay 후보만 쓰게 강제합니다.

```js
new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
```

한쪽만 relay 로 강제해도 그 쪽의 후보가 relay 뿐이므로 경로는 TURN 을 거칩니다.

## 4. coturn (TURN 서버) — Docker

### 4.1 실행

```bash
npm run turn          # = powershell -File turn/run-coturn.ps1
```

스크립트가 하는 일:

1. 기본 게이트웨이 인터페이스의 IPv4 를 찾아 `external-ip` 로 사용 (VPN/가상 어댑터 회피)
2. 기존 `webrtc-coturn` 컨테이너가 있으면 교체
3. 포트 매핑 후 `coturn/coturn` 실행

```powershell
docker run -d --name webrtc-coturn `
  -p 3478:3478/udp -p 3478:3478/tcp `
  -p 49160-49200:49160-49200/udp `
  -v "<경로>\turnserver.conf:/etc/coturn/turnserver.conf:ro" `
  coturn/coturn -c /etc/coturn/turnserver.conf --external-ip=<PC IP>
```

| 명령 | 용도 |
|---|---|
| `docker logs -f webrtc-coturn` | 로그 보기 (ALLOCATE, CREATE_PERMISSION, CHANNEL_BIND 성공 여부) |
| `docker rm -f webrtc-coturn` | 중지·삭제 |

### 4.2 `turnserver.conf` 핵심 설정

| 설정 | 값 | 이유 |
|---|---|---|
| `listening-port` | `3478` | STUN/TURN 기본 포트 |
| `fingerprint` | - | STUN 메시지 무결성 지문 (브라우저 호환) |
| `use-auth-secret` / `static-auth-secret` | `change-me-study-secret` | 시간제한 자격증명. `.env` 의 `TURN_SECRET` 과 일치해야 함 |
| `realm` | `webrtc.study` | 인증 영역 이름 |
| `min-port` / `max-port` | `49160` / `49200` | 릴레이 포트 범위. Docker Desktop(Windows)은 host 네트워크가 없어 포트를 매핑해야 하므로 좁게 |
| `no-tls` | - | 로컬 실습이라 `turns:`(5349) 미사용 |
| `--external-ip` | PC 의 LAN IP | **필수.** 없으면 relay 주소가 컨테이너 내부 IP(172.17.x.x)로 광고되어 연결 불가 |

> coturn 4.18 기준: `no-dtls` 는 없어진 옵션, `no-cli` 는 deprecated(관리 CLI 는 `--cli` 를 줄 때만 켜짐)라서 설정에서 제외했습니다.

### 4.3 운영 시 주의 (공개 서버)

- 공인 IP 가 있는 서버(클라우드 VM)에 올려야 다른 네트워크에서 사용할 수 있습니다.
- `static-auth-secret` 을 긴 무작위 값으로 바꿉니다.
- TLS(`turns:` 5349)를 켜면 TCP/443 만 허용하는 방화벽도 통과하기 쉽습니다.
- **사설망으로의 중계를 차단**합니다 (내부망 공격 경로 방지):
  ```
  denied-peer-ip=10.0.0.0-10.255.255.255
  denied-peer-ip=172.16.0.0-172.31.255.255
  denied-peer-ip=192.168.0.0-192.168.255.255
  ```
- 대안: Metered, Twilio, Cloudflare 등 관리형 TURN → `.env` 에 `TURN_URLS`, `TURN_USER`, `TURN_PASS` 입력 (`TURN_SECRET` 은 비움)

## 5. 오류 코드 (`icecandidateerror`)

| 코드 | 의미 | 확인할 것 |
|---|---|---|
| 701 | 서버에 닿지 못함 | 주소/포트 오타, 서버 꺼짐, 방화벽. `STUN host lookup received error` 한 줄은 IPv6 조회 실패로, srflx 가 나오면 무시 가능 |
| 401 | TURN 인증 실패 | `TURN_SECRET` ≠ `static-auth-secret`, 자격증명 만료, 비밀번호 오타 |
| 403 | 거부됨 | `denied-peer-ip` 등 서버 정책 |
| 486 | 할당 한도 초과 | 사용자/서버 할당량 |
| (오류 없이 시간 초과) | UDP 무응답 | TURN 서버가 꺼져 있거나 UDP 3478 이 막힘 |

## 6. 결과 해석 (ICE 테스트 페이지)

| 수집 결과 | 판정 |
|---|---|
| host 만 | ICE 서버 없음 또는 STUN/TURN 모두 실패. 같은 네트워크에서만 연결 가능 |
| host + srflx | STUN 정상 |
| relay 포함 | TURN 서버 접속·인증 정상 |
| relay 강제 + relay 0개 | TURN 설정/서버 문제 → 오류 코드 확인 |

로컬 coturn 사용 시 `srflx 172.17.0.1:xxxxx` 후보가 추가로 보일 수 있습니다.
TURN 서버도 STUN 기능을 하기 때문에 생기는 후보로, Docker 내부 게이트웨이 주소입니다. 동작에는 영향이 없습니다.
