import { useState, useRef, useCallback } from 'react';
import { DEFAULT_ICE_SERVERS } from '../utils/config';
import { encodeSignalingPackage, decodeSignalingPackage, type SignalingPackage } from '../utils/signaling';

export type WebRTCState = 'idle' | 'gathering' | 'gathered' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'error';

export function useWebRTC() {
  const [webrtcState, setWebrtcState] = useState<WebRTCState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string>('');
  
  const onMessageRef = useRef<((data: string | ArrayBuffer) => void) | undefined>(undefined);

  const initWebRTC = useCallback(() => {
    if (pcRef.current) pcRef.current.close();
    
    const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setWebrtcState('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        setWebrtcState('disconnected');
      } else if (pc.connectionState === 'failed') {
        setWebrtcState('failed');
      }
    };
    
    return pc;
  }, []);

  const setupDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      console.log('Data channel opened');
      setWebrtcState('connected');
    };

    dc.onmessage = (event) => {
      if (onMessageRef.current) {
        onMessageRef.current(event.data);
      }
    };
    
    dc.onclose = () => {
      console.log('Data channel closed');
      setWebrtcState('disconnected');
    };
  }, []);

  const waitForIceGathering = (pc: RTCPeerConnection, timeoutMs: number = 10000): Promise<void> => {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        return resolve();
      }

      const timer = setTimeout(() => {
        if (pc.iceGatheringState !== 'complete') {
          resolve(); // Resolve anyway on timeout to use whatever candidates were gathered
        }
      }, timeoutMs);

      const listener = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', listener);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', listener);
    });
  };

  const createOffer = useCallback(async (): Promise<string | null> => {
    try {
      setWebrtcState('gathering');
      const pc = initWebRTC();
      sessionIdRef.current = crypto.randomUUID();

      // DataChannel is created by initiator
      const dc = pc.createDataChannel('fileTransfer', {
        negotiated: true,
        id: 0
      });
      setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await waitForIceGathering(pc, 10000);

      const localDesc = pc.localDescription;
      if (!localDesc) throw new Error('로컬 설명을 생성할 수 없습니다.');
      
      // Check if candidates were gathered (sdp should contain a=candidate)
      // Actually, if it's completely empty (no candidates), it might still work in purely local env if host candidate is enough
      if (!localDesc.sdp.includes('a=candidate')) {
        // Warning but we don't block
        console.warn('No ICE candidates gathered.');
      }

      const pkg: SignalingPackage = {
        version: 1,
        type: 'offer',
        sessionId: sessionIdRef.current,
        createdAt: Date.now(),
        description: localDesc
      };

      const encoded = await encodeSignalingPackage(pkg);
      setWebrtcState('gathered');
      return encoded;
    } catch (e: any) {
      setErrorMsg(e.message || 'Offer 생성 중 오류 발생');
      setWebrtcState('error');
      return null;
    }
  }, [initWebRTC, setupDataChannel]);

  const applyOfferAndCreateAnswer = useCallback(async (encodedOffer: string): Promise<string | null> => {
    try {
      setWebrtcState('gathering');
      const pkg = await decodeSignalingPackage(encodedOffer);
      
      if (pkg.type !== 'offer') {
        throw new Error('전달된 패키지가 Offer 형식이 아닙니다.');
      }

      // Check age (e.g., 2 hours max)
      if (Date.now() - pkg.createdAt > 2 * 60 * 60 * 1000) {
        throw new Error('이 Offer 패키지는 만료되었습니다.');
      }

      sessionIdRef.current = pkg.sessionId;
      const pc = initWebRTC();

      const dc = pc.createDataChannel('fileTransfer', {
        negotiated: true,
        id: 0
      });
      setupDataChannel(dc);

      await pc.setRemoteDescription(new RTCSessionDescription(pkg.description));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await waitForIceGathering(pc, 10000);

      const localDesc = pc.localDescription;
      if (!localDesc) throw new Error('로컬 설명을 생성할 수 없습니다.');

      const answerPkg: SignalingPackage = {
        version: 1,
        type: 'answer',
        sessionId: sessionIdRef.current,
        createdAt: Date.now(),
        description: localDesc
      };

      const encoded = await encodeSignalingPackage(answerPkg);
      setWebrtcState('gathered');
      return encoded;
    } catch (e: any) {
      setErrorMsg(e.message || 'Answer 생성 중 오류 발생');
      setWebrtcState('error');
      return null;
    }
  }, [initWebRTC, setupDataChannel]);

  const applyAnswer = useCallback(async (encodedAnswer: string) => {
    try {
      const pkg = await decodeSignalingPackage(encodedAnswer);
      
      if (pkg.type !== 'answer') {
        throw new Error('전달된 패키지가 Answer 형식이 아닙니다.');
      }
      if (pkg.sessionId !== sessionIdRef.current) {
        throw new Error('현재 세션과 일치하지 않는 Answer입니다.');
      }

      const pc = pcRef.current;
      if (!pc) throw new Error('PeerConnection이 초기화되지 않았습니다.');

      await pc.setRemoteDescription(new RTCSessionDescription(pkg.description));
      setWebrtcState('connecting');
    } catch (e: any) {
      setErrorMsg(e.message || 'Answer 적용 중 오류 발생');
      setWebrtcState('error');
    }
  }, []);

  const sendData = useCallback((data: string | ArrayBuffer) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(data as any);
    } else {
      console.warn("DataChannel not open");
    }
  }, []);

  const closeWebRTC = useCallback(() => {
    if (dcRef.current) dcRef.current.close();
    if (pcRef.current) pcRef.current.close();
    pcRef.current = null;
    dcRef.current = null;
    setWebrtcState('idle');
  }, []);

  return {
    webrtcState,
    errorMsg,
    createOffer,
    applyOfferAndCreateAnswer,
    applyAnswer,
    sendData,
    onMessageRef,
    dataChannelRef: dcRef,
    closeWebRTC,
    pcRef
  };
}
