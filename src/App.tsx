import { useState, useEffect, useRef } from 'react';
import { Copy, CheckCircle, XCircle, File as FileIcon, Clock, AlertTriangle, Link as LinkIcon, Settings } from 'lucide-react';
import QRCode from 'qrcode';
import { useTrystero } from './hooks/useTrystero';
import { useWebRTC } from './hooks/useWebRTC';
import { useFileTransfer, type TransferProgress } from './hooks/useFileTransfer';
import { generateRoomCode, normalizeRoomCode, formatRoomCode } from './utils/trystero';
import './index.css';

type AppMode = 'home' | 'room' | 'connected' | 'manual';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('home');
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  
  // Trystero (Default)
  const {
    connectionState: trysteroState,
    errorMessage: trysteroError,
    initRoom,
    disconnect: disconnectTrystero,
    sendData: trysteroSendData,
    dataChannelRef: trysteroDcRef
  } = useTrystero(handleMessageOuter);

  // Manual WebRTC (Fallback)
  const [manualState, setManualState] = useState<'idle' | 'creating_offer' | 'show_offer' | 'enter_offer' | 'creating_answer' | 'show_answer' | 'enter_answer'>('idle');
  const [offerStr, setOfferStr] = useState('');
  const [answerStr, setAnswerStr] = useState('');
  const [manualInputStr, setManualInputStr] = useState('');
  const {
    webrtcState,
    errorMsg: manualError,
    createOffer,
    applyOfferAndCreateAnswer,
    applyAnswer,
    sendData: manualSendData,
    onMessageRef,
    dataChannelRef: manualDcRef,
    closeWebRTC,
    pcRef
  } = useWebRTC();

  const isManual = appMode === 'manual';
  
  // Choose active signaling transport
  const sendData = isManual ? manualSendData : trysteroSendData;
  const activeDcRef = isManual ? manualDcRef : trysteroDcRef;

  const {
    transfers,
    handleMessage,
    offerFile,
    acceptFile,
    rejectFile,
    cancelTransfer
  } = useFileTransfer(sendData, activeDcRef, isManual ? pcRef : { current: null });

  // Route messages to file transfer handler
  function handleMessageOuter(data: string | ArrayBuffer) {
    handleMessage(data);
  }

  useEffect(() => {
    onMessageRef.current = handleMessage;
  }, [handleMessage, onMessageRef]);

  // Handle URL hash on load
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#join=')) {
      const code = hash.replace('#join=', '');
      if (code) {
        setInputCode(formatRoomCode(normalizeRoomCode(code)));
        setAppMode('home');
      }
    }
  }, []);

  // Monitor Trystero state
  useEffect(() => {
    if (trysteroState === 'connected') {
      setAppMode('connected');
    } else if (trysteroState === 'disconnected' || trysteroState === 'failed') {
      if (appMode === 'connected' || appMode === 'room') {
        alert("상대방과의 연결이 끊어졌습니다.");
        disconnectTrystero();
        setAppMode('home');
      }
    }
  }, [trysteroState, appMode, disconnectTrystero]);

  // Monitor Manual state
  useEffect(() => {
    // If appMode is connected and webrtcState disconnects, return to home
    if ((webrtcState === 'disconnected' || webrtcState === 'failed')) {
      if (appMode === 'connected' && manualDcRef.current) {
        alert("상대방과의 수동 연결이 끊어졌습니다.");
        closeWebRTC();
        setManualState('idle');
        setAppMode('home');
      }
    } else if (webrtcState === 'connected' && appMode === 'manual') {
      setAppMode('connected');
    }
  }, [webrtcState, appMode, manualDcRef, closeWebRTC]);

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    setRoomCode(code);
    setAppMode('room');
    initRoom(code, true);
    generateQR(code);
  };

  const handleJoinRoom = () => {
    const normalized = normalizeRoomCode(inputCode);
    if (normalized.length < 4) return;
    setRoomCode(formatRoomCode(normalized));
    setAppMode('room');
    initRoom(normalized, false);
  };

  const handleCancelRoom = () => {
    disconnectTrystero();
    setAppMode('home');
    setRoomCode('');
    setInputCode('');
  };

  // Manual Handlers
  const handleCreateOffer = async () => {
    setManualState('creating_offer');
    const offer = await createOffer();
    if (offer) {
      setOfferStr(offer);
      setManualState('show_offer');
      generateManualQR(offer);
    } else {
      setManualState('idle');
    }
  };

  const handleApplyOffer = async () => {
    if (!manualInputStr.trim()) return;
    setManualState('creating_answer');
    const answer = await applyOfferAndCreateAnswer(manualInputStr.trim());
    if (answer) {
      setAnswerStr(answer);
      setManualState('show_answer');
      generateManualQR(answer);
    } else {
      setManualState('enter_offer');
    }
  };

  const handleApplyAnswer = async () => {
    if (!manualInputStr.trim()) return;
    await applyAnswer(manualInputStr.trim());
  };

  const generateQR = async (code: string) => {
    try {
      const joinUrl = `${window.location.origin}${window.location.pathname}#join=${code}`;
      const url = await QRCode.toDataURL(joinUrl, { width: 200, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrUrl(url);
    } catch (e) {
      console.warn('QR 생성 실패', e);
    }
  };

  const generateManualQR = async (text: string) => {
    try {
      if (text.length > 2000) {
        setQrUrl('');
        return;
      }
      const url = await QRCode.toDataURL(text, { width: 250, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrUrl(url);
    } catch (e) {
      console.warn('QR 생성 실패', e);
      setQrUrl('');
    }
  };

  const handleCopy = (text: string, isUrl = false) => {
    const textToCopy = isUrl ? `${window.location.origin}${window.location.pathname}#join=${text}` : text;
    navigator.clipboard.writeText(textToCopy);
    alert('클립보드에 복사되었습니다.');
  };

  const handleDownloadFile = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setManualInputStr(text);
      };
      reader.readAsText(file);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      Array.from(e.target.files).forEach(offerFile);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="container animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header className="mb-8 text-center">
        <h1 className="text-4xl" style={{ 
          background: 'linear-gradient(to right, var(--primary-color), #a855f7)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          display: 'inline-block'
        }}>
          FileShare
        </h1>
        <p className="text-muted mt-2">서버 없이 간편한 P2P 파일 전송</p>
      </header>

      {(trysteroError || manualError) && (
        <div className="mb-4 glass-panel" style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--danger-color)' }}>
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle size={20} />
            <span>{trysteroError || manualError}</span>
          </div>
        </div>
      )}

      {appMode === 'home' && (
        <div className="glass-panel text-center">
          <div className="flex flex-col gap-6" style={{ display: 'flex', flexDirection: 'column' }}>
            <button className="btn w-full" onClick={handleCreateRoom} style={{ padding: '1.5rem', fontSize: '1.25rem' }}>
              방 만들기 (새 접속 코드 발급)
            </button>
            
            <div className="relative flex items-center justify-center my-2">
              <div style={{ borderTop: '1px solid var(--glass-border)', width: '100%', position: 'absolute' }}></div>
              <span style={{ background: 'var(--panel-bg)', padding: '0 1rem', position: 'relative', color: 'var(--text-muted)' }}>
                또는 참여하기
              </span>
            </div>

            <div className="input-group">
              <input 
                type="text" 
                className="input-field text-center text-2xl" 
                placeholder="XXXX-XXXX" 
                value={inputCode}
                onChange={(e) => {
                  const val = normalizeRoomCode(e.target.value);
                  setInputCode(formatRoomCode(val));
                }}
                maxLength={9}
                style={{ letterSpacing: '0.2rem' }}
              />
              <button 
                className="btn w-full mt-4" 
                onClick={handleJoinRoom} 
                disabled={normalizeRoomCode(inputCode).length < 4}
              >
                접속 코드로 연결하기
              </button>
            </div>
            
            <div className="mt-8 text-right">
              <button 
                className="btn btn-secondary" 
                onClick={() => setAppMode('manual')}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                <Settings size={14} /> 고급 수동 연결 (오프라인/트래커 장애 시)
              </button>
            </div>
          </div>
        </div>
      )}

      {appMode === 'room' && (
        <div className="glass-panel text-center">
          <h2 className="text-xl text-muted mb-2">접속 코드</h2>
          <div className="text-4xl mb-6" style={{ letterSpacing: '0.3rem', fontWeight: 800 }}>
            {roomCode}
          </div>
          
          <div className="flex justify-center mb-6">
            {qrUrl && (
              <img src={qrUrl} alt="QR Code" style={{ borderRadius: '12px', background: 'white', padding: '0.5rem' }} />
            )}
          </div>
          
          <div className="flex justify-center gap-2 mb-8">
            <button className="btn btn-secondary" onClick={() => handleCopy(normalizeRoomCode(roomCode))}>
              <Copy size={18} /> 코드 복사
            </button>
            <button className="btn btn-secondary" onClick={() => handleCopy(normalizeRoomCode(roomCode), true)}>
              <LinkIcon size={18} /> 공유 링크 복사
            </button>
          </div>

          <div className="flex flex-col items-center justify-center py-6 border border-dashed rounded" style={{ borderColor: 'var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
            {trysteroState === 'joining' && <p>트래커 접속 중...</p>}
            {trysteroState === 'waiting' && <><Clock size={32} className="animate-pulse mb-2 text-primary" /><p>상대방을 기다리고 있습니다...</p></>}
            {trysteroState === 'connecting' && <p className="text-success">피어 발견! P2P 연결 중...</p>}
          </div>

          <button className="btn btn-danger w-full mt-6" onClick={handleCancelRoom}>취소</button>
        </div>
      )}

      {appMode === 'manual' && (
        <div className="glass-panel text-center">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl">고급 수동 연결 모드</h2>
            <button className="btn btn-secondary" onClick={() => { setAppMode('home'); closeWebRTC(); setManualState('idle'); }} style={{ padding: '0.5rem' }}>
              돌아가기
            </button>
          </div>
          
          {manualState === 'idle' && (
            <div className="flex flex-col gap-4">
              <button className="btn w-full" onClick={handleCreateOffer}>
                새 연결 만들기 (보내는/받는 쪽 모두 가능)
              </button>
              <div className="text-muted text-sm my-2">또는</div>
              <button className="btn btn-secondary w-full" onClick={() => { setManualState('enter_offer'); setManualInputStr(''); }}>
                상대방 연결 정보 가져오기
              </button>
            </div>
          )}

          {(manualState === 'creating_offer' || manualState === 'creating_answer') && (
            <div className="py-12">
              <Clock size={48} className="mx-auto mb-4 animate-pulse" style={{ color: 'var(--primary-color)' }} />
              <h2 className="text-xl">연결 정보(ICE) 수집 중...</h2>
              <p className="text-muted mt-2">최대 10초가 소요될 수 있습니다.</p>
            </div>
          )}

          {manualState === 'show_offer' && (
            <div className="text-left">
              <h2 className="text-xl mb-4 text-center">1. 상대방에게 전달하세요 (Offer)</h2>
              <div className="flex justify-center mb-6">
                {qrUrl ? <img src={qrUrl} alt="QR" style={{ borderRadius: '12px' }} /> : <div className="text-muted p-4 text-center">용량 초과로 QR 불가</div>}
              </div>
              <div className="flex gap-2 mb-8 justify-center">
                <button className="btn btn-secondary" onClick={() => handleCopy(offerStr)}>문자열 복사</button>
                <button className="btn btn-secondary" onClick={() => handleDownloadFile(offerStr, 'offer.txt')}>파일 저장</button>
              </div>
              <hr style={{ borderColor: 'var(--glass-border)', margin: '2rem 0' }} />
              <h2 className="text-lg mb-2 text-center">2. 상대방의 응답(Answer) 입력</h2>
              <textarea className="input-field mb-2" rows={4} value={manualInputStr} onChange={e => setManualInputStr(e.target.value)} />
              <div className="flex gap-2 justify-between">
                <label className="btn btn-secondary cursor-pointer">파일 읽기<input type="file" style={{ display: 'none' }} accept=".txt" onChange={handleFileUpload} /></label>
                <button className="btn" onClick={handleApplyAnswer} disabled={!manualInputStr.trim()}>연결 시작</button>
              </div>
            </div>
          )}

          {manualState === 'enter_offer' && (
            <div className="text-left">
              <h2 className="text-xl mb-4 text-center">상대방의 연결 정보(Offer) 입력</h2>
              <textarea className="input-field mb-4" rows={5} value={manualInputStr} onChange={e => setManualInputStr(e.target.value)} />
              <div className="flex gap-2 justify-between">
                <label className="btn btn-secondary cursor-pointer">파일 읽기<input type="file" style={{ display: 'none' }} accept=".txt" onChange={handleFileUpload} /></label>
                <button className="btn" onClick={handleApplyOffer} disabled={!manualInputStr.trim()}>확인</button>
              </div>
            </div>
          )}

          {manualState === 'show_answer' && (
            <div className="text-left">
              <h2 className="text-xl mb-4 text-center">응답(Answer) 생성 완료</h2>
              <p className="text-center text-muted mb-4">방을 만든 사람에게 전달하세요.</p>
              <div className="flex justify-center mb-4">
                {qrUrl ? <img src={qrUrl} alt="QR" style={{ borderRadius: '12px' }} /> : <div className="text-muted">QR 불가</div>}
              </div>
              <div className="flex gap-2 justify-center">
                <button className="btn btn-secondary" onClick={() => handleCopy(answerStr)}>문자열 복사</button>
                <button className="btn btn-secondary" onClick={() => handleDownloadFile(answerStr, 'answer.txt')}>파일 저장</button>
              </div>
            </div>
          )}
        </div>
      )}

      {appMode === 'connected' && (
        <div className="glass-panel">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl text-success flex items-center gap-2">
                <CheckCircle /> 연결됨
              </h2>
              {roomCode && <span className="badge info">{roomCode} 방</span>}
              {isManual && <span className="badge warning">수동 연결됨</span>}
            </div>
            <button className="btn btn-danger" onClick={() => {
              if (isManual) { closeWebRTC(); setManualState('idle'); }
              else disconnectTrystero();
              setAppMode('home');
            }}>
              연결 종료
            </button>
          </div>

          <div 
            className="drop-zone mb-8"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileIcon size={48} className="mb-4" style={{ color: 'var(--primary-color)', margin: '0 auto' }} />
            <h3 className="text-xl mb-2">클릭하여 파일 선택</h3>
            <p className="text-muted text-sm">최대 권장 크기: 250MB (브라우저 메모리 한계)</p>
            <input 
              type="file" 
              multiple 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={onFileSelect}
            />
          </div>

          <div className="file-list">
            {Object.values(transfers).map((t) => (
              <FileTransferItem 
                key={t.transferId} 
                transfer={t} 
                onAccept={() => acceptFile(t.transferId)}
                onReject={() => rejectFile(t.transferId)}
                onCancel={() => cancelTransfer(t.transferId)}
              />
            ))}
          </div>
        </div>
      )}

      <footer className="mt-8 text-center text-sm text-muted">
        <p>서버를 거치지 않고 연결된 기기 간 직접 데이터를 교환합니다.</p>
        <p>같은 Wi-Fi나 로컬 네트워크 사용을 권장합니다.</p>
        
        <div className="mt-6 flex flex-col items-center gap-2" style={{ opacity: 0.7 }}>
          <img src="https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Flibralightluda.github.io%2FFileShare&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false" alt="Hits" />
          <div className="text-xs">
            v{__APP_VERSION__} ({__BUILD_DATE__})
          </div>
        </div>
      </footer>
    </div>
  );
}

function FileTransferItem({ 
  transfer, 
  onAccept, 
  onReject, 
  onCancel 
}: { 
  transfer: TransferProgress, 
  onAccept: () => void,
  onReject: () => void,
  onCancel: () => void
}) {
  const percent = transfer.metadata.size > 0 
    ? Math.min(100, Math.round((transfer.bytesTransferred / transfer.metadata.size) * 100))
    : 100;

  const downloadFile = () => {
    if (transfer.blob) {
      const url = URL.createObjectURL(transfer.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = transfer.metadata.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="file-item">
      <div className="file-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="file-name" title={transfer.metadata.name}>
          {transfer.metadata.name}
          <span className="text-muted text-sm ml-2">({formatSize(transfer.metadata.size)})</span>
        </div>
        <div className="flex gap-2" style={{ display: 'flex', gap: '0.5rem' }}>
          {transfer.state === 'offered' && !transfer.isSender && (
            <>
              <button className="btn btn-secondary" onClick={onReject} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>거절</button>
              <button className="btn" onClick={onAccept} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>수락</button>
            </>
          )}
          {transfer.state === 'transferring' && (
            <button className="btn btn-danger" onClick={onCancel} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>취소</button>
          )}
          {transfer.state === 'completed' && !transfer.isSender && (
            <button className="btn" onClick={downloadFile} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>저장</button>
          )}
        </div>
      </div>
      
      <div className="flex justify-between items-center text-sm mt-2" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <span className="text-muted flex items-center gap-1" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {transfer.state === 'waiting-acceptance' && <><Clock size={14} /> 상대방 수락 대기 중</>}
          {transfer.state === 'offered' && !transfer.isSender && '파일 수신 제안됨'}
          {transfer.state === 'transferring' && `${percent}% (${formatSize(transfer.bytesTransferred)} / ${formatSize(transfer.metadata.size)})`}
          {transfer.state === 'completed' && <><CheckCircle size={14} color="var(--success-color)" /> 완료됨</>}
          {transfer.state === 'failed' && <><XCircle size={14} color="var(--danger-color)" /> 실패/거절됨</>}
          {transfer.state === 'cancelled' && <><XCircle size={14} color="var(--text-muted)" /> 취소됨</>}
        </span>
      </div>

      {transfer.state === 'transferring' && (
        <div className="progress-bar-container">
          <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
        </div>
      )}
    </div>
  );
}
