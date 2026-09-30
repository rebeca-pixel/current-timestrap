import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { MessageSquare, Send, X, Sparkles, Check, ListTodo, Sun, Moon, Mic } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import ReactMarkdown from 'react-markdown';
import VoiceBlob from './VoiceBlob';

interface ProjectTaskSelection {
  id: string;
  project_code: string;
  project_name: string;
  progress: number;
  deadline: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  projects?: ProjectTaskSelection[];
  tasks?: any[];
  planSubmitted?: boolean;
}

// ── Custom Loader ────────────────────────────────────────────────────────────
const ARIALoader = () => (
  <div style={{ position: 'relative', width: '2.5em', height: '2.5em', transform: 'rotate(165deg)', fontSize: '12px' }}>
    <style>{`
      @keyframes aria-before {
        0%   { width:.5em; box-shadow:1em -.5em rgba(225,20,98,.75),-1em .5em rgba(111,202,220,.75); }
        35%  { width:2.5em; box-shadow:0 -.5em rgba(225,20,98,.75),0 .5em rgba(111,202,220,.75); }
        70%  { width:.5em; box-shadow:-1em -.5em rgba(225,20,98,.75),1em .5em rgba(111,202,220,.75); }
        100% { box-shadow:1em -.5em rgba(225,20,98,.75),-1em .5em rgba(111,202,220,.75); }
      }
      @keyframes aria-after {
        0%   { height:.5em; box-shadow:.5em 1em rgba(61,184,143,.75),-.5em -1em rgba(233,169,32,.75); }
        35%  { height:2.5em; box-shadow:.5em 0 rgba(61,184,143,.75),-.5em 0 rgba(233,169,32,.75); }
        70%  { height:.5em; box-shadow:.5em -1em rgba(61,184,143,.75),-.5em 1em rgba(233,169,32,.75); }
        100% { box-shadow:.5em 1em rgba(61,184,143,.75),-.5em -1em rgba(233,169,32,.75); }
      }
      .aria-loader-inner::before {
        content:''; position:absolute; top:50%; left:50%;
        display:block; width:.5em; height:.5em; border-radius:.25em;
        transform:translate(-50%,-50%);
        animation: aria-before 2s infinite;
      }
      .aria-loader-inner::after {
        content:''; position:absolute; top:50%; left:50%;
        display:block; width:.5em; height:.5em; border-radius:.25em;
        transform:translate(-50%,-50%);
        animation: aria-after 2s infinite;
      }
    `}</style>
    <div className="aria-loader-inner" style={{ position: 'absolute', top: 'calc(50% - 1.25em)', left: 'calc(50% - 1.25em)', width: '2.5em', height: '2.5em' }} />
  </div>
);

// ── Intro Animation Screen ───────────────────────────────────────────────────
const IntroScreen = ({ onDone, isDark }: { onDone: () => void; isDark: boolean }) => {
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('show'), 100);
    const t2 = setTimeout(() => setPhase('exit'), 1800);
    const t3 = setTimeout(() => onDone(), 2300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  const bg = isDark ? '#0f0f1a' : '#f8f7ff';
  const textColor = isDark ? '#ffffff' : '#3730a3';
  const subColor = isDark ? '#7c5cbf' : '#6d5acd';
  const dotColor = isDark ? '#7c5cbf' : '#8b5cf6';

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50, borderRadius: '16px',
      background: bg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: phase === 'enter' ? 0 : phase === 'show' ? 1 : 0,
      transform: phase === 'enter' ? 'scale(0.95)' : phase === 'show' ? 'scale(1)' : 'scale(1.03)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
      pointerEvents: 'none',
    }}>
      {/* Sparkle Loader */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px' }}>
        <ARIALoader />
      </div>

      {/* ARIA Title */}
      <h2 style={{
        color: textColor,
        fontSize: '22px',
        fontWeight: '700',
        letterSpacing: '3px',
        marginBottom: '8px',
        marginTop: 0,
      }}>
        ARIA
      </h2>

      {/* Subtitle */}
      <p style={{
        color: subColor,
        fontSize: '13px',
        letterSpacing: '1px',
        margin: 0,
      }}>
        Your work assistant is ready
      </p>

      {/* Dots */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '20px' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: dotColor,
            animation: 'dotBounce 1.2s ease infinite',
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
    </div>
  );
};

