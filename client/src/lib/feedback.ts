// Lightweight, zero-dependency feedback utilities: sounds, confetti, emoji pop
type SoundKind = 'select' | 'submit' | 'confirm' | 'error' | 'hurray' | 'wow';

// Shared AudioContext to reduce latency on repeated sounds
let sharedCtx: AudioContext | null = null;
function getCtx() {
  if (!sharedCtx) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) sharedCtx = new AudioCtx();
  }
  return sharedCtx;
}

// variant: optional numeric variant to slightly change pitch for repeated selects
export function playSound(kind: SoundKind = 'select', variant?: number) {
  try {
    const ctx = getCtx();
    if (!ctx) return;

    // Resume context if suspended (common in browser power-saving/policy)
    if (ctx.state === 'suspended') ctx.resume();

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.0001;

    const now = ctx.currentTime;
    let duration = 0.2;

    // Set tone based on kind
    let baseFreq = 440;
    switch (kind) {
      case 'select':
        baseFreq = 880;
        break;
      case 'submit':
        baseFreq = 440;
        break;
      case 'confirm':
        baseFreq = 660;
        break;
      case 'error':
        baseFreq = 220;
        break;
      case 'hurray':
        // Arpeggio-like sequence
        baseFreq = 523.25; // C5
        o.frequency.setValueAtTime(523.25, now);
        o.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
        o.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
        o.frequency.exponentialRampToValueAtTime(1046.50, now + 0.3); // C6
        duration = 0.4;
        break;
      case 'wow':
        // Slide up
        baseFreq = 392.00; // G4
        o.frequency.setValueAtTime(392.00, now);
        o.frequency.exponentialRampToValueAtTime(1174.66, now + 0.25); // D6
        duration = 0.3;
        break;
    }

    // Apply small variant offsets if provided (keeps same family but different pitch)
    if (typeof variant === 'number' && kind !== 'hurray' && kind !== 'wow') {
      const offset = ((variant % 5) - 2) * 60; // -120, -60, 0, 60, 120
      o.frequency.value = Math.max(80, baseFreq + offset);
    } else if (kind !== 'hurray' && kind !== 'wow') {
      o.frequency.value = baseFreq;
    }

    o.type = (kind === 'hurray' || kind === 'wow') ? 'triangle' : 'sine';
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    o.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration - 0.02);
    o.stop(now + duration);
  } catch (e) {
    // silent fail
  }
}

export function popEmoji(target?: HTMLElement | null, emoji = '✨') {
  try {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.style.position = 'fixed';
    span.style.zIndex = '9999';
    span.style.fontSize = '22px';
    span.style.pointerEvents = 'none';
    span.style.transition = 'transform 600ms cubic-bezier(.2,.9,.2,1), opacity 600ms';
    span.style.opacity = '1';

    const rect = target ? target.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const x = rect.left + (rect.width / 2) - 12;
    const y = rect.top + (rect.height / 2) - 12;
    span.style.left = `${Math.max(8, Math.min(window.innerWidth - 32, x))}px`;
    span.style.top = `${Math.max(8, Math.min(window.innerHeight - 32, y))}px`;

    document.body.appendChild(span);
    requestAnimationFrame(() => {
      span.style.transform = 'translateY(-36px) scale(1.6) rotate(-8deg)';
      span.style.opacity = '0';
    });
    setTimeout(() => { try { span.remove(); } catch { } }, 700);
  } catch (e) { }
}

// Very small confetti effect implemented with canvas
export function confettiBurst() {
  try {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9998';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    const dpi = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpi;
    canvas.height = window.innerHeight * dpi;
    ctx.scale(dpi, dpi);

    const colors = ['#60a5fa', '#34d399', '#f472b6', '#f59e0b', '#a78bfa'];
    const particles: Array<any> = [];
    const count = 40;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
        y: window.innerHeight / 2 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 8 - 2,
        size: 6 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
      });
    }

    let last = performance.now();
    const frame = (now: number) => {
      if (!ctx) return;
      const dt = Math.min(40, now - last) / 16.666;
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p: any) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.35 * dt; // gravity
        p.rot += 0.2 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      // remove offscreen particles
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].y > window.innerHeight + 50) particles.splice(i, 1);
      }
      if (particles.length > 0) requestAnimationFrame(frame);
      else { try { canvas.remove(); } catch { } }
    }
    requestAnimationFrame(frame);
    // safety remove after 3s
    setTimeout(() => { try { canvas.remove(); } catch { } }, 3000);
  } catch (e) { }
}

