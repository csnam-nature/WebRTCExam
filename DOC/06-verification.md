# 06. 검증 방법과 결과

검증은 Chrome 계열 브라우저 탭 2개로 진행했습니다.
검증 환경에 카메라가 없어 `getUserMedia` 를 **canvas 영상(`canvas.captureStream`)으로 대체**했습니다.
실제 카메라·마이크(소리 포함)는 사용자 환경에서 별도로 확인이 필요합니다.

## 1. 단계 1~2: 카메라 + loopback (`loopback.html`)

| 항목 | 결과 |
|---|---|
| 카메라 켜기 → 연결 시작 → 종료 | 오류 없이 동작 |
| `pc1`, `pc2` 상태 | 모두 `connected` |
| 원격 영상 | 640×360 재생 |
| ICE 후보 | `host`(udp)만 — STUN/TURN 없는 상태에서 예상대로 |
| 종료 | 버튼·상태 초기화, 원격 영상 해제 |

## 2. 단계 3~5: 두 탭 통화 (`index.html`)

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

## 5. 직접 확인하는 방법

### 5.1 브라우저 도구

- `chrome://webrtc-internals` → `candidate-pair` 중 `state: succeeded`, `nominated: true` 인 쌍이 실제 경로
- DevTools 콘솔 → loopback 페이지의 전체 SDP

### 5.2 coturn

```bash
docker logs -f webrtc-coturn
```

`ALLOCATE processed, success` → `CREATE_PERMISSION` → `CHANNEL_BIND` 순으로 성공 로그가 나오면 중계 정상입니다.
`401` 은 인증 실패입니다.

## 6. 미검증 항목

- 실제 카메라·마이크 영상과 소리
- 다른 PC (같은 LAN) 접속 — Windows 방화벽 허용 여부
- 다른 네트워크 간 연결 (srflx 경로, 공인 TURN 서버)
- HTTPS 터널(cloudflared) 경유 접속
