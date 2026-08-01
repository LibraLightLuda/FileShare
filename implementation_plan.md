# 정적 P2P 파일 공유 서비스 구현 계획 (서버리스)

본 문서는 일체의 외부 백엔드 없이 오직 **GitHub Pages**에 정적 웹 애플리케이션으로 배포되어 동작하는 수동 시그널링 기반 WebRTC 파일 공유 서비스의 구현 계획입니다.

## 아키텍처 및 기술 스택

- **프런트엔드**: React, TypeScript, Vite, Vanilla CSS
- **배포 환경**: GitHub Pages (정적 웹 호스팅)
- **라우팅**: 상태 머신 기반 UI 전환 (명시적 단계 전환, 필요시에만 라우팅 도입)
- **P2P 연결**: WebRTC `RTCPeerConnection`, `RTCDataChannel`
- **시그널링 방식**: 사용자가 직접 Offer/Answer 패키지를 교환 (문자열 복사/붙여넣기, 파일 입출력, QR 코드 스캔 선택적 사용)

## 시스템 설계

### 수동 시그널링 절차
Trickle ICE를 사용하지 않고, ICE Gathering이 완료(complete)될 때까지 대기한 뒤 모든 Candidate가 포함된 SDP를 하나의 패키지로 만듭니다.

1. **A (Initiator)**: '연결 만들기' 클릭 -> `RTCPeerConnection`, `RTCDataChannel` 생성 -> SDP Offer 생성.
2. **A**: ICE Gathering 완료 대기 (최대 10초 타임아웃, 타임아웃/실패 시 에러 표시) 후 Offer 패키지 생성.
3. **A**: Offer 패키지를 UI(문자열, 파일 저장)에 표시. (패키지 용량에 따라 QR코드 생성 선택적 지원)
4. **B (Responder)**: '상대방 연결 정보 가져오기' 클릭 -> Offer 패키지 입력.
5. **B**: Offer 패키지 디코딩 및 만료(createdAt), 타입(offer) 검증 -> `setRemoteDescription` 적용 -> SDP Answer 생성.
6. **B**: ICE Gathering 완료 대기 후 Answer 패키지 생성 및 UI 표시.
7. **A**: B의 Answer 패키지를 입력받아 타입(answer), sessionId 일치 여부 검증 후 `setRemoteDescription` 적용.
8. **연결 완료**: `RTCDataChannel` 오픈 및 파일 전송 화면 전환.

### 시그널링 패키지 구조
```typescript
interface SignalingPackage {
  version: 1;
  type: "offer" | "answer";
  sessionId: string;
  createdAt: number;
  description: RTCSessionDescriptionInit;
  encoding: "pako" | "compression-stream" | "none";
}
```
* **인코딩/압축**: JSON.stringify -> `CompressionStream` 시도 후 실패 시 `pako` 폴백 -> Base64 URL-safe.

### ICE 서버 정책
기본적으로 외부 서버가 없는 완전 무외부 서비스 모드로 구성합니다.
```typescript
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [];
```
* `IceServerSettings` 설정 구조를 마련하지만 초기엔 비워두고, TURN 미설정 시 외부 네트워크 연결이 안 될 수 있음을 명확히 안내합니다.

### 파일 전송 프로토콜 (DataChannel)
- 양방향 전송 지원, 한 방향당 활성 전송은 **단 1개**(나머지는 순차 대기열 처리).
- **Chunk 크기**: `RTCPeerConnection.sctp.maxMessageSize` 우선 참조, 알 수 없으면 **16KB** 보수적 기본값 사용.
- **백프레셔**: `bufferedAmountLowThreshold`와 `bufferedAmount`를 활용.
- **바이너리 헤더**: 
  - `protocolVersion` (1 byte, uint8)
  - `transferId` (16 bytes)
  - `chunkIndex` (4 bytes, uint32, Little Endian)
  - `payloadLength` (4 bytes, uint32, Little Endian)
  - 헤더 총 25 bytes.
- **검증**: 수신 완료 후 파일 크기 및 청크 순서 확인, 수신 측이 `FILE_VERIFIED` 또는 `FILE_VERIFY_FAIL` 전송.
- **완료 확정**: 송신 측은 `FILE_VERIFIED` 응답을 받았을 때 비로소 완료(Completed)로 상태를 확정.
- **용량 제한**: Blob 조립 방식 기반으로 설정상 최대 250MB로 유지하되, 메모리 한계 가능성을 안내(README에 테스트 결과 기재).

## 구현 단계

### Phase 1: 기반 설정 및 패키징 모듈
1. 프로젝트 폴더 최상단 Vite React 초기화, 상태 기반 뷰 구조 작성.
2. 시그널링 패키지 압축(CompressionStream/Pako 폴백) 및 Base64 인코딩/디코딩 로직 작성 (`encoding` 필드 포함).

### Phase 2: 시그널링 상태 머신 및 UI
1. WebRTC ICE Gathering 대기 로직 (10초 타임아웃, 예외 처리).
2. 패키지 검증 (type, sessionId, createdAt 검증).
3. Offer/Answer 교환 UI (QR 코드는 보조수단, 용량 검사 로직 추가).

### Phase 3: P2P 파일 전송 
1. `sctp.maxMessageSize` 기반 Chunk 분할 및 백프레셔 적용.
2. 25byte 바이너리 헤더 파싱 및 진행률 표시 로직.
3. 순차 대기열 처리 및 `FILE_VERIFIED`를 통한 최종 완료 확정 로직.

### Phase 4: UI/UX 고도화 및 오류 처리
1. 다중 파일 대기열 및 250MB 제한 처리.
2. TURN 미사용 안내, 브라우저 메모리 한계 안내 문구.

### Phase 5: 테스트 및 배포
1. 다양한 조건(망 분리, 크로스 브라우징, 전송 중 중단 등) 단위/통합 수동 테스트.
2. GitHub Pages용 Base 설정 및 Actions 스크립트 작성/적용.
