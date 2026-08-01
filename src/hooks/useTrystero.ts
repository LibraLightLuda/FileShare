import { useState, useRef, useCallback, useEffect } from 'react';
import { joinRoom, type Room } from '@trystero-p2p/torrent';
import { getRandomTrackers, hashRoomId } from '../utils/trystero';

export type TrysteroState = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'error';

export function useTrystero(onMessageReceived: (data: string | ArrayBuffer) => void) {
  const [connectionState, setConnectionState] = useState<TrysteroState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const roomRef = useRef<Room | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const onMessageRef = useRef<((data: string | ArrayBuffer) => void) | undefined>(undefined);

  useEffect(() => {
    onMessageRef.current = onMessageReceived;
  }, [onMessageReceived]);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
    pcRef.current = null;
    remotePeerIdRef.current = null;
    setConnectionState('idle');
  }, []);

  const initRoom = useCallback(async (normalizedCode: string, isInitiator: boolean) => {
    disconnect();
    setConnectionState('joining');
    setErrorMessage('');

    try {
      const roomId = await hashRoomId(normalizedCode);
      const trackerUrls = getRandomTrackers(3);
      const room = joinRoom({ appId: 'fileshare:v1', relayConfig: { urls: trackerUrls } }, roomId);
      roomRef.current = room;

      if (isInitiator) {
        setConnectionState('waiting');
      } else {
        setConnectionState('connecting');
      }

      room.onPeerJoin = (peerId: string) => {
        // 방에 이미 다른 피어가 연결되어 있다면 세 번째 피어는 거절/무시
        if (remotePeerIdRef.current && remotePeerIdRef.current !== peerId) {
          console.warn('Third peer tried to join, ignoring:', peerId);
          return;
        }
        
        remotePeerIdRef.current = peerId;
        setConnectionState('connecting');

        // Trystero가 생성한 RTCPeerConnection 추출
        const pc = room.getPeers()[peerId];
        if (!pc) return;
        
        pcRef.current = pc;

        const setupDc = (dc: RTCDataChannel) => {
          dcRef.current = dc;
          dc.binaryType = 'arraybuffer';
          
          dc.onmessage = (e: any) => {
            if (onMessageRef.current) {
              onMessageRef.current(e.data);
            }
          };

          dc.onopen = () => {
            console.log('[Trystero] DataChannel onopen fired');
            setConnectionState('connected');
          };

          if (dc.readyState === 'open') {
            console.log('[Trystero] DataChannel already open upon creation');
            setConnectionState('connected');
          }

          dc.onclose = () => {
            setConnectionState('disconnected');
          };

          dc.onerror = () => {
            setConnectionState('failed');
            setErrorMessage('데이터 채널 오류가 발생했습니다.');
          };
        };

        if (isInitiator) {
          // Initiator explicitly creates the channel, which triggers renegotiation
          const dc = pc.createDataChannel('fileTransfer');
          setupDc(dc);
        } else {
          // Answerer waits for the incoming channel
          pc.addEventListener('datachannel', (event) => {
            if (event.channel.label === 'fileTransfer') {
              setupDc(event.channel);
            }
          });
        }

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setConnectionState('disconnected');
          }
        };
      };

      room.onPeerLeave = (peerId: string) => {
        if (remotePeerIdRef.current === peerId) {
          setConnectionState('disconnected');
          remotePeerIdRef.current = null;
        }
      };

    } catch (err: any) {
      setConnectionState('error');
      setErrorMessage(err.message || '방 입장에 실패했습니다.');
    }
  }, [disconnect]);

  const sendData = useCallback((data: string | ArrayBuffer) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(data as any);
    } else {
      console.warn("DataChannel not open");
    }
  }, []);

  return {
    connectionState,
    errorMessage,
    initRoom,
    disconnect,
    sendData,
    dataChannelRef: dcRef
  };
}
