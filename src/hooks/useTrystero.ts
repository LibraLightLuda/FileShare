import { useState, useRef, useCallback, useEffect } from 'react';
import { joinRoom, type Room } from '@trystero-p2p/torrent';
import { hashRoomId } from '../utils/trystero';
import { DEFAULT_ICE_SERVERS } from '../utils/config';

export type TrysteroState = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'error';

export function useTrystero(onMessageReceived: (data: string | ArrayBuffer) => void) {
  const [connectionState, setConnectionState] = useState<TrysteroState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const roomRef = useRef<Room | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
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
    pendingIceCandidatesRef.current = [];
    setConnectionState('idle');
  }, []);

  const initRoom = useCallback(async (normalizedCode: string, isInitiator: boolean) => {
    disconnect();
    setConnectionState('joining');
    setErrorMessage('');

    try {
      const roomId = await hashRoomId(normalizedCode);
      // Trystero default relays are ultra-stable and guaranteed to match across all peers
      const room = joinRoom({ appId: 'fileshare:v1' }, roomId);
      roomRef.current = room;

      if (isInitiator) {
        setConnectionState('waiting');
      } else {
        setConnectionState('connecting');
      }

      // Trystero action to exchange our own WebRTC SDP and ICE candidates
      const signalAction = room.makeAction('webrtc-signal');

      const createOrGetPeerConnection = (peerId: string) => {
        if (pcRef.current) return pcRef.current;

        remotePeerIdRef.current = peerId;
        setConnectionState('connecting');

        const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
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
            signalAction.send({ type: 'candidate', candidate: event.candidate.toJSON() } as any);
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setConnectionState('disconnected');
          }
        };

        return pc;
      };

      room.onPeerJoin = async (peerId: string) => {
        if (remotePeerIdRef.current && remotePeerIdRef.current !== peerId) {
          console.warn('Third peer tried to join, ignoring:', peerId);
          return;
        }
        
        const pc = createOrGetPeerConnection(peerId);

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signalAction.send({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } } as any);
        }
      };

      signalAction.onMessage = async (data: any, context: any) => {
        const peerId = context?.peerId || context?.id || context;
        if (!peerId) return;

        if (remotePeerIdRef.current && remotePeerIdRef.current !== peerId) return;

        const pc = createOrGetPeerConnection(peerId);

        try {
          if (data.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            // Flush queued ICE candidates
            while (pendingIceCandidatesRef.current.length > 0) {
              const candidate = pendingIceCandidatesRef.current.shift();
              if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalAction.send({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } } as any);
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            // Flush queued ICE candidates
            while (pendingIceCandidatesRef.current.length > 0) {
              const candidate = pendingIceCandidatesRef.current.shift();
              if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
          } else if (data.type === 'candidate') {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              pendingIceCandidatesRef.current.push(data.candidate);
            }
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
