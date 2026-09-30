interface VoiceBlobProps {
  mode: 'listening' | 'speaking';
  onStop: () => void;
}

export default function VoiceBlob({ mode, onStop }: VoiceBlobProps) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '28px',
      zIndex: 10,
      borderRadius: '16px',
      pointerEvents: 'auto'
    }}>

      {/* Label */}
      <div style={{
        fontSize: '13px',
        color: 'var(--color-text-secondary)',
        letterSpacing: '0.04em'
      }}>
        {mode === 'listening' ? 'Listening...' : 'ARIA is speaking...'}
      </div>

      {/* Blob */}
      <div
        style={{ position: 'relative', width: '100px', height: '100px', cursor: mode === 'listening' ? 'pointer' : 'default', pointerEvents: 'auto' }}
        onClick={mode === 'listening' ? onStop : undefined}
      >
        <div className="aria-voice-loader">
          <svg width={100} height={100} viewBox="0 0 100 100">
            <defs>
              <mask id="clipping">
                <polygon points="0,0 100,0 100,100 0,100" fill="black" />
                <polygon points="25,25 75,25 50,75" fill="white" />
                <polygon points="50,25 75,75 25,75" fill="white" />
                <polygon points="35,35 65,35 50,65" fill="white" />
                <polygon points="35,35 65,35 50,65" fill="white" />
                <polygon points="35,35 65,35 50,65" fill="white" />
                <polygon points="35,35 65,35 50,65" fill="white" />
                <polygon points="35,35 65,35 50,65" fill="white" />
              </mask>
            </defs>
          </svg>
          <div className="aria-box" />
        </div>
      </div>

      {/* Wave bars */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px' }}>
        {[0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2].map((delay, i) => (
          <div
            key={i}
            className="aria-wave-bar"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>

      {/* Cancel or Stop button */}
      <button
        onClick={onStop}
        style={{
          fontSize: '13px',
          color: mode === 'speaking' ? '#ff4444' : 'var(--color-text-secondary)',
          cursor: 'pointer',
          border: mode === 'speaking' ? '0.5px solid #ff4444' : '0.5px solid var(--color-border-secondary)',
          borderRadius: '20px',
          padding: '6px 20px',
          background: 'none',
          pointerEvents: 'auto'
        }}
      >
        {mode === 'listening' ? 'Cancel' : 'Stop'}
      </button>
    </div>
  );
}
