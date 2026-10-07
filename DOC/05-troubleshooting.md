# 05. 문제 해결 기록

실습 중 실제로 겪은 문제와 원인·해결을 정리했습니다.

## 1. WebRTC 동작 관련

### 1.1 candidate 가 offer/answer 보다 먼저 도착

- **증상**: `addIceCandidate` 실패 (`remoteDescription` 없음)
- **원인**: Trickle ICE 에서 상대 후보가 SDP 처리보다 먼저 올 수 있음. 실제로 callee 쪽에서 매번 발생
- **해결**: `remoteDescription` 이 없으면 큐(`pendingCandidates`)에 보관 → `setRemoteDescription` 직후 `flushCandidates()`
- 로그: `(candidate 큐에 보관: remoteDescription 아직 없음)`

### 1.2 후보 주소가 `xxxx.local` 로 보임

- **원인**: 브라우저가 사설 IP 노출을 막기 위해 host 후보를 mDNS 이름으로 가림 (정상)
- `getStats()` 의 후보 `address` 도 비어 있어 `(주소 숨김: mDNS)` 로 표시

### 1.3 후보 쌍이 `host ↔ prflx` 로 표시됨

- **원인**: 상대의 mDNS 후보를 해석하기 전에 연결 검사 패킷으로 상대 주소를 먼저 알게 된 경우 (peer reflexive). 정상

### 1.4 통화 화면에서 STUN 을 켰는데 srflx 가 안 나옴

- **증상**: ICE 테스트 페이지에서는 srflx 가 나오는데, 같은 PC 두 탭 통화에서는 host 만 수집
- **원인**: 같은 PC/LAN 에서는 host 연결이 수 ms 만에 성공해 **STUN 응답(~90ms)이 오기 전에 수집이 끝남**
- **실험**: loopback 에서 원격 후보 전달 지연 0ms → 13~15ms 에 수집 종료(srflx 없음), 300ms 지연 → srflx 수집됨
- **결론**: 정상 동작. 다른 네트워크에서는 host 연결이 안 되므로 srflx 가 수집됨. STUN 확인은 ICE 테스트 페이지에서

### 1.5 `701 STUN host lookup received error`

- STUN 서버 이름 조회 중 일부(IPv6 등) 실패. 같은 시도에서 srflx 를 얻었다면 무시 가능

## 2. 접속·환경 관련

### 2.1 다른 PC 에서 [접속] 버튼을 눌러도 반응이 없음

- **증상**: `http://192.168.x.x:3000` 으로 접속 → [카메라 켜기] 실패, [접속] 버튼 비활성
- **원인**: secure context 가 아니어서 `navigator.mediaDevices` 가 `undefined`. 로그에는 `TypeError: Cannot read properties of undefined (reading 'getUserMedia')` 만 남음
- **해결 (코드)**
  - 원인을 화면 빨간 박스(`#error`)로 안내
  - 카메라 없이도 접속 가능(수신 전용, `addTransceiver(..., { direction: 'recvonly' })`)
  - 시그널링 서버 연결 실패, `file://` 로 연 경우도 안내
- **해결 (환경)**: HTTPS 로 접속 → [04-network-access.md](04-network-access.md)

### 2.1-1 `https://IP:3000` 으로 접속하면 `ERR_SSL_PROTOCOL_ERROR`

- **증상**: "사이트에 보안 연결할 수 없음 — 192.168.x.x에서 잘못된 응답을 전송했습니다"
- **원인**: 서버가 HTTP 로 실행 중인데 브라우저는 TLS 로 접속 → 서버가 평문으로 응답
- **해결**: 서버에 HTTPS 모드 추가 → `npm run start:https` 로 실행 후 `https://IP:3000` 접속.
  자체 서명 인증서 경고는 [고급] → [계속 진행]

### 2.2 같은 PC 에서 탭 2개로 카메라를 열 수 없음

- **증상**: `NotReadableError`
- **원인**: 장치/드라이버에 따라 카메라를 한 프로세스만 점유
- **해결**: Chrome 과 Edge 로 나눠 열기, 다른 프로필 사용, 한쪽은 카메라 없이 수신 전용 접속

## 3. TURN / Docker 관련

### 3.1 Docker Desktop 시작 시 "An unexpected error occurred"

- **메시지**: `initializing Inference manager: listening on unix://.../Docker/run/dockerInference: remove ...: The file cannot be accessed by the system.`
- **원인**: 이전 실행에서 남은 소켓 파일(0바이트, ReparsePoint)을 Docker 가 지우지 못함
- **해결**
  1. 오류창에서 Quit
  2. `Rename-Item "$env:LOCALAPPDATA\Docker\run" run.stale-YYYYMMDD` (삭제 대신 이름 변경 → 되돌리기 가능). 사용 중 오류면 재부팅 후 실행
  3. Docker Desktop 재시작
  4. 재발 방지: Settings → AI → Docker Model Runner 끄기

### 3.2 `npm run turn` 이 첫 실행에서 멈춤

- **증상**: `docker : Error response from daemon: No such container: webrtc-coturn` 에서 중단
- **원인**: Windows PowerShell 5.1 에서 `$ErrorActionPreference = 'Stop'` 이면 네이티브 명령의 **stderr 출력**(정상 메시지 포함)이 치명적 오류가 됨
- **해결**: `Continue` 로 두고 `$LASTEXITCODE` 로 성공 여부 판단. 컨테이너 존재 여부를 먼저 확인한 뒤 삭제

### 3.3 PowerShell 스크립트 한글 깨짐

- **원인**: Windows PowerShell 5.1 은 BOM 없는 UTF-8 `.ps1` 을 시스템 코드페이지(CP949)로 읽음
- **해결**: `run-coturn.ps1` 을 **UTF-8 (BOM)** 으로 저장

### 3.4 coturn 설정 경고 `Bad configuration format: no-dtls`

- **원인**: coturn 4.18 에서 `no-dtls` 옵션이 없어짐, `no-cli` 는 deprecated
- **해결**: 두 옵션 제거

### 3.5 relay 주소가 172.17.x.x 로 나와 연결 안 됨 (예방)

- **원인**: Docker 컨테이너 내부 IP 를 광고
- **해결**: `--external-ip=<PC IP>` (스크립트가 자동 지정)

## 4. 자주 막히는 지점 체크리스트

- [ ] `addTrack` 을 `createOffer` 전에 했는가
- [ ] callee 도 offer 를 받기 전에 pc 와 트랙을 준비했는가
- [ ] remoteDescription 이전 candidate 를 큐 처리하는가
- [ ] 로컬 `<video>` 에 `muted`, 모두에 `autoplay playsinline` 을 줬는가
- [ ] `localhost` 또는 `https` 로 접속했는가
- [ ] 다른 PC 라면 방화벽이 3000 포트를 허용하는가
- [ ] 다른 네트워크라면 STUN/TURN 과 외부에서 접근 가능한 시그널링 주소가 있는가
- [ ] TURN 이라면 `TURN_SECRET` 과 `static-auth-secret` 이 같은가, `external-ip` 가 맞는가