// ── Main ChatPanel ───────────────────────────────────────────────────────────
export default function ChatPanel() {
  const { user } = useAuth();
  const employeeId = user?.id;

  const [isOpen, setIsOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Record<string, boolean>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskTimes, setTaskTimes] = useState<Record<string, { start: string; end: string }>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Voice state — single variable controls everything
  const [blobMode, setBlobMode] = useState<'listening' | 'speaking' | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  // ── Speak (called only from voice flow + greeting) ───
  const speakText = async (text: string) => {
    try {
      setBlobMode('speaking');
      const response = await fetch('/api/aria/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio.current = audio;
      audio.onended = () => {
        setBlobMode(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch {
      setBlobMode(null);
    }
  };

  const stopSpeaking = () => {
    if (currentAudio.current) {
      currentAudio.current.pause();
      currentAudio.current.currentTime = 0;
      currentAudio.current = null;
    }
    setBlobMode(null);
  };

  const shouldTriggerGreeting = useRef(false);

  // ── Greeting — once per day on first user interaction ──
  useEffect(() => {
    const today = new Date().toDateString();
    if (localStorage.getItem('aria_greeted_today') === today) return;

    const handleUserInteraction = () => {
      shouldTriggerGreeting.current = true;
      handleOpen();
      window.removeEventListener('click', handleUserInteraction);
    };

    window.addEventListener('click', handleUserInteraction);
    return () => {
      window.removeEventListener('click', handleUserInteraction);
    };
  }, [user]);

  // Trigger greeting when chat pane is fully ready after intro
  useEffect(() => {
    if (!chatReady || !shouldTriggerGreeting.current) return;
    shouldTriggerGreeting.current = false;

    const triggerGreeting = async () => {
      try {
        const today = new Date().toDateString();
        const hour = new Date().getHours();
        const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

        const { text } = await fetch('/api/aria/greet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeName: user?.name?.split(' ')[0] || '',
            dueTaskCount: 0,
            timeOfDay
          })
        }).then(r => r.json());

        // text bubble first
        setMessages((prev) => [
          ...prev,
          { id: Math.random().toString(), role: 'assistant', content: text }
        ]);

        // voice simultaneously — no await
        speakText(text);

        localStorage.setItem('aria_greeted_today', today);
      } catch (err) {
        console.error('Greeting error:', err);
      }
    };

    triggerGreeting();
  }, [chatReady]);

  const toggleRecording = async () => {
    stopSpeaking();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // ── Mic button clicked → start recording ─────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';

      mediaRecorder.current = new MediaRecorder(stream, { mimeType });
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      mediaRecorder.current.start();
      setIsRecording(true);
      setBlobMode('listening');
    } catch {
      console.error('Mic access denied');
    }
  };

  // ── Tap blob or cancel → stop and process ────────────
  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.stop();
    setIsRecording(false);
    setBlobMode(null);

    mediaRecorder.current.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');

        // transcribe
        const { text: transcribed } = await fetch('/api/aria/transcribe', {
          method: 'POST',
          body: formData
        }).then(r => r.json());

        if (!transcribed?.trim()) return;

        // Send directly to ARIA — no input box filling
        sendMessage(transcribed, undefined, true);
      } catch (err) {
        console.error('Voice error:', err);
        setBlobMode(null);
      }
    };
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load all sessions for this employee
  const loadSessions = async () => {
    if (!employeeId) return;
    try {
      const res = await fetch(`/api/chat-sessions/${employeeId}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  };

  // Save current conversation to DB
  const saveCurrentSession = async (msgs: any[]) => {
    if (!employeeId || msgs.length === 0) return;
    try {
      setSavingSession(true);
      const firstUserMsg = msgs.find((m) => m.role === "user")?.content || "New Chat";
      const autoTitle = firstUserMsg.slice(0, 60);
      const res = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          sessionId: currentSessionId,
          title: autoTitle,
          messages: msgs,
        }),
      });
      const data = await res.json();
      if (data.sessionId && !currentSessionId) {
        setCurrentSessionId(data.sessionId);
      }
      await loadSessions();
      return data.sessionId || currentSessionId;
    } catch (err) {
      console.error("Failed to save session:", err);
    } finally {
      setSavingSession(false);
    }
  };

  // Start a brand new chat
  const startNewChat = async () => {
    // Save current conversation first
    if (messages.length > 0) {
      await saveCurrentSession(messages);
    }
    // Reset to fresh state
    setMessages([]);
    setCurrentSessionId(null);
    setShowSidebar(false);
  };

  // Open a past session
  const openSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat-sessions/${employeeId}/${sessionId}`);
      const data = await res.json();
      setMessages(data.messages || []);
      setCurrentSessionId(sessionId);
      setShowSidebar(false);
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  };

  // Delete a session
  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/chat-sessions/${employeeId}/${sessionId}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  useEffect(() => {
    if (isOpen && employeeId) {
      loadSessions();
    }
  }, [isOpen, employeeId]);

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!user) return null;

  function handleOpen() {
    setIsOpen(true);
    setShowIntro(true);
    setChatReady(false);
  }

  function handleClose() {
    stopSpeaking();
    setIsOpen(false);
    setShowIntro(false);
    setChatReady(false);
  }

  function handleIntroEnd() {
    setShowIntro(false);
    setChatReady(true);
  }

  // ── Theme tokens ─────────────────────────────────────────────────────────
  const t = isDark ? {
    panel: '#0d0d1a',
    header: 'linear-gradient(135deg,#4c1d95,#312e81)',
    headerBorder: '#4c1d95',
    msgArea: '#0d0d1a',
    userBubble: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    userText: '#ffffff',
    botBubble: '#1a1a2e',
    botBorder: '#2d2b55',
    botText: '#e2e0ff',
    inputBg: '#1a1a2e',
    inputBorder: '#2d2b55',
    inputText: '#e2e0ff',
    inputPlaceholder: '#6b6890',
    footerBg: '#0d0d1a',
    footerBorder: '#1f1d3a',
    suggestionBg: '#1a1a2e',
    suggestionBorder: '#2d2b55',
    subText: '#7c6fcd',
    nameText: '#c4b5fd',
    scrollThumb: '#2d2b55',
  } : {
    panel: '#ffffff',
    header: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    headerBorder: '#7c3aed',
    msgArea: '#fafafa',
    userBubble: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    userText: '#ffffff',
    botBubble: '#f0efff',
    botBorder: '#ddd6fe',
    botText: '#3730a3',
    inputBg: '#f0efff',
    inputBorder: '#ddd6fe',
    inputText: '#3730a3',
    inputPlaceholder: '#a5a0d4',
    footerBg: '#f8f7ff',
    footerBorder: '#ede9fe',
    suggestionBg: '#f0efff',
    suggestionBorder: '#ddd6fe',
    subText: '#6d5acd',
    nameText: '#4f46e5',
    scrollThumb: '#ddd6fe',
  };

  const sendMessage = async (text: string, displayText?: string, speakOnDone = false) => {
    stopSpeaking();
    if (!text.trim()) return;

    const userMsgId = Math.random().toString();
    const assistantMsgId = Math.random().toString();
    let assistantText = '';

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user' as const, content: displayText || text },
      { id: assistantMsgId, role: 'assistant' as const, content: '' }
    ]);
    setInput('');
    setLoading(true);

    const chatHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: chatHistory,
          employeeId: user.id,
          employeeCode: user.employeeCode,
          role: user.role,
          department: user.department,
          employeeName: user.name,
        }),
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      let sseBuffer = '';
      const decoder = new TextDecoder();
      let spoke = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // Split on double newline (SSE event separator)
        const parts = sseBuffer.split('\n\n');
        // Keep last incomplete part in buffer
        sseBuffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.substring(6).trim();
          if (!jsonStr) continue;

          let data: any;
          try {
            data = JSON.parse(jsonStr);
          } catch (err) {
            console.error('[SSE] JSON parse error:', err, 'Raw:', jsonStr.substring(0, 100));
            continue;
          }

          console.log('[SSE] chunk received:', data.type);

          if (data.type === 'full_text') {
            if (speakOnDone && !spoke) {
              spoke = true;
              speakText(data.content);
            }
          } else if (data.type === 'text') {
            assistantText += data.content || '';
            setMessages(prev =>
              prev.map(m => m.id === assistantMsgId ? { ...m, content: assistantText } : m)
            );
          } else if (data.type === 'interactive_task_plan') {
            setMessages(prev =>
              prev.map(m => m.id === assistantMsgId ? { ...m, tasks: data.tasks } : m)
            );
          } else if (data.type === 'action_executed') {
            // handle action feedback if needed
          }
        }
      }

      // Process any remaining buffer content at stream end
      if (sseBuffer.startsWith('data: ')) {
        const jsonStr = sseBuffer.substring(6).trim();
        if (jsonStr) {
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'full_text') {
              if (speakOnDone && !spoke) {
                spoke = true;
                speakText(data.content);
              }
            } else if (data.type === 'text') {
              assistantText += data.content || '';
              setMessages(prev =>
                prev.map(m => m.id === assistantMsgId ? { ...m, content: assistantText } : m)
              );
            } else if (data.type === 'interactive_task_plan') {
              setMessages(prev =>
                prev.map(m => m.id === assistantMsgId ? { ...m, tasks: data.tasks } : m)
              );
            }
          } catch { }
        }
      }

      // Auto-save session after successful stream completion
      const finalMessages = [
        ...messages,
        { id: userMsgId, role: 'user' as const, content: displayText || text },
        { id: assistantMsgId, role: 'assistant' as const, content: assistantText }
      ];
      await saveCurrentSession(finalMessages);

      if (speakOnDone && assistantText && !spoke) {
        speakText(assistantText);
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, {
        id: Math.random().toString(),
        role: 'assistant',
        content: `⚠️ Failed to fetch response: ${error.message}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
  };

  const handleToggleTask = (taskId: string) => {
    setSelectedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleSubmitDailyPlan = async (messageId: string, projects: ProjectTaskSelection[]) => {
    const selected = projects.filter((p) => selectedTasks[p.id]);
    if (selected.length === 0) return;
    try {
      const payload = {
        employeeId: user.id,
        date: new Date().toISOString().split('T')[0],
        tasks: selected.map((s) => ({
          taskId: s.id,
          projectName: s.project_name,
          taskName: `${s.project_code} Daily Task`,
        })),
      };
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, content: `${m.content}\n\n✅ Daily Plan Created Successfully!`, planSubmitted: true }
              : m
          )
        );
      } else {
        alert('Failed to submit daily plan.');
      }
    } catch (err: any) {
      alert(`Error submitting plan: ${err.message}`);
    }
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const styles = `
    @keyframes slideUp {
      from { opacity:0; transform:translateY(10px); }
      to   { opacity:1; transform:translateY(0); }
    }
    @keyframes panelIn {
      from { opacity:0; transform:translateY(16px) scale(0.97); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes dotBounce {
      0%,80%,100% { transform:translateY(0); opacity:0.4; }
      40%          { transform:translateY(-5px); opacity:1; }
    }
    .aria-msg { animation: slideUp 0.25s ease forwards; }
    .aria-panel { animation: panelIn 0.3s cubic-bezier(.22,1,.36,1) forwards; }
    .aria-scroll::-webkit-scrollbar { width:4px; }
    .aria-scroll::-webkit-scrollbar-track { background:transparent; }
    .aria-scroll::-webkit-scrollbar-thumb { background:${t.scrollThumb}; border-radius:99px; }
    .aria-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#7c3aed; margin:0 2px; }
    .aria-dot:nth-child(1){animation:dotBounce 1.2s .0s infinite}
    .aria-dot:nth-child(2){animation:dotBounce 1.2s .2s infinite}
    .aria-dot:nth-child(3){animation:dotBounce 1.2s .4s infinite}
    .aria-btn:hover { opacity:0.85; }
    .aria-send:not(:disabled):hover { transform:scale(1.05); }
    .aria-send { transition:transform .15s ease; }
  `;

  return (
    <>
      <style>{styles}</style>
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>

        {/* ── Chat Panel ── */}
        {isOpen && (
          <div
            className="aria-panel"
            style={{
              marginBottom: '16px', width: '360px', height: '480px',
              borderRadius: '16px', overflow: 'hidden', position: 'relative',
              background: t.panel,
              border: `1px solid ${t.botBorder}`,
              boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column',
            }}
          >


            {/* Intro overlay */}
            {showIntro && <IntroScreen onDone={handleIntroEnd} isDark={isDark} />}

            {/* Sidebar / Chat History overlay */}
            {showSidebar && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: t.panel,
                borderRadius: '16px',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                padding: '12px',
                border: `1px solid ${t.botBorder}`,
              }}>
                {/* ── Header ────────────────────────────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <button
                    onClick={() => setShowSidebar(false)}
                    style={{ background: 'none', border: 'none', color: t.subText, cursor: 'pointer', fontSize: '18px', padding: '4px' }}
                  >
                    ←
                  </button>
                  <span style={{ color: t.nameText, fontWeight: 600, fontSize: '14px' }}>Chat History</span>
                  <button
                    onClick={startNewChat}
                    style={{
                      marginLeft: 'auto',
                      background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    + New Chat
                  </button>
                </div>

                {/* ── Search ────────────────────────────────────────── */}
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${t.inputBorder}`,
                    background: t.inputBg,
                    color: t.inputText,
                    fontSize: '12px',
                    marginBottom: '10px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />

                {/* ── Session List ───────────────────────────────────── */}
                <div className="aria-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {filteredSessions.length === 0 ? (
                    <div style={{ color: t.subText, fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                      No chats found
                    </div>
                  ) : (
                    filteredSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => openSession(session.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          background: currentSessionId === session.id ? 'rgba(124,58,237,0.15)' : t.suggestionBg,
                          border: `1px solid ${currentSessionId === session.id ? '#7c3aed' : t.suggestionBorder}`,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            color: t.botText,
                            fontSize: '12px',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {session.title}
                          </div>
                          <div style={{ color: t.subText, fontSize: '10px', marginTop: '2px' }}>
                            {new Date(session.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteSession(session.id, e)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: t.subText,
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '2px 4px',
                            flexShrink: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── Header ── */}
            <div style={{
              background: t.header,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* History / sidebar toggle button (left side) */}
                <button
                  onClick={() => setShowSidebar(true)}
                  title="Chat History"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  ☰
                </button>

                {/* ARIA avatar */}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '15px',
                }}>
                  🤖
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff', lineHeight: '1.2' }}>ARIA</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', lineHeight: '1.2' }}>Your work assistant</div>
                </div>
                {/* Online dot */}
                <div style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: '#4ade80',
                  boxShadow: '0 0 6px #4ade80',
                }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* New chat button */}
                <button
                  onClick={startNewChat}
                  title="New Chat"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: '20px',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    fontWeight: 300,
                  }}
                >
                  +
                </button>

                {/* Dark/Light toggle */}
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="aria-btn"
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white', transition: 'background .2s',
                  }}
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDark
                    ? <Sun style={{ width: '14px', height: '14px' }} />
                    : <Moon style={{ width: '14px', height: '14px' }} />
                  }
                </button>

                {/* Close */}
                <button
                  onClick={handleClose}
                  className="aria-btn"
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white',
                  }}
                >
                  <X style={{ width: '14px', height: '14px' }} />
                </button>
              </div>
            </div>

            {/* Wrap message area + blob together */}
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* ── Messages ── */}
              <div
                className="aria-scroll"
                style={{
                  flex: 1, overflowY: 'auto', padding: '16px',
                  display: 'flex', flexDirection: 'column', gap: '12px',
                  background: t.msgArea,
                }}
              >
                {/* Empty state */}
                {chatReady && messages.length === 0 && (
                  <div className="aria-msg" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100%', textAlign: 'center', padding: '0 16px',
                  }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>👋</div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: t.nameText, marginBottom: '4px' }}>
                      Hello, {user.name}!
                    </div>
                    <div style={{ fontSize: '12px', color: t.subText, marginBottom: '16px' }}>
                      I'm ARIA. What can I help you with today?
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                      {[
                        '📋 What are my assigned tasks?',
                        '🕐 Show me my timesheet for today',
                        '🌴 Do I have any pending leaves?',
                        ...(['manager', 'admin', 'hr'].includes(user.role) ? ['👥 Show all pending leave requests'] : []),
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => { setInput(s.slice(3).trim()); }}
                          style={{
                            background: t.suggestionBg,
                            border: `1px solid ${t.suggestionBorder}`,
                            borderRadius: '10px', padding: '8px 12px',
                            fontSize: '12px', color: t.botText,
                            textAlign: 'left', cursor: 'pointer',
                            transition: 'opacity .15s',
                          }}
                          className="aria-btn"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className="aria-msg"
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {/* Bot avatar row */}
                    {m.role === 'assistant' && (
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', maxWidth: '85%' }}>
                        <div style={{
                          width: '24px', height: '24px', borderRadius: '50%',
                          background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', flexShrink: 0,
                        }}>🤖</div>
                        <div style={{
                          background: t.botBubble,
                          border: `1px solid ${t.botBorder}`,
                          color: t.botText,
                          borderRadius: '16px 16px 16px 4px',
                          padding: '8px 12px', fontSize: '13px',
                          lineHeight: '1.5', whiteSpace: 'pre-wrap',
                          minHeight: m.content === '' ? '40px' : 'auto',
                          display: 'flex', alignItems: 'center',
                        }}>
                          {m.content === '' && loading ? (
                            <><span className="aria-dot" /><span className="aria-dot" /><span className="aria-dot" /></>
                          ) : (
                            <div style={{ width: '100%' }}>
                              <ReactMarkdown
                                components={{
                                  p: ({ node, ...props }) => <p style={{ margin: 0, padding: 0 }} {...props} />,
                                  ul: ({ node, ...props }) => <ul style={{ margin: '4px 0', paddingLeft: '20px', listStyleType: 'disc' }} {...props} />,
                                  ol: ({ node, ...props }) => <ol style={{ margin: '4px 0', paddingLeft: '20px', listStyleType: 'decimal' }} {...props} />,
                                  li: ({ node, ...props }) => <li style={{ margin: '2px 0' }} {...props} />,
                                }}
                              >
                                {m.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* User bubble */}
                    {m.role === 'user' && (
                      <div style={{
                        background: t.userBubble,
                        color: t.userText,
                        borderRadius: '16px 16px 4px 16px',
                        padding: '8px 12px', fontSize: '13px',
                        lineHeight: '1.5', whiteSpace: 'pre-wrap',
                        maxWidth: '85%',
                      }}>
                        {m.content}
                      </div>
                    )}

                    {m.role === 'assistant' && m.tasks && m.tasks.length > 0 && !m.planSubmitted && (
                      <div style={{
                        marginTop: '10px',
                        border: '0.5px solid #534AB7',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        width: '100%',
                      }}>
                        <div style={{
                          padding: '10px 12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#a78bfa',
                          borderBottom: '0.5px solid #3a2d6e',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}>
                          ☑ Select tasks for today's plan
                        </div>

                        <div style={{
                          maxHeight: '300px',
                          overflowY: 'auto',
                          padding: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}>
                          {m.tasks.map((task: any) => {
                            const isSelected = selectedTaskIds.includes(task.id);
                            const times = taskTimes[task.id] || { start: '09:00', end: '10:00' };
                            const isHigh = task.priority && task.priority.toLowerCase() === 'high';
                            const priorityText = task.priority ? (task.priority.charAt(0).toUpperCase() + task.priority.slice(1).toLowerCase()) : 'Medium';

                            return (
                              <div
                                key={task.id}
                                style={{
                                  borderRadius: '8px',
                                  padding: '9px 10px',
                                  border: `0.5px solid ${isSelected ? '#7c3aed' : '#2d2d3a'}`,
                                  background: isSelected ? '#1a1233' : 'transparent',
                                  transition: 'all 0.15s',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedTaskIds(prev =>
                                        isSelected ? prev.filter(id => id !== task.id) : [...prev, task.id]
                                      );
                                      if (!isSelected) {
                                        // Auto-set start time from previous task end time
                                        const allSelected = [...selectedTaskIds];
                                        const lastId = allSelected[allSelected.length - 1];
                                        const lastEnd = lastId ? (taskTimes[lastId]?.end || '09:00') : '09:00';
                                        const [h, min] = lastEnd.split(':').map(Number);
                                        const newEnd = `${String((h + 1) % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
                                        setTaskTimes(prev => ({
                                          ...prev,
                                          [task.id]: { start: lastEnd, end: newEnd },
                                        }));
                                      }
                                    }}
                                    style={{ width: '15px', height: '15px', accentColor: '#7c3aed', cursor: 'pointer' }}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#fff', wordBreak: 'break-word' }}>
                                      {task.task_name}
                                    </div>
                                    <div style={{ fontSize: '11px', color: '#888' }}>{task.project_name}</div>
                                  </div>
                                  <span style={{
                                    fontSize: '10px',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    background: isHigh ? '#450a0a' : '#172554',
                                    color: isHigh ? '#fca5a5' : '#93c5fd',
                                    flexShrink: 0,
                                  }}>
                                    {task.priority ? (task.priority.charAt(0).toUpperCase() + task.priority.slice(1).toLowerCase()) : 'Medium'}
                                  </span>
                                  <span style={{ fontSize: '10px', color: '#555', flexShrink: 0 }}>{task.end_date}</span>
                                </div>

                                {isSelected && (
                                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '11px', color: '#888' }}>Start</span>
                                    <input
                                      type="time"
                                      value={times.start}
                                      onChange={e => setTaskTimes(prev => ({
                                        ...prev,
                                        [task.id]: { ...times, start: e.target.value },
                                      }))}
                                      style={{ padding: '3px 6px', borderRadius: '4px', border: '0.5px solid #444', background: '#0f0f1a', color: '#fff', fontSize: '12px' }}
                                    />
                                    <span style={{ fontSize: '11px', color: '#888' }}>End</span>
                                    <input
                                      type="time"
                                      value={times.end}
                                      onChange={e => setTaskTimes(prev => ({
                                        ...prev,
                                        [task.id]: { ...times, end: e.target.value },
                                      }))}
                                      style={{ padding: '3px 6px', borderRadius: '4px', border: '0.5px solid #444', background: '#0f0f1a', color: '#fff', fontSize: '12px' }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div style={{ padding: '10px 12px', borderTop: '0.5px solid #2d2d3a' }}>
                          <button
                            onClick={() => {
                              const selected = selectedTaskIds.map(id => {
                                const task = m.tasks!.find((t: any) => t.id === id);
                                const times = taskTimes[id] || { start: '', end: '' };
                                return {
                                  id: task.id,
                                  task_name: task.task_name,
                                  projectName: task.project_name,
                                  source: 'PMS',
                                  isLocked: false,
                                  startTime: times.start || null,
                                  endTime: times.end || null,
                                };
                              });

                              const unselected = m.tasks!
                                .filter((t: any) => !selectedTaskIds.includes(t.id))
                                .map((t: any) => ({
                                  taskId: t.id,
                                  taskName: t.task_name,
                                  reason: 'Postponed via ARIA plan selector widget',
                                  newDueDate: t.end_date || new Date().toISOString().split('T')[0],
                                }));

                              if (selected.length === 0) {
                                alert('Please select at least one task.');
                                return;
                              }

                              // Mark widget as submitted
                              setMessages(prev =>
                                prev.map(msg => msg.id === m.id ? { ...msg, planSubmitted: true } : msg)
                              );

                              // Reset state
                              setSelectedTaskIds([]);
                              setTaskTimes({});

                              // Send structured message back to ARIA
                              const payload = JSON.stringify({ selectedTasks: selected, unselectedTasks: unselected });
                              sendMessage(
                                `I have selected these tasks for my daily plan today. Please show me a summary and ask for my confirmation before submitting: ${payload}`,
                                `📋 Submitting daily plan with ${selected.length} task${selected.length > 1 ? 's' : ''}...`
                              );
                            }}
                            style={{
                              width: '100%',
                              padding: '9px',
                              background: selectedTaskIds.length > 0 ? '#534AB7' : '#2d2b3e',
                              color: selectedTaskIds.length > 0 ? '#fff' : '#666',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: selectedTaskIds.length > 0 ? 'pointer' : 'not-allowed',
                              transition: 'all 0.15s',
                            }}
                          >
                            {selectedTaskIds.length > 0
                              ? `Submit Plan (${selectedTaskIds.length} task${selectedTaskIds.length > 1 ? 's' : ''})`
                              : 'Select tasks above'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Daily plan selector */}
                    {m.projects && m.projects.length > 0 && !m.planSubmitted && (
                      <div style={{
                        marginTop: '8px', width: '100%',
                        background: t.botBubble,
                        border: `1px solid ${t.botBorder}`,
                        borderRadius: '12px', padding: '12px',
                      }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#a78bfa', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <ListTodo style={{ width: '14px', height: '14px' }} />
                          Select projects for your daily plan:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                          {m.projects.map((proj) => (
                            <div
                              key={proj.id}
                              onClick={() => handleToggleTask(proj.id)}
                              style={{
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                                background: selectedTasks[proj.id] ? 'rgba(124,58,237,0.15)' : t.suggestionBg,
                                border: `1px solid ${selectedTasks[proj.id] ? '#7c3aed' : t.suggestionBorder}`,
                                fontSize: '12px', transition: 'all .15s',
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: '500', color: t.botText }}>{proj.project_name}</div>
                                <div style={{ fontSize: '10px', color: t.subText }}>{proj.project_code} • {proj.progress}%</div>
                              </div>
                              <div style={{
                                width: '16px', height: '16px', borderRadius: '4px',
                                border: `1.5px solid ${selectedTasks[proj.id] ? '#7c3aed' : t.suggestionBorder}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                {selectedTasks[proj.id] && <Check style={{ width: '10px', height: '10px', color: '#7c3aed' }} />}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => handleSubmitDailyPlan(m.id, m.projects!)}
                          style={{
                            marginTop: '10px', width: '100%', padding: '8px',
                            background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                            border: 'none', borderRadius: '8px',
                            color: 'white', fontSize: '12px', fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Create Daily Plan
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Standalone loading indicator (when no empty bubble yet) */}
                {loading && messages[messages.length - 1]?.role === 'user' && (
                  <div className="aria-msg" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
                    }}>🤖</div>
                    <div style={{
                      background: t.botBubble, border: `1px solid ${t.botBorder}`,
                      borderRadius: '16px 16px 16px 4px', padding: '8px 12px',
                    }}>
                      <ARIALoader />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Blob overlay — appears only when mic is active */}
              {blobMode && (
                <VoiceBlob
                  mode={blobMode}
                  onStop={blobMode === 'listening' ? stopRecording : stopSpeaking}
                />
              )}
            </div>

            {/* ── Input ── */}
            {/* Input bar */}
            <div
              className="input-bar"
              style={{
                borderTop: `1px solid ${t.footerBorder}`,
                padding: '12px', background: t.footerBg,
                display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0,
              }}
            >
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend(e)}
                placeholder="Ask ARIA anything..."
                style={{
                  flex: 1, height: '38px', borderRadius: '10px',
                  background: t.inputBg,
                  border: `1px solid ${t.inputBorder}`,
                  color: t.inputText, fontSize: '13px',
                  padding: '0 12px', outline: 'none',
                }}
              />

              {blobMode === 'speaking' && (
                <button
                  onClick={stopSpeaking}
                  title="Stop speaking"
                  style={{
                    width: '38px', height: '38px',
                    borderRadius: '50%',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1.5px solid rgba(239,68,68,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0
                  }}
                >
                  <span style={{ fontSize: '10px', color: '#ff4444' }}>⏹</span>
                </button>
              )}

              {/* Mic button — right side */}
              <button
                onClick={toggleRecording}
                aria-label="Voice input"
                style={{
                  width: '38px', height: '38px',
                  borderRadius: '50%',
                  background: isRecording ? 'rgba(239,68,68,0.1)' : 'rgba(29,158,117,0.1)',
                  border: isRecording ? '1.5px solid rgba(239,68,68,0.4)' : '1.5px solid rgba(29,158,117,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0
                }}
              >
                <Mic style={{ width: '18px', height: '18px', color: isRecording ? '#ff4444' : '#1D9E75' }} />
              </button>

              {/* Send button */}
              <button
                onClick={() => handleSend()}
                style={{
                  width: '38px', height: '38px',
                  borderRadius: '50%',
                  background: '#1D9E75',
                  border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0
                }}
              >
                <Send style={{ width: '15px', height: '15px', color: '#fff' }} />
              </button>
            </div>
          </div>
        )}

        {/* ── FAB ── */}
        <button
          onClick={isOpen ? handleClose : handleOpen}
          style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
            border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,58,237,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform .2s, box-shadow .2s',
            color: 'white',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(124,58,237,0.6)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(124,58,237,0.5)'; }}
        >
          {isOpen
            ? <X style={{ width: '22px', height: '22px' }} />
            : <Sparkles style={{ width: '22px', height: '22px' }} />
          }
        </button>
      </div>
    </>
  );
}
