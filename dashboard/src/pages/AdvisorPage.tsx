import { useState, useEffect, useRef, useCallback } from 'react';
import { advisor, tts, type AdvisorThread, type AdvisorMessage, type AgentInfo, type ModelInfo } from '../lib/api';

const DEFAULT_AGENTS: AgentInfo[] = [
  { key: 'ceo', label: 'Arturo - CEO Strategist', color: '#5eead4', avatar: 'A', name: 'Arturo', bg_color: '#0a2e2e', voice_id: '' },
  { key: 'sales', label: 'Elena - Sales Expert', color: '#fbbf24', avatar: 'E', name: 'Elena', bg_color: '#2e2510', voice_id: '' },
  { key: 'architect', label: 'Miguel - Software Architect', color: '#a5b4fc', avatar: 'M', name: 'Miguel', bg_color: '#1e1b4b', voice_id: '' },
  { key: 'marketing', label: 'Valeria - Marketing Expert', color: '#fdba74', avatar: 'V', name: 'Valeria', bg_color: '#2e1a0a', voice_id: '' },
];

export default function AdvisorPage() {
  const [threads, setThreads] = useState<AdvisorThread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamAgent, setStreamAgent] = useState<AgentInfo | null>(null);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agents, setAgents] = useState<AgentInfo[]>(DEFAULT_AGENTS);
  const [forcedAgent, setForcedAgent] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [streamModelUsed, setStreamModelUsed] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Load agents + threads + models
  useEffect(() => {
    advisor.agents().then(setAgents).catch(() => setAgents(DEFAULT_AGENTS));
    advisor.threads().then(setThreads).catch(console.error);
    advisor.models().then(setAvailableModels).catch(() => {});
  }, []);

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!activeThread) { setMessages([]); return; }
    advisor.messages(activeThread).then(setMessages).catch(console.error);
  }, [activeThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const refreshThreads = useCallback(async () => {
    const t = await advisor.threads();
    setThreads(t);
  }, []);

  const createNewThread = async () => {
    const t = await advisor.createThread();
    setThreads((prev) => [t, ...prev]);
    setActiveThread(t.id);
    setMessages([]);
    setError('');
    inputRef.current?.focus();
  };

  const deleteThread = async (id: string) => {
    await advisor.deleteThread(id);
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThread === id) { setActiveThread(null); setMessages([]); }
  };

  const getAgentInfo = (role: string): AgentInfo => {
    return agents.find((a) => a.key === role) || agents[0];
  };

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageFile(file);
        return;
      }
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && !pendingImage) || streaming) return;

    let threadId = activeThread;

    if (!threadId) {
      const t = await advisor.createThread();
      setThreads((prev) => [t, ...prev]);
      setActiveThread(t.id);
      threadId = t.id;
    }

    const content = input.trim() || (pendingImage ? '[Imagen adjunta]' : '');
    const imageData = pendingImage || undefined;

    const userMsg: AdvisorMessage = {
      id: crypto.randomUUID(),
      thread_id: threadId,
      role: 'user',
      content,
      agent_role: '',
      created_at: Math.floor(Date.now() / 1000),
      image_data: imageData,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setPendingImage(null);
    setStreaming(true);
    setStreamText('');
    setStreamAgent(null);
    setStreamModelUsed('');
    setError('');

    try {
      const res = await advisor.send(threadId, content, forcedAgent || undefined, imageData, modelOverride || undefined);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let detectedAgent = '';
      let detectedModel = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            if (!raw) continue;
            try {
              const data = JSON.parse(raw);
              if (currentEvent === 'agent') {
                detectedAgent = data.role || '';
                setStreamAgent(data as AgentInfo);
              } else if (currentEvent === 'model') {
                detectedModel = data.model || '';
                setStreamModelUsed(detectedModel);
              } else if (data.text) {
                fullText += data.text;
                setStreamText(fullText);
              }
              if (data.model_used) detectedModel = data.model_used;
              if (data.error) setError(data.error);
            } catch { /* skip malformed */ }
          }
        }
      }

      if (fullText) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            thread_id: threadId!,
            role: 'assistant',
            content: fullText,
            agent_role: detectedAgent,
            created_at: Math.floor(Date.now() / 1000),
            model_used: detectedModel,
          },
        ]);
      }

      setStreamText('');
      setStreamAgent(null);
      refreshThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexion');
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeTitle = threads.find((t) => t.id === activeThread)?.title || '';

  return (
    <div className="flex h-[calc(100vh-80px)] -m-8 overflow-hidden">
      {/* Thread sidebar */}
      <div
        className={`flex flex-col border-r border-border bg-surface transition-all duration-200 ${
          sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-sm font-bold text-text-primary">Conversaciones</h2>
          <button
            onClick={createNewThread}
            className="text-accent hover:text-accent-dim transition-colors"
            title="Nuevo chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-border/50 transition-colors ${
                activeThread === t.id
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-secondary hover:bg-surface-overlay/50 hover:text-text-primary'
              }`}
              onClick={() => setActiveThread(t.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-display truncate">{t.title || 'Nuevo chat'}</p>
                <p className="text-xs text-text-muted truncate mt-0.5">{t.last_message?.slice(0, 50) || ''}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all p-1"
                title="Eliminar"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}

          {threads.length === 0 && (
            <div className="p-6 text-center text-text-muted text-sm">
              <p className="font-display mb-2">Sin conversaciones</p>
              <p className="text-xs">Crea una nueva para empezar</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface-raised/50">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-text-secondary hover:text-text-primary transition-colors"
            title="Toggle sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2={sidebarOpen ? '21' : '15'} y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="font-display text-sm font-bold text-text-primary">
              Equipo Advisor
            </span>
          </div>

          {activeTitle && (
            <span className="text-text-muted text-xs font-display truncate">
              / {activeTitle}
            </span>
          )}
        </div>

        {/* Agent selector */}
        <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50 bg-surface-base">
          <span className="text-[10px] text-text-muted font-display uppercase tracking-wider mr-1">Agente:</span>
          <button
            onClick={() => setForcedAgent(null)}
            className={`px-2.5 py-1 text-[11px] font-display rounded-md border transition-colors ${
              !forcedAgent
                ? 'border-accent/50 text-accent bg-accent/10'
                : 'border-border text-text-muted hover:text-text-primary'
            }`}
          >
            Auto
          </button>
          {agents.map((agent) => (
            <button
              key={agent.key}
              onClick={() => setForcedAgent(forcedAgent === agent.key ? null : agent.key)}
              className={`px-2.5 py-1 text-[11px] font-display rounded-md border transition-colors ${
                forcedAgent === agent.key
                  ? 'font-bold bg-opacity-10'
                  : 'border-border text-text-muted hover:text-text-primary'
              }`}
              style={forcedAgent === agent.key ? { color: agent.color, borderColor: agent.color, backgroundColor: `${agent.color}15` } : {}}
            >
              {agent.name || agent.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="text-4xl mb-4 opacity-30">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-accent">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3 className="font-display text-lg text-text-primary mb-2">Equipo de Asesores</h3>
                <p className="text-text-secondary text-sm leading-relaxed">
                  4 especialistas que conocen tus empresas. Auto-routing por tema
                  o fuerza un agente con los botones de arriba.
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {agents.map((agent) => (
                    <span
                      key={agent.key}
                      className="text-[10px] px-2 py-1 rounded-full border font-display"
                      style={{ color: agent.color, borderColor: `${agent.color}40` }}
                    >
                      {agent.avatar} {agent.name || agent.label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {[
                    'Como rompo el ciclo de flujo?',
                    '@sales Estrategia de pricing HD',
                    '@architect Automatizar cobranza',
                    '@marketing Plan de redes sociales',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent transition-colors font-display rounded-md"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} agents={agents} />
          ))}

          {streaming && streamText && (
            <MessageBubble
              message={{
                id: 'streaming',
                thread_id: '',
                role: 'assistant',
                content: streamText,
                agent_role: streamAgent?.key || '',
                created_at: 0,
                model_used: streamModelUsed,
              }}
              agents={agents}
              isStreaming
            />
          )}

          {streaming && !streamText && (
            <div className="flex gap-3 items-start">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: `${(streamAgent?.color || '#00fff5')}30` }}
              >
                <span className="text-xs font-display font-bold" style={{ color: streamAgent?.color || '#00fff5' }}>
                  {streamAgent?.avatar || '...'}
                </span>
              </div>
              <div className="flex gap-1 items-center py-3">
                <span className="w-2 h-2 rounded-full bg-accent/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-accent/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-accent/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 font-display rounded-md">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-surface-raised/50 p-4">
          {pendingImage && (
            <div className="mb-2 relative inline-block">
              <img src={pendingImage} alt="preview" className="max-h-32 rounded-lg border border-border" />
              <button
                onClick={() => setPendingImage(null)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-400"
              >
                x
              </button>
            </div>
          )}
          <div className="flex items-end gap-3 border border-border bg-surface p-2 rounded-lg transition-colors focus-within:border-accent">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Adjuntar imagen"
              onChange={(e) => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Adjuntar imagen"
              className="shrink-0 w-9 h-9 flex items-center justify-center text-text-muted hover:text-accent transition-colors"
              disabled={streaming}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={forcedAgent ? `Escribir a ${getAgentInfo(forcedAgent).name || getAgentInfo(forcedAgent).label}...` : 'Escribe tu mensaje... (@sales, @architect, @marketing)'}
              rows={1}
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted text-sm font-body resize-none outline-none py-2 px-2 max-h-32"
              style={{ minHeight: '40px' }}
              disabled={streaming}
            />
            <div ref={modelDropdownRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                title={modelOverride ? `Modelo: ${availableModels.find(m => m.key === modelOverride)?.label || modelOverride}` : 'Auto (click para cambiar modelo)'}
                className={`h-9 px-2 flex items-center gap-1 rounded-md border transition-all text-xs font-display ${
                  modelOverride
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:text-text-primary hover:border-text-muted'
                }`}
                disabled={streaming}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>{modelOverride ? (availableModels.find(m => m.key === modelOverride)?.label || modelOverride) : 'Auto'}</span>
              </button>
              {modelDropdownOpen && (
                <div className="absolute bottom-full mb-1 right-0 w-48 bg-surface-raised border border-border rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => { setModelOverride(null); setModelDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-display transition-colors ${
                      !modelOverride ? 'text-accent bg-accent/10' : 'text-text-primary hover:bg-surface'
                    }`}
                  >
                    Auto (default)
                  </button>
                  {availableModels.filter(m => m.available).map(m => (
                    <button
                      key={m.key}
                      onClick={() => { setModelOverride(m.key); setModelDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs font-display transition-colors flex items-center justify-between ${
                        modelOverride === m.key ? 'text-accent bg-accent/10' : 'text-text-primary hover:bg-surface'
                      }`}
                    >
                      <span>{m.label}</span>
                      <span className="text-text-muted text-[10px]">{m.provider}</span>
                    </button>
                  ))}
                  {availableModels.some(m => !m.available) && (
                    <>
                      <div className="border-t border-border my-1" />
                      <div className="px-3 py-1 text-[10px] text-text-muted">Sin API key:</div>
                      {availableModels.filter(m => !m.available).map(m => (
                        <div key={m.key} className="px-3 py-1.5 text-xs text-text-muted/50">
                          {m.label}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && !pendingImage) || streaming}
              title="Enviar"
              className="shrink-0 w-9 h-9 flex items-center justify-center bg-accent text-surface rounded-md transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="text-text-muted text-[10px] font-display mt-2 text-center">
            Enter para enviar / Shift+Enter nueva linea / @agent para forzar / modelo configurable
          </p>
        </div>
      </div>
    </div>
  );
}


function MessageBubble({ message, agents, isStreaming }: { message: AdvisorMessage; agents: AgentInfo[]; isStreaming?: boolean }) {
  const [ttsLoading, setTtsLoading] = useState(false);
  const isUser = message.role === 'user';
  const agent = !isUser && message.agent_role
    ? agents.find((a) => a.key === message.agent_role) || null
    : null;
  const agentColor = agent?.color || '#94a3b8';

  const playTts = async () => {
    if (!agent?.voice_id || ttsLoading) return;
    setTtsLoading(true);
    try {
      const res = await tts.speak(message.content, agent.voice_id);
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play();
    } catch (e) {
      console.error('TTS error:', e);
    } finally {
      setTtsLoading(false);
    }
  };

  return (
    <div className={`flex gap-3 items-start ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={
          isUser
            ? { backgroundColor: 'var(--color-surface-overlay)' }
            : { backgroundColor: `${agentColor}20` }
        }
      >
        <span
          className="text-xs font-display font-bold"
          style={isUser ? { color: 'var(--color-text-secondary)' } : { color: agentColor }}
        >
          {isUser ? 'S' : (agent?.avatar || '?')}
        </span>
      </div>

      <div className="max-w-[75%]">
        {!isUser && agent && (
          <span
            className="text-[10px] font-display font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"
            style={{ color: agentColor }}
          >
            {agent.name || agent.label}
            {message.model_used === 'pro' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 font-bold normal-case tracking-normal">
                Pro
              </span>
            )}
          </span>
        )}
        <div
          className={`px-4 py-3 text-sm leading-relaxed rounded-lg ${
            isUser
              ? 'bg-accent/10 text-text-primary border border-accent/20'
              : 'bg-surface-raised text-text-primary border border-border'
          } ${isStreaming ? 'animate-pulse-subtle' : ''}`}
        >
          {message.image_data && (
            <img
              src={message.image_data}
              alt="adjunta"
              className="max-w-full max-h-64 rounded-md mb-2 cursor-pointer"
              onClick={() => window.open(message.image_data, '_blank')}
            />
          )}
          <div className="whitespace-pre-wrap break-words font-body">{message.content}</div>
        </div>
        {!isUser && agent?.voice_id && !isStreaming && (
          <button
            type="button"
            onClick={playTts}
            disabled={ttsLoading}
            title="Escuchar"
            className="mt-1 text-text-muted hover:text-accent transition-colors p-1"
          >
            {ttsLoading ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
