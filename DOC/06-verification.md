# 06. 검증 방법과 결과

검증은 Chrome 계열 브라우저 탭 2개로 진행했습니다.
자동 검증 환경에는 카메라가 없어 `getUserMedia` 를 **canvas 영상(`canvas.captureStream`)으로 대체**했습니다.
실제 카메라로 다른 PC 와 연결하는 것은 사용자 환경에서 확인했습니다 (5.2 참고).

## 1. 단계 1~2: 카메라 + loopback (`loopback.html`)

| 항목 | 결과 |
|---|---|
| 카메라 켜기 → 연결 시작 → 종료 | 오류 없이 동작 |
| `pc1`, `pc2` 상태 | 모두 `connected` |
| 원격 영상 | 640×360 재생 |
| ICE 후보 | `host`(udp)만 — STUN/TURN 없는 상태에서 예상대로 |
| 종료 | 버튼·상태 초기화, 원격 영상 해제 |

## 2. 단계 3~5: 두 탭 통화 (당시 `index.html`, 현재 `call-1to1.html`)

> 그룹 통화(4명) 검증 결과는 [08-group-call.md](08-group-call.md) 5절 참고.

| 항목 | 결과 |
|---|---|
| 두 탭 연결 | 양쪽 `connected`, 원격 영상 640×360 |
| 역할 | 먼저 접속한 탭 caller, 나중 탭 callee |
| candidate 큐 | callee 에서 "큐에 보관" 실제 발생 → 정상 연결 |
| 상대 종료 | 남은 탭에 "상대가 나갔습니다" → 대기 상태 복귀 |
| 재접속 | 같은 탭이 다시 접속해 재연결 성공 |
| 세 번째 접속 | `{"type":"full"}` 수신 후 종료 |
| 음소거 | 버튼 라벨 토글 확인 (소리 자체는 미확인) |

## 3. 접속 오류 처리

| 항목 | 결과 |
|---|---|
| `http://<LAN IP>:3000` 접속 | `isSecureContext=false`, `mediaDevices=undefined` 재현 → 빨간 안내 표시 |
| 카메라 없이 접속 | [접속] 활성 → 대기 → localhost 탭과 연결, 원격 영상 640×360 수신 |

## 4. 단계 6: STUN/TURN

### 4.1 ICE 테스트 페이지 (`ice-test.html`)

| 시나리오 | 수집 결과 | 판정 |
|---|---|---|
| STUN 만 | host 1 · srflx 1 | ✔ STUN 정상 |
| TURN 없이 relay 강제 | 후보 0 | ✘ relay 강제인데 TURN 없음 |
| 꺼진 TURN 서버 | 후보 0, 오류 없이 10초 시간 초과 | ✘ 서버 무응답 |
| STUN + 로컬 coturn | host 1 · srflx 2 · relay 2 | ✔ STUN·TURN 정상 |
| relay 강제 + coturn | relay 2 (udp·tcp 경로) | ✔ TURN 후보만 수집 |
| 잘못된 TURN 비밀번호 | `401 Unauthorized` (udp, tcp) | ✘ TURN 인증 실패 |

relay 후보 주소가 PC 의 LAN IP(`192.168.x.x:491xx`)로 나와 `external-ip` 설정이 적용됨을 확인했습니다.

### 4.2 relay 강제 두 탭 통화

| 항목 | 결과 |
|---|---|
| 연결 상태 | 양쪽 `connected` |
| 선택된 후보 쌍 | `relay ↔ relay` → **TURN 서버 경유** (`[TURN udp]`) |
| 영상 수신 | 한쪽 329 프레임 디코딩(약 600KB), 다른 쪽 80 프레임(약 174KB, 측정 시점 차이) |
| coturn 로그 | 시간제한 자격증명 사용자(`<만료시각>:study`)로 `CREATE_PERMISSION`, `CHANNEL_BIND` 성공 |

### 4.3 서버 설정

| 항목 | 결과 |
|---|---|
| `/ice-config` (TURN_SECRET 설정) | `username: "<만료시각>:study"`, base64 credential 발급 |
| `STUN_URLS=` (빈 값) | STUN 비활성 확인 |
| `--env-file-if-exists` | `.env` 없을 때도 정상 기동 |
| `.env` git 제외 | `git check-ignore` 로 확인 |

## 5. HTTPS 모드 (다른 PC 접속)

### 5.1 서버 동작

| 항목 | 결과 |
|---|---|
| `npm run start:https` | HTTPS 로 기동, 접속 가능한 `https://<IP>:PORT` 주소 출력 |
| HTTPS 응답 | `/` 200, `/ice-config` 정상 |
| 자체 서명 인증서 | SAN: `localhost`, `127.0.0.1`, 이 PC 의 모든 LAN IPv4. 유효기간 1년 |
| 재시작 | `cert/selfsigned.crt (재사용)` — 같은 인증서 유지 |
| WSS 시그널링 | 두 클라이언트가 `wss://` 로 접속해 `joined`, `ready` 수신 |
| `cert/` git 제외 | `git check-ignore` 로 확인 |
| 기존 HTTP 모드 | `npm start` 정상 (회귀 없음) |

### 5.2 사용자 환경 (실제 카메라)

| 항목 | 결과 |
|---|---|
| 첫 접속 | `NET::ERR_CERT_AUTHORITY_INVALID` 경고 (자체 서명 인증서라 예상된 동작) |
| [고급] → [이동] 후 | 페이지 접속, 카메라 사용 가능 |
| **다른 PC 와 영상 연결** | **성공** (같은 LAN, 실제 카메라) |

## 6. 직접 확인하는 방법

### 6.1 브라우저 도구

- `chrome://webrtc-internals` → `candidate-pair` 중 `state: succeeded`, `nominated: true` 인 쌍이 실제 경로
- DevTools 콘솔 → loopback 페이지의 전체 SDP

### 6.2 coturn

```bash
docker logs -f webrtc-coturn
```

`ALLOCATE processed, success` → `CREATE_PERMISSION` → `CHANNEL_BIND` 순으로 성공 로그가 나오면 중계 정상입니다.
`401` 은 인증 실패입니다.

## 7. 미검증 항목

- 소리(마이크 음성) 전달
- 다른 네트워크 간 연결 (srflx 경로, 공인 TURN 서버)
- HTTPS 터널(cloudflared) 경유 접속
- 로컬 CA 방식으로 인증서 경고 제거
