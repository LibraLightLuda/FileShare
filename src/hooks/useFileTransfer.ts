import { useState, useCallback, useRef } from 'react';

export type TransferState = 'offered' | 'waiting-acceptance' | 'accepted' | 'transferring' | 'completed' | 'failed' | 'cancelled' | 'verifying';

export interface FileMetadata {
  transferId: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface TransferProgress {
  transferId: string;
  state: TransferState;
  metadata: FileMetadata;
  bytesTransferred: number;
  isSender: boolean;
  blob?: Blob;
}

const MAX_ALLOWED_CHUNK_SIZE = 65536; // Cap chunk size to 64KB for smooth UI progress
const PROTOCOL_VERSION = 1;

export function useFileTransfer(
  sendData: (data: string | ArrayBuffer) => void
) {
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  
  const sendQueues = useRef<Record<string, { file: File, offset: number, cancelled: boolean }>>({});
  const activeSendTransferId = useRef<string | null>(null);
  const receiveBuffers = useRef<Record<string, { chunks: ArrayBuffer[], receivedBytes: number, expectedSize: number }>>({});
  
  const getChunkSize = useCallback(() => {
    return MAX_ALLOWED_CHUNK_SIZE;
  }, []);

  const processSendQueue = useCallback(async () => {
    if (activeSendTransferId.current) return; 
    
    const nextTransferId = Object.keys(sendQueues.current).find(id => {
      const q = sendQueues.current[id];
      const t = transfers[id];
      return t && t.state === 'accepted' && !q.cancelled;
    });

    if (!nextTransferId) return;

    activeSendTransferId.current = nextTransferId;
    const queue = sendQueues.current[nextTransferId];
    // Trystero 네이티브 연결 상태는 sendData 가능 여부로 판단
    // 데이터 채널은 Trystero 내부에 있으므로 여기서는 통과

    setTransfers(prev => ({
      ...prev,
      [nextTransferId]: { ...prev[nextTransferId], state: 'transferring', bytesTransferred: 0 }
    }));

    sendData(JSON.stringify({ type: 'FILE_START', payload: { transferId: nextTransferId } }));

    const chunkSize = getChunkSize();
    // Header is 25 bytes, payload is up to chunkSize - 25
    const maxPayloadLength = chunkSize - 25; 

    let chunkIndex = 0;
    while (queue.offset < queue.file.size && !queue.cancelled) {
      // Trystero action.send 내부에서 백프레셔를 관리하므로 수동 bufferedAmount 대기 불필요
      if (queue.cancelled) break;

      const end = Math.min(queue.offset + maxPayloadLength, queue.file.size);
      const chunkBlob = queue.file.slice(queue.offset, end);
      const chunkBuffer = await chunkBlob.arrayBuffer();
      
      const payloadLength = chunkBuffer.byteLength;
      
      const combined = new Uint8Array(25 + payloadLength);
      const view = new DataView(combined.buffer);
      
      view.setUint8(0, PROTOCOL_VERSION);
      
      // UUID is 36 chars. Wait! In the prompt, the user specified: 
      // "16바이트 transferId"
      // We must pack a 36-char UUID into 16 bytes.
      // Let's use a simpler random 16-byte hex string for transferId or just encode the UUID into 16 bytes.
      // For simplicity, generating a random 16-byte array for the transfer ID when offering.
      // But we already use crypto.randomUUID(). A UUID is exactly 16 bytes of data.
      // We can parse the UUID hex string into 16 bytes.
      const uuidHex = nextTransferId.replace(/-/g, '');
      for (let i = 0; i < 16; i++) {
        combined[1 + i] = parseInt(uuidHex.substring(i * 2, i * 2 + 2), 16);
      }
      
      view.setUint32(17, chunkIndex, true);
      view.setUint32(21, payloadLength, true);
      
      combined.set(new Uint8Array(chunkBuffer), 25);

      try {
        await Promise.resolve(sendData(combined.buffer));
        queue.offset = end;
        chunkIndex++;
        
        if (queue.offset % (maxPayloadLength * 10) === 0 || queue.offset >= queue.file.size) {
          setTransfers(prev => ({
            ...prev,
            [nextTransferId]: { ...prev[nextTransferId], bytesTransferred: end }
          }));
        }
      } catch (err) {
        console.error("Send failed", err);
        queue.cancelled = true;
        setTransfers(prev => ({ ...prev, [nextTransferId]: { ...prev[nextTransferId], state: 'failed' } }));
        break;
      }
    }

    if (!queue.cancelled && queue.offset >= queue.file.size) {
      setTransfers(prev => ({
        ...prev,
        [nextTransferId]: { ...prev[nextTransferId], state: 'verifying' }
      }));
      // Delete from queue but wait for FILE_VERIFIED to mark 'completed'
      delete sendQueues.current[nextTransferId];
    } else if (queue.cancelled) {
       // Cleanup if cancelled during transfer
       delete sendQueues.current[nextTransferId];
    }

    activeSendTransferId.current = null;
    setTimeout(processSendQueue, 50);
  }, [transfers, sendData, getChunkSize]);


  const handleMessage = useCallback((data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'FILE_OFFER') {
          const meta: FileMetadata = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [meta.transferId]: {
              transferId: meta.transferId,
              state: 'offered',
              metadata: meta,
              bytesTransferred: 0,
              isSender: false
            }
          }));
        } else if (msg.type === 'FILE_ACCEPT') {
          const { transferId } = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'accepted' }
          }));
          setTimeout(processSendQueue, 50); 
        } else if (msg.type === 'FILE_REJECT') {
          const { transferId } = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'failed' }
          }));
          delete sendQueues.current[transferId];
        } else if (msg.type === 'FILE_CANCEL') {
          const { transferId } = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'cancelled' }
          }));
          delete sendQueues.current[transferId];
          delete receiveBuffers.current[transferId];
          if (activeSendTransferId.current === transferId) {
            activeSendTransferId.current = null;
            setTimeout(processSendQueue, 50);
          }
        } else if (msg.type === 'FILE_START') {
          const { transferId } = msg.payload;
          const meta = transfers[transferId]?.metadata;
          receiveBuffers.current[transferId] = { chunks: [], receivedBytes: 0, expectedSize: meta?.size || 0 };
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'transferring', bytesTransferred: 0 }
          }));
        } else if (msg.type === 'FILE_VERIFIED') {
          const { transferId } = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'completed' }
          }));
        } else if (msg.type === 'FILE_VERIFY_FAIL') {
          const { transferId } = msg.payload;
          setTransfers(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], state: 'failed' }
          }));
        }
      } catch (e) {
        console.error('Failed to parse DataChannel JSON message', e);
      }
    } else {
      let buffer: ArrayBuffer;
      let byteOffset = 0;
      let byteLength = 0;

      if (data instanceof ArrayBuffer) {
        buffer = data;
        byteOffset = 0;
        byteLength = data.byteLength;
      } else if (ArrayBuffer.isView(data)) {
        const viewData = data as any;
        buffer = viewData.buffer;
        byteOffset = viewData.byteOffset;
        byteLength = viewData.byteLength;
      } else {
        console.error("Unknown binary type received:", data);
        return;
      }

      const view = new DataView(buffer, byteOffset, byteLength);
      
      const proto = view.getUint8(0);
      if (proto !== PROTOCOL_VERSION) return; 
      
      const idBytes = new Uint8Array(buffer, byteOffset + 1, 16);
      let uuidHex = '';
      for (let i = 0; i < 16; i++) {
        uuidHex += idBytes[i].toString(16).padStart(2, '0');
      }
      const transferId = `${uuidHex.slice(0,8)}-${uuidHex.slice(8,12)}-${uuidHex.slice(12,16)}-${uuidHex.slice(16,20)}-${uuidHex.slice(20)}`;
      
      // const chunkIndex = view.getUint32(17, true);
      const payloadLength = view.getUint32(21, true);
      
      const chunk = buffer.slice(byteOffset + 25, byteOffset + 25 + payloadLength);
      
      const buf = receiveBuffers.current[transferId];
      if (buf) {
        buf.chunks.push(chunk);
        buf.receivedBytes += payloadLength;
        
        setTransfers(prev => {
          const t = prev[transferId];
          if (!t) return prev;
          
          let nextState = t.state;
          let nextBlob = t.blob;
          
          if (buf.receivedBytes >= buf.expectedSize) {
            // Verify
            if (buf.receivedBytes === buf.expectedSize) {
              sendData(JSON.stringify({ type: 'FILE_VERIFIED', payload: { transferId } }));
              nextState = 'completed';
              nextBlob = new Blob(buf.chunks, { type: t.metadata.mimeType || 'application/octet-stream' });
            } else {
              sendData(JSON.stringify({ type: 'FILE_VERIFY_FAIL', payload: { transferId } }));
              nextState = 'failed';
            }
            delete receiveBuffers.current[transferId];
          }
          
          return {
            ...prev,
            [transferId]: {
              ...t,
              state: nextState,
              bytesTransferred: Math.min(buf.receivedBytes, buf.expectedSize),
              blob: nextBlob
            }
          };
        });
      }
    }
  }, [transfers, sendData, processSendQueue]);

  const offerFile = (file: File) => {
    if (file.size > 250 * 1024 * 1024) {
      alert("MVP에서는 최대 250MB 파일만 전송할 수 있습니다. (브라우저 메모리 제한)");
      return;
    }
    
    const transferId = crypto.randomUUID();
    const meta: FileMetadata = {
      transferId,
      name: file.name,
      size: file.size,
      mimeType: file.type
    };
    
    sendQueues.current[transferId] = { file, offset: 0, cancelled: false };
    
    setTransfers(prev => ({
      ...prev,
      [transferId]: {
        transferId,
        state: 'waiting-acceptance',
        metadata: meta,
        bytesTransferred: 0,
        isSender: true
      }
    }));

    sendData(JSON.stringify({ type: 'FILE_OFFER', payload: meta }));
  };

  const acceptFile = (transferId: string) => {
    sendData(JSON.stringify({ type: 'FILE_ACCEPT', payload: { transferId } }));
  };

  const rejectFile = (transferId: string) => {
    sendData(JSON.stringify({ type: 'FILE_REJECT', payload: { transferId } }));
    setTransfers(prev => ({
      ...prev,
      [transferId]: { ...prev[transferId], state: 'failed' }
    }));
  };

  const cancelTransfer = (transferId: string) => {
    sendData(JSON.stringify({ type: 'FILE_CANCEL', payload: { transferId } }));
    
    if (sendQueues.current[transferId]) {
      sendQueues.current[transferId].cancelled = true;
    }
    
    setTransfers(prev => ({
      ...prev,
      [transferId]: { ...prev[transferId], state: 'cancelled' }
    }));

    if (activeSendTransferId.current === transferId) {
      activeSendTransferId.current = null;
      setTimeout(processSendQueue, 50);
    }
  };

  return {
    transfers,
    handleMessage,
    offerFile,
    acceptFile,
    rejectFile,
    cancelTransfer
  };
}