export function speak(text: string, lang = 'en-US') {
  try {
    // Small set of contextual variations to avoid repetition for common prompts
    const variations: { match: RegExp; alternatives: string[] }[] = [
      {
        match: /numbers|how many|how much/i, alternatives: [
          "Tell me how many — just the number is fine.",
          "How many did you complete? Give me a number.",
          "Share the count — what number would you enter?",
          "Pop in the quantity you did — I'm listening."
        ]
      },
      {
        match: /blockers|problem/i, alternatives: [
          "Any blockers? Tell me what's stopping you.",
          "Facing any problems? I'm here to listen.",
          "Is anything blocking progress? Share it briefly.",
          "Tell me the issue and I'll note it down."
        ]
      },
      {
        match: /improv|better/i, alternatives: [
          "How could this be improved? One quick idea please.",
          "Any thoughts to make this better? Share one suggestion.",
          "A small improvement you'd like? Tell me one thing.",
          "Got a tweak in mind? Say one improvement."
        ]
      }
    ];

    // Choose alternative when appropriate to vary wording
    let chosenText = text;
    for (const v of variations) {
      if (v.match.test(text)) {
        const alt = v.alternatives[Math.floor(Math.random() * v.alternatives.length)];
        chosenText = alt;
        break;
      }
    }

    // Dispatch a DOM event so UI components (mascot) can react visually
    try { window.dispatchEvent(new CustomEvent('mascot:speak', { detail: { text: chosenText } })); } catch { }

    if (!('speechSynthesis' in window)) return;

    const speakInternal = () => {
      try { window.speechSynthesis.cancel(); } catch { }
      const utter = new SpeechSynthesisUtterance(chosenText);
      utter.lang = lang;

      // Pick a random available voice that matches language (if possible)
      try {
        const voices = window.speechSynthesis.getVoices() || [];
        const langMatches = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
        const pool = langMatches.length ? langMatches : voices.length ? voices : [];
        if (pool.length) {
          utter.voice = pool[Math.floor(Math.random() * pool.length)];
        }
      } catch (e) {
        // ignore voice selection errors
      }

      // Small randomization to make repeated utterances feel distinct
      utter.rate = 0.95 + Math.random() * 0.25; // 0.95 - 1.2
      utter.pitch = 0.9 + Math.random() * 0.5;  // 0.9 - 1.4

      window.speechSynthesis.speak(utter);
    };

    // getVoices may be async-populated in some browsers; try immediate then a short delay fallback
    speakInternal();
    setTimeout(() => {
      try {
        // re-run once in case voices arrived late
        if ((window.speechSynthesis.getVoices() || []).length) speakInternal();
      } catch { }
    }, 120);

  } catch (e) {
    // ignore
  }
}

export default { playSound, popEmoji, confettiBurst, speak };

// Warm-up speech voices once so the first speak() call is immediate
try {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    let warmed = false;
    const warm = () => {
      try {
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length) { warmed = true; return; }
        // speak a silent utterance to prompt voice loading (volume 0)
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.rate = 1;
        u.pitch = 1;
        window.speechSynthesis.speak(u);
        warmed = true;
      } catch (e) {
        // ignore
      }
    };

    // try immediately, and again shortly after voiceschanged
    warm();
    window.speechSynthesis.onvoiceschanged = () => { if (!warmed) warm(); };
    setTimeout(() => { if (!warmed) warm(); }, 300);
  }
} catch (e) {
  // ignore environment without window
}
