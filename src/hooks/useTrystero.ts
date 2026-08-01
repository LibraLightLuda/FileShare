import { useState, useRef, useCallback, useEffect } from 'react';
import { joinRoom, type Room } from '@trystero-p2p/torrent';
import { getRandomTrackers, hashRoomId } from '../utils/trystero';
import { DEFAULT_ICE_SERVERS } from '../utils/config';

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
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
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

      // Trystero action to exchange our own WebRTC SDP and ICE candidates
      const signalAction = room.makeAction('webrtc-signal');

      room.onPeerJoin = async (peerId: string) => {
        if (remotePeerIdRef.current && remotePeerIdRef.current !== peerId) {
          console.warn('Third peer tried to join, ignoring:', peerId);
          return;
        }
        
        remotePeerIdRef.current = peerId;
        setConnectionState('connecting');

        // Create our own custom WebRTC connection
        const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
        pcRef.current = pc;

        // Setup custom DataChannel
        const setupDc = (dc: RTCDataChannel) => {
          dcRef.current = dc;
          dc.binaryType = 'arraybuffer';
          
          dc.onmessage = (e: any) => {
            if (onMessageRef.current) {
              onMessageRef.current(e.data);
            }
          };

          dc.onopen = () => {
            setConnectionState('connected');
          };
          if (dc.readyState === 'open') {
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
          const dc = pc.createDataChannel('fileTransfer');
          setupDc(dc);
        } else {
          pc.ondatachannel = (event) => {
            if (event.channel.label === 'fileTransfer') {
              setupDc(event.channel);
            }
          };
        }

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            signalAction.send({ type: 'candidate', candidate: event.candidate.toJSON() } as any, { target: peerId });
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setConnectionState('disconnected');
          }
        };

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signalAction.send({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } } as any, { target: peerId });
        }
      };

      signalAction.onMessage = async (data: any, context: any) => {
        const peerId = context.id || context.peerId || context; // handle different contexts based on API version
        if (remotePeerIdRef.current !== peerId) return;
        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (data.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalAction.send({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } } as any, { target: peerId });
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          } else if (data.type === 'candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (err) {
          console.error("Failed to process signal", err);
        }
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
