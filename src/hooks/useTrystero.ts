import { useState, useRef, useCallback, useEffect } from 'react';
import { joinRoom, type Room } from '@trystero-p2p/torrent';
import { hashRoomId, TRACKER_POOL } from '../utils/trystero';
import { DEFAULT_ICE_SERVERS } from '../utils/config';

export type TrysteroState = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'error';

/**
 * Trystero WebTorrent P2P 연결 관리 커스텀 훅
 * - 2차 수동 RTCPeerConnection 대신 Trystero 네이티브 makeAction 기반 P2P 데이터 전송 적용
 * - 다중 트래커 relayConfig 설정으로 개별 트래커 장애 시 자동 폴백 처리
 */
export function useTrystero(onMessageReceived: (data: string | ArrayBuffer) => void) {
  const [connectionState, setConnectionState] = useState<TrysteroState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const roomRef = useRef<Room | null>(null);
  const sendDataActionRef = useRef<((data: any) => void) | null>(null);
  const onMessageRef = useRef<((data: string | ArrayBuffer) => void) | undefined>(undefined);

  useEffect(() => {
    onMessageRef.current = onMessageReceived;
  }, [onMessageReceived]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
    sendDataActionRef.current = null;
    setConnectionState('idle');
  }, []);

  const initRoom = useCallback(async (normalizedCode: string, isInitiator: boolean) => {
    disconnect();
    setConnectionState('joining');
    setErrorMessage('');

    try {
      // 8자리 접속 코드 정규화 문자열로부터 SHA-256 Room ID 생성
      const roomId = await hashRoomId(normalizedCode);
      
      // Trystero joinRoom 실행 (relayConfig 옵션으로 다중 트래커 설정 및 경고 방어)
      const room = joinRoom({
        appId: 'fileshare:v1',
        relayConfig: {
          urls: TRACKER_POOL,
          redundancy: 3,
          warnOnRelayFailure: false
        },
        rtcConfig: {
          iceServers: DEFAULT_ICE_SERVERS
        }
      }, roomId);
      
      roomRef.current = room;

      if (isInitiator) {
        setConnectionState('waiting');
      } else {
        setConnectionState('connecting');
      }

      // Trystero Native Action 생성 (파일 데이터 교환용)
      const fileAction = room.makeAction<string | ArrayBuffer>('file-data');
      sendDataActionRef.current = (data: string | ArrayBuffer) => fileAction.send(data);

      // 수신 데이터 액션 등록 (프로퍼티 할당)
      fileAction.onMessage = (data: string | ArrayBuffer, context: any) => {
        console.log(`[Trystero] Received data from peer ${context?.peerId}`);
        if (onMessageRef.current) {
          onMessageRef.current(data);
        }
      };

      // 피어 입장 시 이벤트 (Trystero 내부 WebRTC 커넥션 수립 완료 시점)
      room.onPeerJoin = (peerId: string) => {
        console.log(`[Trystero] Peer joined: ${peerId}`);
        setConnectionState('connected');
      };

      // 피어 이탈 시 이벤트
      room.onPeerLeave = (peerId: string) => {
        console.log(`[Trystero] Peer left: ${peerId}`);
        setConnectionState('disconnected');
      };

    } catch (err: any) {
      console.error('[Trystero] Room init failed:', err);
      setConnectionState('error');
      setErrorMessage(err.message || '방 입장에 실패했습니다.');
    }
  }, [disconnect]);

  const sendData = useCallback((data: string | ArrayBuffer) => {
    if (sendDataActionRef.current) {
      sendDataActionRef.current(data);
    } else {
      console.warn("[Trystero] Send action not ready");
    }
  }, []);

  return {
    connectionState,
    errorMessage,
    initRoom,
    disconnect,
    sendData,
    dataChannelRef: { current: null }
  };
}
