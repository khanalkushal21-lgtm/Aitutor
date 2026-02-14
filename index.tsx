
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  GoogleGenAI, 
  Modality, 
  LiveServerMessage, 
  GenerateContentResponse,
  Type,
  Chat
} from '@google/genai';
import { 
  Mic, 
  MessageSquare, 
  BookOpen, 
  BarChart3, 
  Settings, 
  Play, 
  Pause, 
  ArrowLeft, 
  Send,
  Zap,
  Award,
  ChevronRight,
  RefreshCw,
  Info,
  Volume2,
  BrainCircuit,
  PieChart,
  LineChart
} from 'lucide-react';

// --- Types & Constants ---
type Screen = 'home' | 'voice' | 'chat' | 'practice' | 'dashboard' | 'settings';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface UserStats {
  mastery: number; // 0-100
  streak: number;
  xp: number;
  studyTime: number; // minutes
  lastSessionDate: string;
}

const VOX_VOICE = 'Zephyr'; 
const CHAT_MODEL = 'gemini-3-flash-preview'; // Flash for speed
const PRO_MODEL = 'gemini-3-pro-preview'; // Pro for complex logic
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const SYSTEM_PROMPT = `You are EduSphere AI, a world-class tutor specializing in STEM and Management (Finance, Economics, Marketing, Strategy). 
        
RULES FOR RESPONSE:
1. FORMULAS: ALWAYS use LaTeX for math, physics, or finance formulas. 
   - Use $formula$ for inline math.
   - Use $$formula$$ for block-level math.
   - Example Finance: Net Present Value is $$NPV = \\sum_{t=1}^{n} \\frac{R_t}{(1+i)^t}$$.
   - Example Econ: Supply and Demand equilibrium where $Q_s = Q_d$.
2. PEDAGOGY: Be encouraging. Use the "Socratic method" - ask follow-up questions to test understanding.
3. CONTEXT: Remember the student's name if they give it, and their current learning topic.
4. MANAGEMENT: When teaching management, use real-world case studies (e.g., Apple, Tesla, or local small businesses).
5. TONE: Professional but approachable. Like a mentor at a top university.`;

// --- Utils ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Components ---

const MathRenderer: React.FC<{ content: string }> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && (window as any).katex) {
      const parts = content.split(/(\$\$.*?\$\$|\$.*?\$)/g);
      containerRef.current.innerHTML = '';
      
      parts.forEach(part => {
        const span = document.createElement('span');
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const formula = part.slice(2, -2);
          try {
            (window as any).katex.render(formula, span, { displayMode: true, throwOnError: false });
          } catch (e) { span.innerText = part; }
        } else if (part.startsWith('$') && part.endsWith('$')) {
          const formula = part.slice(1, -1);
          try {
            (window as any).katex.render(formula, span, { displayMode: false, throwOnError: false });
          } catch (e) { span.innerText = part; }
        } else {
          span.innerText = part;
        }
        containerRef.current?.appendChild(span);
      });
    }
  }, [content]);

  return <div ref={containerRef} className="math-container whitespace-pre-wrap leading-relaxed" />;
};

