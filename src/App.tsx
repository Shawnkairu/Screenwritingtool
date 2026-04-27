import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts';
import { analyzeScreenplay, getInstructorResponse } from './api';
import CharacterWeb from './components/CharacterWeb';
import SceneCard from './components/SceneCard';
import StructurePanel from './components/StructurePanel';
import TensionTooltip from './components/TensionTooltip';
import WritingEditorColumn from './components/WritingEditorColumn';
import { countSceneHeadings } from './utils/screenplayScenes';
import type { Analysis, Message, ActiveTab } from './types';
import './App.css';

const DRAFT_STORAGE_KEY = 'the-instructor-writing-draft';

export default function ScreenplayInstructor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('tension');
  const [showMap, setShowMap] = useState(true);
  const [draft, setDraft] = useState(() => localStorage.getItem(DRAFT_STORAGE_KEY) ?? '');
  const [writeNotice, setWriteNotice] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<null | { sceneNumber: number; actBreak: boolean }>(null);
  /** Bumps when structural analysis succeeds so Recharts remounts with new data (fixes stale chart). */
  const [structuralMapEpoch, setStructuralMapEpoch] = useState(0);
  const lastSceneWriteRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const analysisRef = useRef<Analysis | null>(null);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(DRAFT_STORAGE_KEY, draft);
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft]);

  const draftSceneCount = useMemo(() => countSceneHeadings(draft), [draft]);

  useEffect(() => {
    const prev = lastSceneWriteRef.current;
    if (prev === null) {
      lastSceneWriteRef.current = draftSceneCount;
      return;
    }
    if (draftSceneCount === prev + 1) {
      const actBreak = !!analysis?.structure?.act_break_scenes?.includes(draftSceneCount);
      setCheckIn({ sceneNumber: draftSceneCount, actBreak });
    }
    lastSceneWriteRef.current = draftSceneCount;
  }, [draftSceneCount, analysis]);

  const adjustTextarea = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; }
  };

  const runAnalysis = useCallback(async (text: string) => {
    setIsAnalyzing(true);
    setShowMap(true);
    setAnalysisError(null);
    try {
      const parsed = await analyzeScreenplay(text);
      setAnalysis(parsed);
      analysisRef.current = parsed;
      setStructuralMapEpoch((n) => n + 1);
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setAnalysisError(msg);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const analyzeDraft = useCallback(async () => {
    const t = draft.trim();
    if (!t) return;
    await runAnalysis(t);
  }, [draft, runAnalysis]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    if (!draft.trim()) {
      setWriteNotice('Add screenplay text in the editor before you message the instructor.');
      return;
    }
    setWriteNotice(null);

    const newUserMsg: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    let currentAnalysis = analysisRef.current;
    if (updatedMessages.length === 1) {
      currentAnalysis = await runAnalysis(draft.trim());
    }

    try {
      const instructorOpts = draft.trim() ? { currentScreenplay: draft } : undefined;
      const reply = await getInstructorResponse(updatedMessages, currentAnalysis, instructorOpts);
      setMessages(prev => [...prev, { role: 'assistant', content: reply.text }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection dropped. Try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|"[^"]*")/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} style={{ color: '#e8d5b5', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={i} style={{ color: '#c8b89a' }}>{part.slice(1, -1)}</em>;
      if (part.startsWith('"') && part.endsWith('"'))
        return <span key={i} style={{ color: '#c89868', fontStyle: 'italic' }}>{part}</span>;
      return part;
    });
  };

  const formatMessage = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let block: string[] = [];
    const flush = (key: string) => {
      if (block.length > 0) {
        elements.push(<p key={key} style={{ margin: '0 0 12px 0' }}>{formatInline(block.join('\n'))}</p>);
        block = [];
      }
    };
    lines.forEach((line, i) => {
      if (line.trim() === '') flush(`p-${i}`);
      else block.push(line);
    });
    flush('p-final');
    return elements.length > 0 ? elements : <p style={{ margin: 0 }}>{text}</p>;
  };

  const hasAnalysis = !!analysis;

  return (
    <div className="fd-app">
      <div className="fd-topbar">
        <div className="fd-topbar-brand">
          <div>
            <h1>Screen Writing Tool</h1>
            <p>Final Draft-inspired screenplay workspace</p>
          </div>
        </div>

        <div className="fd-topbar-nav" aria-hidden="true">
          <span className="fd-nav-chip active">Script</span>
          <span className="fd-nav-chip">Structure</span>
          <span className="fd-nav-chip">Instructor</span>
        </div>

        <div className="fd-topbar-actions">
          {hasAnalysis && (
            <button type="button" className="fd-header-button" onClick={() => setShowMap(!showMap)}>
              {showMap ? 'Hide Structure' : 'Show Structure'}
            </button>
          )}
        </div>
      </div>

      <div className="fd-main">

        {/* LEFT — Map */}
        {(hasAnalysis || isAnalyzing) && showMap && (
          <div className="fd-side-panel fd-map-panel">
            {isAnalyzing && !hasAnalysis ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '16px',
              }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                      width: '4px', height: '20px', borderRadius: '2px',
                      background: 'rgba(200,160,100,0.2)',
                      animation: `barPulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                    }} />
                  ))}
                </div>
                <div style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
                  color: 'rgba(220,185,140,0.65)', textTransform: 'uppercase', letterSpacing: '0.15em',
                }}>Analyzing structure</div>
              </div>
            ) : hasAnalysis ? (
              <>
                {isAnalyzing && (
                  <div style={{
                    flexShrink: 0, padding: '8px 16px',
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    color: 'rgba(220,185,140,0.72)', borderBottom: '1px solid rgba(200,160,100,0.06)',
                    background: 'rgba(200,160,100,0.04)',
                  }}>
                    Refreshing structural map…
                  </div>
                )}
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(200,160,100,0.06)', flexShrink: 0 }}>
                  {(['tension', 'characters', 'scenes'] as ActiveTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} style={{
                      flex: 1, padding: '10px 0',
                      background: activeTab === tab ? 'rgba(200,160,100,0.04)' : 'transparent',
                      border: 'none',
                      borderBottom: activeTab === tab ? '2px solid rgba(200,160,100,0.35)' : '2px solid transparent',
                      color: activeTab === tab ? '#e8dcc8' : 'rgba(220,185,140,0.6)',
                      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
                      textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', transition: 'all 0.2s',
                    }}>{tab}</button>
                  ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {activeTab === 'tension' && (
                    <div>
                      <div style={{
                        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
                        textTransform: 'uppercase', letterSpacing: '0.15em',
                        color: 'rgba(220,185,140,0.65)', marginBottom: '12px',
                      }}>Tension / Pressure Arc</div>
                      <div style={{ height: '180px' }} key={`tension-arc-${structuralMapEpoch}`}>
                        <ResponsiveContainer width="100%" height="100%" debounce={32}>
                          <AreaChart data={analysis!.scenes} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <defs>
                              <linearGradient id={`tensionGrad-${structuralMapEpoch}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#c89868" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#c89868" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,160,100,0.05)" />
                            <XAxis dataKey="number"
                              tick={{ fontSize: 10, fill: 'rgba(200,160,100,0.3)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
                              axisLine={{ stroke: 'rgba(200,160,100,0.08)' }} tickLine={false} />
                            <YAxis domain={[0, 1]}
                              tick={{ fontSize: 9, fill: 'rgba(200,160,100,0.2)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
                              axisLine={false} tickLine={false} />
                            <Tooltip content={<TensionTooltip />} />
                            {analysis!.structure?.act_break_scenes?.map(s => (
                              <ReferenceLine key={`act-${s}`} x={s} stroke="rgba(200,160,100,0.2)" strokeDasharray="4 4"
                                label={{ value: 'ACT', position: 'top', fontSize: 8, fill: 'rgba(200,160,100,0.25)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} />
                            ))}
                            {analysis!.structure?.midpoint_scene && (
                              <ReferenceLine x={analysis!.structure.midpoint_scene} stroke="rgba(200,100,100,0.2)" strokeDasharray="4 4"
                                label={{ value: 'MID', position: 'top', fontSize: 8, fill: 'rgba(200,100,100,0.25)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} />
                            )}
                            <Area type="monotone" dataKey="tension" stroke="#c89868" strokeWidth={2}
                              fill={`url(#tensionGrad-${structuralMapEpoch})`}
                              dot={{ r: 3, fill: '#c89868', stroke: '#1a1714', strokeWidth: 2 }}
                              activeDot={{ r: 5, fill: '#e8b878' }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ marginTop: '16px' }}>
                        <StructurePanel structure={analysis!.structure} />
                      </div>
                    </div>
                  )}

                  {activeTab === 'characters' && (
                    <div>
                      <div style={{
                        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
                        textTransform: 'uppercase', letterSpacing: '0.15em',
                        color: 'rgba(220,185,140,0.65)', marginBottom: '12px',
                      }}>Relationship Web</div>
                      <CharacterWeb characters={analysis!.characters} relationships={analysis!.relationships} />
                      <div style={{ marginTop: '16px' }}>
                        {analysis!.characters?.map((c, i) => (
                          <div key={i} style={{
                            padding: '10px 14px', borderLeft: '2px solid rgba(200,160,100,0.12)', marginBottom: '8px',
                          }}>
                            <div style={{ color: '#d4c5a9', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>{c.name}</div>
                            <div style={{ fontSize: '11px', color: 'rgba(220,185,140,0.75)', lineHeight: 1.6 }}>
                              <div><span style={{ color: 'rgba(220,185,140,0.6)' }}>Want:</span> {c.want || '?'}</div>
                              <div><span style={{ color: 'rgba(220,185,140,0.6)' }}>Need:</span> {c.need || '?'}</div>
                              <div><span style={{ color: 'rgba(220,185,140,0.6)' }}>Arc:</span> {c.arc_summary || '?'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'scenes' && (
                    <div>
                      <div style={{
                        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
                        textTransform: 'uppercase', letterSpacing: '0.15em',
                        color: 'rgba(220,185,140,0.65)', marginBottom: '12px',
                      }}>Scene Breakdown</div>
                      {analysis!.scenes?.map((s, i) => (
                        <SceneCard key={i} scene={s} isSelected={selectedScene === i}
                          onClick={() => setSelectedScene(selectedScene === i ? null : i)} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}

        <WritingEditorColumn
          draft={draft}
          onDraftChange={setDraft}
          checkIn={checkIn}
          onDismissCheckIn={() => setCheckIn(null)}
          onUseCheckInPrompt={(p) => {
            setInput(p);
            requestAnimationFrame(() => {
              adjustTextarea();
              textareaRef.current?.focus();
            });
          }}
          onAnalyze={analyzeDraft}
          isAnalyzing={isAnalyzing}
          hasAnalysis={hasAnalysis}
        />

        {/* Instructor chat */}
        <div className="fd-side-panel fd-chat-panel">
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {messages.length === 0 && (
              <div style={{ maxWidth: '480px', margin: '48px auto 0', textAlign: 'center' }}>
                <div style={{
                  fontSize: '28px',
                  color: '#d4c5a9', marginBottom: '20px', fontStyle: 'normal', lineHeight: 1.3,
                  fontWeight: 600,
                }}>The draft is on the left.</div>
                <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'rgba(210,195,165,0.8)', margin: 0 }}>
                  Put your screenplay in the editor — I read it on every message. You only use this pane for questions and answers.
                  Your first message here also runs structural analysis on what is in the editor.
                </p>
                <p style={{
                  fontSize: '12px', lineHeight: 1.65, color: 'rgba(210,195,165,0.65)', margin: '16px 0 0',
                }}>
                  Use Analyze draft in the editor toolbar to refresh the map without chatting.
                  The map appears after the first successful analysis.
                </p>
              </div>
            )}

            {(isAnalyzing && messages.length === 1) && (
              <div style={{
                maxWidth: '480px', margin: '0 0 20px 0', padding: '16px',
                borderLeft: '2px solid rgba(200,160,100,0.12)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '11px', color: 'rgba(220,185,140,0.65)',
                }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: '5px', height: '5px', borderRadius: '50%',
                        background: 'rgba(200,160,100,0.3)',
                        animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                      }} />
                    ))}
                  </div>
                  Mapping structure...
                </div>
              </div>
            )}

            {analysisError && !isAnalyzing && (
              <div style={{
                maxWidth: '480px', margin: '0 0 20px 0', padding: '14px 16px',
                borderLeft: '2px solid #c86858', background: 'rgba(200,104,88,0.04)',
                borderRadius: '0 6px 6px 0',
              }}>
                <div style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '11px',
                  color: '#c86858', marginBottom: '8px',
                }}>
                  Structural analysis failed: {analysisError}
                </div>
                <button type="button" onClick={() => {
                  const src = draft.trim() || messages[0]?.content;
                  if (src) runAnalysis(src);
                }} style={{
                  background: 'rgba(200,104,88,0.1)', border: '1px solid rgba(200,104,88,0.25)',
                  borderRadius: '5px', padding: '6px 14px', color: '#c86858',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
                  cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>Retry Analysis</button>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                maxWidth: '580px', margin: msg.role === 'user' ? '0 0 20px auto' : '0 0 20px 0',
              }}>
                {msg.role === 'user' ? (
                  <div style={{
                    background: 'rgba(200,160,100,0.04)', border: '1px solid rgba(200,160,100,0.08)',
                    borderRadius: '8px', padding: '12px 16px',
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '12px',
                    lineHeight: 1.6, color: 'rgba(215,195,165,0.9)', whiteSpace: 'pre-wrap',
                    maxWidth: '80%', marginLeft: 'auto', maxHeight: '180px', overflowY: 'auto',
                  }}>
                    {msg.content.length > 600 ? msg.content.slice(0, 600) + '…' : msg.content}
                  </div>
                ) : (
                  <div style={{
                    fontSize: '14px', lineHeight: 1.75, color: '#e0d4bc',
                    paddingLeft: '14px', borderLeft: '2px solid rgba(200,160,100,0.1)',
                  }}>
                    {formatMessage(msg.content)}
                  </div>
                )}
              </div>
            ))}

            {isLoading && !isAnalyzing && (
              <div style={{
                maxWidth: '580px', paddingLeft: '14px', borderLeft: '2px solid rgba(200,160,100,0.1)',
              }}>
                <div style={{ display: 'flex', gap: '5px', padding: '8px 0' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: '5px', height: '5px', borderRadius: '50%',
                      background: 'rgba(200,160,100,0.3)',
                      animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 24px 20px', borderTop: '1px solid rgba(200,160,100,0.06)', flexShrink: 0 }}>
            {writeNotice && (
              <div style={{
                marginBottom: '10px', padding: '10px 12px', borderRadius: '6px',
                background: 'rgba(200,152,88,0.08)', border: '1px solid rgba(200,152,88,0.2)',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '11px', color: '#d4b878', lineHeight: 1.5,
              }}>{writeNotice}</div>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setWriteNotice(null);
                  setInput(e.target.value);
                  adjustTextarea();
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  messages.length === 0
                    ? 'Ask a question — your screenplay is in the editor...'
                    : 'Respond to the instructor...'
                }
                rows={1}
                style={{
                  flex: 1, background: 'rgba(200,160,100,0.03)', border: '1px solid rgba(200,160,100,0.1)',
                  borderRadius: '8px', padding: '12px 16px', color: '#c8b89a',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '12px', lineHeight: 1.6,
                  resize: 'none', outline: 'none', transition: 'border-color 0.2s',
                  minHeight: '44px', maxHeight: '240px',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(200,160,100,0.3)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(200,160,100,0.1)')}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={isLoading || !input.trim() || !draft.trim()}
                style={{
                  background: input.trim() && draft.trim() && !isLoading ? 'rgba(200,160,100,0.1)' : 'rgba(200,160,100,0.03)',
                  border: '1px solid rgba(200,160,100,0.12)', borderRadius: '8px', padding: '12px 18px',
                  color: input.trim() && draft.trim() && !isLoading ? '#c8b090' : 'rgba(200,160,100,0.18)',
                  cursor: input.trim() && draft.trim() && !isLoading ? 'pointer' : 'default',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '11px',
                  textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0, height: '44px',
              }}>Submit</button>
            </div>
            <div style={{
              textAlign: 'center', fontSize: '10px', color: 'rgba(200,160,100,0.15)',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", marginTop: '6px',
            }}>shift + enter for new line</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes barPulse {
          0%, 100% { height: 8px; opacity: 0.2; }
          50% { height: 24px; opacity: 0.5; }
        }
        * { box-sizing: border-box; }
        *::-webkit-scrollbar { width: 5px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(200,160,100,0.1); border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: rgba(200,160,100,0.2); }
        textarea::placeholder { color: rgba(210,185,145,0.35); }
      `}</style>
    </div>
  );
}
