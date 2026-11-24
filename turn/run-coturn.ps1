# coturn(TURN 서버)을 Docker 로 실행한다. Docker Desktop 이 켜져 있어야 한다.
#   사용: npm run turn
#         powershell -File turn/run-coturn.ps1 -ExternalIp 192.168.5.31
# 주의: Windows PowerShell 5.1 은 BOM 없는 UTF-8 을 한글 깨짐으로 읽으므로 이 파일은 UTF-8(BOM) 으로 저장한다.
param([string]$ExternalIp)

# docker 는 정상 진행 메시지도 stderr 로 쓰므로 Stop 을 쓰지 않고 종료 코드로 판단한다.
$ErrorActionPreference = 'Continue'

if (-not $ExternalIp) {
  # 기본 게이트웨이로 나가는 인터페이스의 IP 를 사용한다 (VPN/가상 어댑터를 피하기 위함)
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
  $ExternalIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex | Select-Object -First 1).IPAddress
}
Write-Host "external-ip: $ExternalIp  (다르면 -ExternalIp 로 지정)"

# 비밀키는 .env 의 TURN_SECRET 을 사용한다 (Node 서버와 같은 값을 쓰게 되고, git 에는 올라가지 않는다)
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$secret = ''
if (Test-Path $envFile) {
  $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*TURN_SECRET\s*=' } | Select-Object -Last 1
  if ($line) { $secret = ($line -replace '^\s*TURN_SECRET\s*=', '').Trim().Trim('"', "'") }
}
if (-not $secret) {
  Write-Host '.env 에 TURN_SECRET 이 없습니다. 아래 명령으로 무작위 값을 만들어 .env 에 넣은 뒤 다시 실행하세요.'
  Write-Host '  node -e "console.log(require(''crypto'').randomBytes(32).toString(''hex''))"'
  exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker 가 실행 중이 아닙니다. Docker Desktop 을 먼저 켜 주세요.'; exit 1 }

if (docker ps -aq --filter 'name=^webrtc-coturn$') {
  Write-Host '기존 webrtc-coturn 컨테이너를 교체합니다.'
  docker rm -f webrtc-coturn *> $null
}

$conf = Join-Path $PSScriptRoot 'turnserver.conf'
docker run -d --name webrtc-coturn `
  -p 3478:3478/udp -p 3478:3478/tcp `
  -p 49160-49200:49160-49200/udp `
  -v "${conf}:/etc/coturn/turnserver.conf:ro" `
  coturn/coturn -c /etc/coturn/turnserver.conf "--static-auth-secret=$secret" "--external-ip=$ExternalIp" 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host 'coturn 실행 실패'; exit 1 }

Write-Host ''
Write-Host 'coturn 실행됨. .env 에 다음을 설정하고 npm start 를 다시 실행하세요:'
Write-Host "  TURN_URLS=turn:${ExternalIp}:3478?transport=udp,turn:${ExternalIp}:3478?transport=tcp"
Write-Host '  (TURN_SECRET 은 .env 의 값을 그대로 사용 중입니다)'
Write-Host ''
Write-Host '로그 보기: docker logs -f webrtc-coturn   /  중지: docker rm -f webrtc-coturn'
