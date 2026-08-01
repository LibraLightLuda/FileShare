import { useState, useEffect, useRef } from 'react';
import { Copy, Upload, Download, CheckCircle, XCircle, File as FileIcon, Clock, AlertTriangle, Send } from 'lucide-react';
import QRCode from 'qrcode';
import { useWebRTC } from './hooks/useWebRTC';
import { useFileTransfer, type TransferProgress } from './hooks/useFileTransfer';
import './index.css';

type AppState = 'select_role' | 'creating_offer' | 'show_offer' | 'enter_offer' | 'creating_answer' | 'show_answer' | 'enter_answer' | 'connected';

export default function App() {
  const [appState, setAppState] = useState<AppState>('select_role');
  const [offerStr, setOfferStr] = useState('');
  const [answerStr, setAnswerStr] = useState('');
  const [inputStr, setInputStr] = useState('');
  const [qrUrl, setQrUrl] = useState('');

  const {
    webrtcState,
    errorMsg,
    createOffer,
    applyOfferAndCreateAnswer,
    applyAnswer,
    sendData,
    onMessageRef,
    dataChannelRef,
    closeWebRTC,
    pcRef
  } = useWebRTC();

  const {
    transfers,
    handleMessage,
    offerFile,
    acceptFile,
    rejectFile,
    cancelTransfer
  } = useFileTransfer(sendData, dataChannelRef, pcRef);

  useEffect(() => {
    onMessageRef.current = handleMessage;
  }, [handleMessage, onMessageRef]);

  useEffect(() => {
    if (webrtcState === 'connected') {
      setAppState('connected');
    } else if (webrtcState === 'disconnected' || webrtcState === 'failed') {
      // Return to home on disconnect
      if (appState === 'connected') {
        alert("연결이 끊어졌습니다.");
        setAppState('select_role');
      }
    }
  }, [webrtcState, appState]);

  const handleCreateOffer = async () => {
    setAppState('creating_offer');
    const offer = await createOffer();
    if (offer) {
      setOfferStr(offer);
      setAppState('show_offer');
      generateQR(offer);
    } else {
      setAppState('select_role');
    }
  };

  const handleApplyOffer = async () => {
    if (!inputStr.trim()) return;
    setAppState('creating_answer');
    const answer = await applyOfferAndCreateAnswer(inputStr.trim());
    if (answer) {
      setAnswerStr(answer);
      setAppState('show_answer');
      generateQR(answer);
    } else {
      setAppState('enter_offer');
    }
  };

  const handleApplyAnswer = async () => {
    if (!inputStr.trim()) return;
    await applyAnswer(inputStr.trim());
  };

  const generateQR = async (text: string) => {
    try {
      // Check if text is too large for QR
      if (text.length > 2000) {
        setQrUrl('');
        return;
      }
      const url = await QRCode.toDataURL(text, { width: 250, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrUrl(url);
    } catch (e) {
      console.warn('QR 생성 실패 (용량 초과 가능성)', e);
      setQrUrl('');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
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
        setInputStr(text);
      };
      reader.readAsText(file);
    }
  };

  const handleCancel = () => {
    closeWebRTC();
    setAppState('select_role');
    setOfferStr('');
    setAnswerStr('');
    setInputStr('');
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
          DropZone
        </h1>
        <p className="text-muted mt-2">서버 없는 완전 P2P 파일 전송</p>
      </header>

      {errorMsg && (
        <div className="mb-4 glass-panel" style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--danger-color)' }}>
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle size={20} />
            <span>{errorMsg}</span>
          </div>
        </div>
      )}

      {appState === 'select_role' && (
        <div className="glass-panel text-center">
          <div className="flex flex-col gap-4" style={{ display: 'flex', flexDirection: 'column' }}>
            <button className="btn w-full" onClick={handleCreateOffer} style={{ padding: '1.5rem', fontSize: '1.25rem' }}>
              새 연결 만들기 (보내는/받는 쪽 모두 가능)
            </button>
            <div className="text-muted text-sm my-2">또는</div>
            <button className="btn btn-secondary w-full" onClick={() => { setAppState('enter_offer'); setInputStr(''); }} style={{ padding: '1.5rem', fontSize: '1.25rem' }}>
              상대방 연결 정보 가져오기
            </button>
          </div>
        </div>
      )}

      {(appState === 'creating_offer' || appState === 'creating_answer') && (
        <div className="glass-panel text-center py-12">
          <Clock size={48} className="mx-auto mb-4 animate-pulse" style={{ color: 'var(--primary-color)', margin: '0 auto' }} />
          <h2 className="text-xl">연결 정보(ICE) 수집 중...</h2>
          <p className="text-muted mt-2">최대 10초가 소요될 수 있습니다.</p>
        </div>
      )}

      {appState === 'show_offer' && (
        <div className="glass-panel">
          <h2 className="text-2xl mb-4 text-center">1. 상대방에게 전달하세요 (Offer)</h2>
          
          <div className="flex justify-center mb-6">
            {qrUrl ? (
              <img src={qrUrl} alt="QR Code" style={{ borderRadius: '12px' }} />
            ) : (
              <div className="text-muted p-8 border border-dashed rounded text-center">
                데이터가 커서 QR코드를 생성할 수 없습니다.<br/>아래 텍스트 복사나 파일 저장을 이용하세요.
              </div>
            )}
          </div>

          <div className="flex gap-2 mb-8 justify-center">
            <button className="btn btn-secondary" onClick={() => handleCopy(offerStr)}>
              <Copy size={18} /> 문자열 복사
            </button>
            <button className="btn btn-secondary" onClick={() => handleDownloadFile(offerStr, 'offer.txt')}>
              <Download size={18} /> 파일 저장
            </button>
          </div>

          <hr style={{ borderColor: 'var(--glass-border)', margin: '2rem 0' }} />

          <h2 className="text-xl mb-4 text-center">2. 상대방의 응답(Answer)을 입력하세요</h2>
          <div className="input-group">
            <textarea 
              className="input-field" 
              rows={4} 
              placeholder="상대방이 생성한 Answer 텍스트를 붙여넣으세요..."
              value={inputStr}
              onChange={e => setInputStr(e.target.value)}
            />
          </div>
          <div className="flex gap-2 mb-4 justify-between">
            <div className="flex gap-2">
              <label className="btn btn-secondary cursor-pointer" style={{ cursor: 'pointer' }}>
                <Upload size={18} /> 파일 읽기
                <input type="file" style={{ display: 'none' }} accept=".txt" onChange={handleFileUpload} />
              </label>
            </div>
            <button className="btn" onClick={handleApplyAnswer} disabled={!inputStr.trim()}>
              연결 시작 <Send size={18} />
            </button>
          </div>
          <button className="btn btn-danger w-full mt-4" onClick={handleCancel}>취소</button>
        </div>
      )}

      {appState === 'enter_offer' && (
        <div className="glass-panel">
          <h2 className="text-2xl mb-4 text-center">상대방의 연결 정보(Offer) 입력</h2>
          <div className="input-group">
            <textarea 
              className="input-field" 
              rows={5} 
              placeholder="상대방이 보낸 Offer 텍스트를 붙여넣으세요..."
              value={inputStr}
              onChange={e => setInputStr(e.target.value)}
            />
          </div>
          <div className="flex gap-2 mb-8 justify-between">
            <label className="btn btn-secondary cursor-pointer" style={{ cursor: 'pointer' }}>
              <Upload size={18} /> 파일 읽기
              <input type="file" style={{ display: 'none' }} accept=".txt" onChange={handleFileUpload} />
            </label>
            <button className="btn" onClick={handleApplyOffer} disabled={!inputStr.trim()}>
              확인
            </button>
          </div>
          <button className="btn btn-secondary w-full" onClick={handleCancel}>돌아가기</button>
        </div>
      )}

      {appState === 'show_answer' && (
        <div className="glass-panel">
          <h2 className="text-2xl mb-4 text-center">응답(Answer) 생성 완료</h2>
          <p className="text-center text-muted mb-6">아래 정보를 방을 만든 사람에게 전달하세요.</p>
          
          <div className="flex justify-center mb-6">
            {qrUrl ? (
              <img src={qrUrl} alt="QR Code" style={{ borderRadius: '12px' }} />
            ) : (
              <div className="text-muted p-8 border border-dashed rounded text-center">
                데이터가 커서 QR코드를 생성할 수 없습니다.<br/>아래 텍스트 복사나 파일 저장을 이용하세요.
              </div>
            )}
          </div>

          <div className="flex gap-2 mb-8 justify-center">
            <button className="btn btn-secondary" onClick={() => handleCopy(answerStr)}>
              <Copy size={18} /> 문자열 복사
            </button>
            <button className="btn btn-secondary" onClick={() => handleDownloadFile(answerStr, 'answer.txt')}>
              <Download size={18} /> 파일 저장
            </button>
          </div>
          <p className="text-center text-muted text-sm">상대방이 확인하면 자동으로 파일 전송 화면으로 이동합니다.</p>
          <button className="btn btn-danger w-full mt-4" onClick={handleCancel}>취소</button>
        </div>
      )}

      {appState === 'connected' && (
        <div className="glass-panel">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl text-success flex items-center gap-2">
              <CheckCircle /> 연결됨
            </h2>
            <button className="btn btn-danger" onClick={handleCancel}>
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