const Header: React.FC<{ screen: Screen; onBack: () => void; title: string; stats: UserStats }> = ({ screen, onBack, title, stats }) => (
  <header className="sticky top-0 z-50 flex items-center justify-between p-4 glass-panel border-b border-gray-200">
    <div className="flex items-center gap-3">
      {screen !== 'home' && (
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
        {screen === 'home' ? 'EduSphere AI' : title}
      </h1>
    </div>
    <div className="flex items-center gap-2">
      <div className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
        <Zap size={14} /> {stats.xp} XP
      </div>
    </div>
  </header>
);

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('home');
  // XP and Stats Reset to Zero
  const [stats, setStats] = useState<UserStats>({
    mastery: 0,
    streak: 0,
    xp: 0,
    studyTime: 0,
    lastSessionDate: new Date().toISOString()
  });

  const [chatMessages, setChatMessages] = useState<Message[]>([
    { role: 'model', text: 'Hello! I am your AI tutor. I can help you with Mathematics, Physics, Economics, Finance, or Management Strategy. What should we dive into first?' }
  ]);

  const renderScreen = () => {
    switch (screen) {
      case 'home': return <HomeScreen onNavigate={setScreen} stats={stats} />;
      case 'voice': return <VoiceTutor onBack={() => setScreen('home')} />;
      case 'chat': return <ChatTutor onBack={() => setScreen('home')} messages={chatMessages} setMessages={setChatMessages} updateXp={(val) => setStats(s => ({...s, xp: s.xp + val}))} />;
      case 'practice': return <PracticeMode onBack={() => setScreen('home')} updateXp={(val) => setStats(s => ({...s, xp: s.xp + val}))} />;
      case 'dashboard': return <Dashboard stats={stats} onBack={() => setScreen('home')} />;
      default: return <HomeScreen onNavigate={setScreen} stats={stats} />;
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 relative overflow-hidden flex flex-col shadow-2xl">
      {renderScreen()}
      
      {screen === 'home' && (
        <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto glass-panel border-t border-gray-200 flex justify-around p-3 pb-6">
          <button onClick={() => setScreen('home')} className={`flex flex-col items-center gap-1 ${screen === 'home' ? 'text-blue-600' : 'text-gray-400'}`}>
            <BookOpen size={20} />
            <span className="text-[10px] font-medium">Learn</span>
          </button>
          <button onClick={() => setScreen('practice')} className={`flex flex-col items-center gap-1 ${screen === 'practice' ? 'text-blue-600' : 'text-gray-400'}`}>
            <RefreshCw size={20} />
            <span className="text-[10px] font-medium">Practice</span>
          </button>
          <button onClick={() => setScreen('dashboard')} className={`flex flex-col items-center gap-1 ${screen === 'dashboard' ? 'text-blue-600' : 'text-gray-400'}`}>
            <BarChart3 size={20} />
            <span className="text-[10px] font-medium">Stats</span>
          </button>
          <button onClick={() => setScreen('settings')} className={`flex flex-col items-center gap-1 ${screen === 'settings' ? 'text-blue-600' : 'text-gray-400'}`}>
            <Settings size={20} />
            <span className="text-[10px] font-medium">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
};

// --- Home Screen ---
const HomeScreen: React.FC<{ onNavigate: (s: Screen) => void; stats: UserStats }> = ({ onNavigate, stats }) => {
  return (
    <>
      <Header screen="home" onBack={() => {}} title="" stats={stats} />
      <main className="p-4 flex-1 overflow-y-auto no-scrollbar pb-24">
        {/* Daily Progress Card */}
        <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-gray-500 text-sm font-medium">Current Mastery</p>
              <h2 className="text-3xl font-bold text-gray-800">{stats.mastery}%</h2>
            </div>
            <div className="h-16 w-16 bg-blue-50 rounded-full flex items-center justify-center border-4 border-blue-600 border-t-transparent -rotate-45">
              <span className="rotate-45 font-bold text-blue-600 text-sm">{stats.streak}d</span>
            </div>
          </div>
          <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
            <div className="bg-blue-600 h-full rounded-full transition-all duration-1000" style={{ width: `${stats.mastery}%` }} />
          </div>
          <p className="mt-3 text-xs text-gray-400">Welcome! Start your first lesson to build your streak.</p>
        </section>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button 
            onClick={() => onNavigate('voice')}
            className="flex flex-col items-center gap-3 p-6 bg-blue-600 text-white rounded-3xl shadow-lg shadow-blue-200 hover:scale-[0.98] transition-transform"
          >
            <div className="bg-white/20 p-3 rounded-2xl"><Mic size={24} /></div>
            <span className="font-semibold">Voice Tutor</span>
          </button>
          <button 
            onClick={() => onNavigate('chat')}
            className="flex flex-col items-center gap-3 p-6 bg-white text-gray-800 border border-gray-100 rounded-3xl shadow-sm hover:scale-[0.98] transition-transform"
          >
            <div className="bg-blue-50 p-3 rounded-2xl text-blue-600"><MessageSquare size={24} /></div>
            <span className="font-semibold">Chat Tutor</span>
          </button>
        </div>

        {/* Expanded Management Scope */}
        <section className="mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Focus Areas</h3>
          <div className="space-y-3">
            {[
              { title: 'Corporate Finance', tag: 'Management', color: 'bg-emerald-50', icon: <PieChart size={20} className="text-emerald-600" /> },
              { title: 'Economics: Elasticity', tag: 'Social Science', color: 'bg-orange-50', icon: <LineChart size={20} className="text-orange-600" /> },
              { title: 'Calculus: Derivatives', tag: 'STEM', color: 'bg-purple-50', icon: <BrainCircuit size={20} className="text-purple-600" /> },
            ].map((path, i) => (
              <button key={i} className="w-full flex items-center gap-4 p-4 bg-white rounded-2xl border border-gray-100 hover:bg-slate-50 transition-colors">
                <div className={`w-12 h-12 ${path.color} rounded-xl flex items-center justify-center font-bold text-lg`}>
                  {path.icon}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{path.tag}</p>
                  <h4 className="font-semibold text-gray-800">{path.title}</h4>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        </section>
      </main>
    </>
  );
};

// --- Voice Tutor ---
const VoiceTutor: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('Tap to start lesson');
  const [transcript, setTranscript] = useState('');

  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const startSession = async () => {
    try {
      setStatus('Connecting...');
      setIsActive(true);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        callbacks: {
          onopen: () => {
            setStatus('I am listening...');
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
              
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.outputTranscription) {
              setTranscript(prev => prev + ' ' + msg.serverContent!.outputTranscription!.text);
            }

            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => console.error('Live error', e),
          onclose: () => setIsActive(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOX_VOICE } },
          },
          outputAudioTranscription: {},
          systemInstruction: SYSTEM_PROMPT,
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setStatus('Connection failed');
      setIsActive(false);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setIsActive(false);
    setStatus('Tap to start lesson');
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-900 text-white p-6">
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => { stopSession(); onBack(); }} className="text-white/60 hover:text-white"><ArrowLeft /></button>
        <div className="bg-red-500/20 text-red-500 px-3 py-1 rounded-full text-xs font-bold animate-pulse">LIVE</div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <div className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 ${isActive ? 'bg-blue-600 shadow-[0_0_80px_rgba(37,99,235,0.4)]' : 'bg-slate-800'}`}>
          {isActive ? (
            <div className="voice-pulse w-32 h-32 bg-white/10 rounded-full flex items-center justify-center">
              <div className="w-16 h-16 bg-white rounded-full" />
            </div>
          ) : (
            <Mic size={48} className="text-slate-600" />
          )}
        </div>
        
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">{isActive ? 'Learning Session' : 'Ready to talk?'}</h2>
          <p className="text-blue-400 font-medium">{status}</p>
        </div>

        <div className="w-full max-h-32 overflow-y-auto bg-slate-800/50 p-4 rounded-2xl border border-slate-700 text-sm italic text-white/50 text-center">
          {transcript || "The AI's transcription will appear here..."}
        </div>
      </div>

      <div className="pb-8 flex justify-center gap-4">
        {!isActive ? (
          <button 
            onClick={startSession}
            className="bg-blue-600 hover:bg-blue-700 text-white w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <Play fill="white" size={20} /> Start Tutor
          </button>
        ) : (
          <button 
            onClick={stopSession}
            className="bg-white/10 hover:bg-white/20 text-white w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2"
          >
            <Pause fill="white" size={20} /> End Session
          </button>
        )}
      </div>
    </div>
  );
};

// --- Chat Tutor ---
const ChatTutor: React.FC<{ 
  onBack: () => void; 
  messages: Message[]; 
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  updateXp: (val: number) => void;
}> = ({ onBack, messages, setMessages, updateXp }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Persistent Chat Object for Fast Memory
  const chatRef = useRef<Chat | null>(null);

  useEffect(() => {
    if (!chatRef.current) {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      chatRef.current = ai.chats.create({
        model: CHAT_MODEL,
        config: { systemInstruction: SYSTEM_PROMPT }
      });
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading || !chatRef.current) return;
    const userMsg = input.trim();
    setInput('');
    
    // Add User Message
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    // Initial Empty AI Message for Streaming
    setMessages(prev => [...prev, { role: 'model', text: '' }]);

    try {
      const result = await chatRef.current.sendMessageStream({ message: userMsg });
      let fullResponse = '';

      for await (const chunk of result) {
        const text = chunk.text;
        fullResponse += text;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'model', text: fullResponse };
          return updated;
        });
      }
      updateXp(10); // Reward for engagement
    } catch (err) {
      console.error(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'model', text: "I encountered an error. Could you repeat that?" };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen">
      <header className="p-4 glass-panel border-b flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={20} /></button>
        <h2 className="font-bold">Fast Chat Tutor</h2>
      </header>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-100 text-gray-800'}`}>
              <MathRenderer content={msg.text} />
            </div>
          </div>
        ))}
        {loading && messages[messages.length-1].text === '' && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 p-4 rounded-2xl flex gap-1">
              <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-gray-100 pb-8">
        <div className="flex gap-2">
          <input 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="E.g. Explain NPV or Solve x^2-4=0"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <button 
            onClick={sendMessage}
            disabled={loading}
            className="bg-blue-600 text-white p-3 rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Practice Mode ---
const PracticeMode: React.FC<{ onBack: () => void; updateXp: (val: number) => void }> = ({ onBack, updateXp }) => {
  const [question, setQuestion] = useState<{ text: string; options?: string[]; answer: string; hint: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const generateQuestion = async () => {
    setLoading(true);
    setQuestion(null);
    setSelected(null);
    setShowAnswer(false);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: CHAT_MODEL,
        contents: [{ role: 'user', parts: [{ text: "Generate a high-school or university level question. It can be STEM or Management (Finance, Economics). Provide it in JSON: { text: string, options: string[], answerIndex: number, hint: string }. Include LaTeX for symbols." }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              answerIndex: { type: Type.NUMBER },
              hint: { type: Type.STRING }
            },
            required: ['text', 'options', 'answerIndex', 'hint']
          }
        }
      });
      
      const data = JSON.parse(response.text);
      setQuestion({
        text: data.text,
        options: data.options,
        answer: data.options[data.answerIndex],
        hint: data.hint
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { generateQuestion(); }, []);

  const handleCheck = () => {
    setShowAnswer(true);
    if (question && question.options && selected !== null && question.options[selected] === question.answer) {
      updateXp(25);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <header className="p-4 glass-panel border-b flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={20} /></button>
        <h2 className="font-bold">Challenge Mode</h2>
      </header>
      <main className="p-6 flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
            <RefreshCw className="animate-spin text-blue-500" size={32} />
            <p className="font-medium">Curating your next problem...</p>
          </div>
        ) : question ? (
          <div className="flex-1 flex flex-col">
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm mb-6">
              <MathRenderer content={question.text} />
            </div>

            <div className="space-y-3 flex-1">
              {question.options?.map((opt, i) => (
                <button 
                  key={i}
                  onClick={() => !showAnswer && setSelected(i)}
                  className={`w-full p-4 rounded-2xl border text-left transition-all ${
                    selected === i 
                      ? (showAnswer ? (opt === question.answer ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500') : 'bg-blue-50 border-blue-600 ring-2 ring-blue-600/10')
                      : 'bg-white border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <MathRenderer content={opt} />
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              {!showAnswer ? (
                <button 
                  disabled={selected === null}
                  onClick={handleCheck}
                  className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-blue-200 disabled:opacity-50"
                >
                  Verify Solution
                </button>
              ) : (
                <button 
                  onClick={generateQuestion}
                  className="w-full bg-slate-800 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
                >
                  Try Another <ChevronRight size={18} />
                </button>
              )}
              {showAnswer && (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex gap-3 text-orange-800 text-sm">
                  <Info size={18} className="shrink-0" />
                  <div>
                    <p className="font-bold mb-1">Key Concept:</p>
                    <MathRenderer content={question.hint} />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
};

// --- Dashboard ---
const Dashboard: React.FC<{ stats: UserStats; onBack: () => void }> = ({ stats, onBack }) => {
  return (
    <div className="flex-1 flex flex-col bg-slate-50">
       <header className="p-4 glass-panel border-b flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={20} /></button>
        <h2 className="font-bold">Growth Tracking</h2>
      </header>
      <main className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
            <div className="text-blue-600 mb-2"><Volume2 size={24} /></div>
            <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Learning Time</p>
            <h4 className="text-xl font-bold text-gray-800">0 min</h4>
          </div>
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
            <div className="text-orange-600 mb-2"><Award size={24} /></div>
            <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Current Streak</p>
            <h4 className="text-xl font-bold text-gray-800">{stats.streak} days</h4>
          </div>
        </div>

        <section className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Mastery per Domain</h3>
          <div className="space-y-4">
            {[
              { label: 'STEM Fundamentals', value: 0, color: 'bg-blue-500' },
              { label: 'Management Strategy', value: 0, color: 'bg-emerald-500' },
              { label: 'Finance & Econ', value: 0, color: 'bg-indigo-500' },
              { label: 'Problem Solving', value: 0, color: 'bg-orange-500' }
            ].map((subj, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-gray-600 uppercase tracking-tighter">{subj.label}</span>
                  <span className="text-gray-400">{subj.value}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full">
                  <div className={`h-full rounded-full ${subj.color} transition-all duration-1000`} style={{ width: `${subj.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-3xl text-white shadow-xl shadow-blue-200">
          <h3 className="font-bold mb-2">Learning Milestone</h3>
          <div className="flex items-end gap-2 mb-4">
            <span className="text-5xl font-black">{stats.xp}</span>
            <span className="text-white/60 font-bold mb-1">XP Points</span>
          </div>
          <p className="text-sm text-white/80 leading-relaxed">
            You've just started your journey! Complete lessons and practice problems to earn XP and unlock advanced management and science topics.
          </p>
        </section>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
