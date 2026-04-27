import { useState, useRef, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

/* ═══════════════════════════════════════════
   JSON REPAIR UTILITY
   ═══════════════════════════════════════════ */

function repairJSON(str) {
  let s = str.trim();
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Try parsing as-is first
  try { return JSON.parse(s); } catch (e) { /* continue */ }
  // If truncated, try to close open brackets/braces
  const opens = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") opens.push(c);
    if (c === "}" || c === "]") opens.pop();
  }
  // Remove any trailing partial key-value or comma
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  s = s.replace(/,\s*$/, "");
  // Close remaining open brackets
  while (opens.length > 0) {
    const o = opens.pop();
    s += o === "{" ? "}" : "]";
  }
  // Final trailing comma cleanup
  s = s.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(s);
}

/* ═══════════════════════════════════════════
   SYSTEM PROMPTS
   ═══════════════════════════════════════════ */

const ANALYSIS_SYSTEM_PROMPT = `You are a screenplay structural analyst. Analyze the input and return ONLY valid JSON. No markdown, no explanation.

CRITICAL RULES:
- Keep ALL string values SHORT (under 15 words each)
- Keep scene summaries to ONE short sentence
- Maximum 10 scenes even if material has more (combine minor scenes)
- Maximum 6 characters (only important ones)
- Maximum 6 relationships
- Return ONLY the JSON object, nothing else

JSON structure:
{"scenes":[{"number":1,"title":"3-5 words","summary":"One short sentence","tension":0.0-1.0,"characters":["NAME"],"value_shift":"positive_to_negative|negative_to_positive|static","conflict_type":"none|internal|interpersonal|external","has_subtext":true}],"characters":[{"name":"NAME","want":"short phrase or undefined","need":"short phrase or undefined","arc_summary":"short phrase","scenes_in":[1]}],"relationships":[{"from":"A","to":"B","type":"allied|conflict|tension|romantic|power|neutral","intensity":0.0-1.0,"label":"2-4 words"}],"structure":{"dramatic_question":"short or unclear","protagonist":"Name or unclear","protagonist_want":"short or undefined","central_conflict":"short or missing","act_break_scenes":[],"midpoint_scene":null,"turning_points":[{"scene":1,"description":"short"}],"skill_level":"beginner|intermediate|advanced","biggest_issue":"One sentence"}}

Be honest about skill level and structural issues. Tension = dramatic pressure, not just action.`;

const INSTRUCTOR_SYSTEM_PROMPT = `You are a world-class screenwriting instructor. Decades of experience. You've internalized McKee (Story), Field (Screenplay), Snyder (Save the Cat), Truby (Anatomy of Story), Mamet (On Directing Film), Goldman, and dramatic theory from Aristotle through Egri.

You are strict, brilliant, and direct. Zero patience for lazy writing, infinite patience for genuine effort.

CONTEXT: The writer has just submitted their screenplay material. A structural analysis has already been generated and is being displayed visually to the writer (tension graph, character relationship web, scene breakdown). You can REFERENCE these visualizations directly.

YOUR METHOD:

1. REFERENCE THE MAP. You and the writer are looking at the same structural diagram. Point at it:
   - "Look at your tension graph — see that flatline in the middle? That's your second act dying."
   - "Your character web shows everyone connected to the protagonist but nobody connected to each other. That's a star pattern — it means your supporting cast exists only to serve one person."
   - "Scene 3 is marked static — no value shift. If nothing changes, why is it there?"

2. CALIBRATE TO SKILL LEVEL. The analysis includes a skill level read. Adjust:
   - BEGINNER: Teach principles while pointing at the map. "See how your tension never rises above 0.4? Stories need pressure."
   - INTERMEDIATE: Challenge blind spots. "The mechanics are here but the subtext isn't."
   - ADVANCED: Spar. "This is technically competent and emotionally vacant. Where's the wound?"

3. BE SOCRATIC. Ask questions the writer can't dodge:
   - "What does your protagonist LOSE if they succeed?"
   - "If I pulled this scene out, what breaks? If nothing — why is it here?"
   - "What's the worst thing that could happen right now? Are you writing toward it or away from it?"

4. NEVER GENERATE STORY. Don't write scenes, suggest plot points, or create dialogue. Challenge, provoke, diagnose, question. If they ask "what should happen next?" — "What does your CHARACTER want to happen? What's the worst version of that?"

5. USE PRECISE CRAFT LANGUAGE: scene values, the gap, pressure, stakes, dramatic irony, subtext, exposition, obligatory scene.

6. YOUR VOICE: Direct. Dry wit. No fluff. No "great job!" unless earned. Respect through honesty. Brief warmth when something genuinely works. Reference great films to illustrate points.

7. STRUCTURAL ANALYSIS CONTEXT: You'll receive the JSON analysis as context. Use it to ground your feedback in what the visualizations are showing. Don't repeat raw data — interpret it.

8. Keep responses focused and punchy. Hit the 2-3 most important things hard. Save the rest for follow-up.

9. FOLLOW-UPS: Track what they've fixed, what's still broken, what new problems emerged. Push harder on things they're avoiding.`;

/* ═══════════════════════════════════════════
   TENSION GRAPH TOOLTIP
   ═══════════════════════════════════════════ */

const TensionTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "#252019",
      border: "1px solid rgba(200,160,100,0.25)",
      borderRadius: "6px",
      padding: "10px 14px",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      lineHeight: 1.6,
      maxWidth: "220px",
    }}>
      <div style={{ color: "#d4c5a9", fontWeight: 600, marginBottom: "4px" }}>
        Scene {d.number}: {d.title}
      </div>
      <div style={{ color: "rgba(200,160,100,0.6)" }}>{d.summary}</div>
      <div style={{ marginTop: "6px", display: "flex", gap: "12px" }}>
        <span style={{ color: "#c89868" }}>Tension: {(d.tension * 100).toFixed(0)}%</span>
        <span style={{
          color: d.value_shift === "static" ? "rgba(200,160,100,0.35)" :
            d.value_shift === "positive_to_negative" ? "#c86858" : "#68a878",
        }}>
          {d.value_shift === "static" ? "Static" :
            d.value_shift === "positive_to_negative" ? "↘ Turns" : "↗ Turns"}
        </span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   CHARACTER WEB
   ═══════════════════════════════════════════ */

const CharacterWeb = ({ characters, relationships }) => {
  const width = 380;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;

  if (!characters?.length) return null;

  const nodes = characters.map((c, i) => {
    const angle = (i / characters.length) * Math.PI * 2 - Math.PI / 2;
    const radius = Math.min(width, height) * 0.32;
    return { ...c, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.name] = n; });

  const relColors = {
    conflict: "#c86858", tension: "#c89858", allied: "#68a878",
    romantic: "#b878a8", power: "#8888c8", neutral: "rgba(200,160,100,0.2)",
  };

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      {relationships?.map((r, i) => {
        const from = nodeMap[r.from];
        const to = nodeMap[r.to];
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const color = relColors[r.type] || relColors.neutral;
        return (
          <g key={`rel-${i}`}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={color} strokeWidth={1 + r.intensity * 2}
              opacity={0.5 + r.intensity * 0.3}
              strokeDasharray={r.type === "tension" ? "4 3" : "none"} />
            <text x={midX} y={midY - 6} fill={color} fontSize="8.5"
              fontFamily="'JetBrains Mono', monospace" textAnchor="middle" opacity={0.7}>
              {r.label}
            </text>
          </g>
        );
      })}
      {nodes.map((n, i) => (
        <g key={`char-${i}`}>
          <circle cx={n.x} cy={n.y} r={20}
            fill="rgba(200,160,100,0.06)" stroke="rgba(200,160,100,0.25)" strokeWidth={1.5} />
          <text x={n.x} y={n.y + 1} fill="#d4c5a9" fontSize="9.5"
            fontFamily="'JetBrains Mono', monospace" fontWeight="500"
            textAnchor="middle" dominantBaseline="middle">
            {n.name.length > 7 ? n.name.slice(0, 6) + "…" : n.name}
          </text>
          <text x={n.x} y={n.y + 34} fill="rgba(200,160,100,0.4)" fontSize="7.5"
            fontFamily="'JetBrains Mono', monospace" textAnchor="middle">
            {n.want && n.want !== "undefined" ? `wants: ${n.want.slice(0, 22)}` : "want: ?"}
          </text>
        </g>
      ))}
    </svg>
  );
};

/* ═══════════════════════════════════════════
   SCENE CARD
   ═══════════════════════════════════════════ */

const SceneCard = ({ scene, isSelected, onClick }) => {
  const shiftColor = scene.value_shift === "static" ? "rgba(200,160,100,0.25)" :
    scene.value_shift === "positive_to_negative" ? "#c86858" : "#68a878";
  const shiftIcon = scene.value_shift === "static" ? "—" :
    scene.value_shift === "positive_to_negative" ? "↘" : "↗";

  return (
    <div onClick={onClick} style={{
      padding: "10px 14px",
      borderLeft: `3px solid ${isSelected ? "rgba(200,160,100,0.5)" : "rgba(200,160,100,0.08)"}`,
      background: isSelected ? "rgba(200,160,100,0.05)" : "transparent",
      cursor: "pointer",
      transition: "all 0.2s",
      marginBottom: "2px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
          color: "rgba(200,160,100,0.45)", textTransform: "uppercase", letterSpacing: "0.1em",
        }}>Scene {scene.number}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "10px", color: shiftColor, fontFamily: "'JetBrains Mono', monospace" }}>
            {shiftIcon} {scene.value_shift === "static" ? "static" : "turns"}
          </span>
          <div style={{ width: "32px", height: "4px", borderRadius: "2px", background: "rgba(200,160,100,0.08)", overflow: "hidden" }}>
            <div style={{
              width: `${scene.tension * 100}%`, height: "100%", borderRadius: "2px",
              background: `hsl(${30 + (1 - scene.tension) * 10}, ${50 + scene.tension * 30}%, ${45 + scene.tension * 15}%)`,
            }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: "12px", color: isSelected ? "#d4c5a9" : "#b8a88a", fontWeight: isSelected ? 500 : 400 }}>
        {scene.title}
      </div>
      {isSelected && (
        <>
          <div style={{ fontSize: "11px", color: "rgba(200,160,100,0.5)", marginTop: "4px", lineHeight: 1.5 }}>
            {scene.summary}
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
            {scene.characters?.map((ch, ci) => (
              <span key={ci} style={{
                fontSize: "9px", fontFamily: "'JetBrains Mono', monospace",
                color: "rgba(200,160,100,0.4)", background: "rgba(200,160,100,0.06)",
                padding: "2px 6px", borderRadius: "3px",
              }}>{ch}</span>
            ))}
            {scene.has_subtext && (
              <span style={{
                fontSize: "9px", fontFamily: "'JetBrains Mono', monospace",
                color: "#68a878", background: "rgba(104,168,120,0.08)",
                padding: "2px 6px", borderRadius: "3px",
              }}>subtext</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════
   STRUCTURE PANEL
   ═══════════════════════════════════════════ */

const StructurePanel = ({ structure }) => {
  if (!structure) return null;
  const items = [
    { label: "Dramatic Question", value: structure.dramatic_question },
    { label: "Protagonist", value: structure.protagonist },
    { label: "Want", value: structure.protagonist_want },
    { label: "Central Conflict", value: structure.central_conflict },
    { label: "Biggest Issue", value: structure.biggest_issue, accent: true },
  ];

  return (
    <div style={{
      background: "rgba(200,160,100,0.03)",
      border: "1px solid rgba(200,160,100,0.1)",
      borderRadius: "8px",
      padding: "14px 16px",
    }}>
      <div style={{
        fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.15em",
        color: "rgba(200,160,100,0.35)", marginBottom: "10px",
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
      }}>Structural Read</div>
      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: "6px", fontSize: "11.5px", lineHeight: 1.5 }}>
          <span style={{ color: "rgba(200,160,100,0.4)", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
            {item.label}:
          </span>{" "}
          <span style={{ color: item.accent ? "#c86858" : "#c8b89a", fontStyle: item.accent ? "italic" : "normal" }}>
            {item.value || "—"}
          </span>
        </div>
      ))}
      {structure.skill_level && (
        <div style={{
          marginTop: "10px", paddingTop: "8px",
          borderTop: "1px solid rgba(200,160,100,0.06)",
          display: "flex", alignItems: "center", gap: "6px",
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
            textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(200,160,100,0.3)",
          }}>Level:</span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
            color: "#c89868", background: "rgba(200,160,100,0.06)",
            padding: "2px 8px", borderRadius: "3px",
          }}>{structure.skill_level}</span>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */

export default function ScreenplayInstructor() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [selectedScene, setSelectedScene] = useState(null);
  const [activeTab, setActiveTab] = useState("tension");
  const [showMap, setShowMap] = useState(true);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const analysisRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const adjustTextarea = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 240) + "px"; }
  };

  const analyzeScreenplay = useCallback(async (text) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 6000,
          system: ANALYSIS_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
      
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API error ${res.status}: ${errBody.slice(0, 200)}`);
      }
      
      const data = await res.json();
      const raw = data.content?.find(b => b.type === "text")?.text || "";
      
      // Robust JSON extraction - find the first { and last }
      const firstBrace = raw.indexOf("{");
      const lastBrace = raw.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("No JSON found in response");
      }
      const jsonStr = raw.slice(firstBrace, lastBrace + 1);
      const parsed = repairJSON(jsonStr);
      
      // Validate minimum structure
      if (!parsed.scenes || !parsed.characters || !parsed.structure) {
        throw new Error("Analysis returned incomplete structure");
      }
      
      setAnalysis(parsed);
      analysisRef.current = parsed;
      return parsed;
    } catch (err) {
      console.error("Analysis failed:", err);
      setAnalysisError(err.message || "Analysis failed");
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const newUserMsg = { role: "user", content: trimmed };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsLoading(true);

    let currentAnalysis = analysisRef.current;
    if (updatedMessages.length === 1) {
      currentAnalysis = await analyzeScreenplay(trimmed);
    }

    try {
      const analysisContext = currentAnalysis
        ? `[STRUCTURAL ANALYSIS — displayed visually to the writer]\n${JSON.stringify(currentAnalysis, null, 2)}\n\n`
        : "";

      const apiMessages = updatedMessages.length === 1
        ? [{ role: "user", content: `${analysisContext}[WRITER'S SCREENPLAY/DESCRIPTION]\n${trimmed}` }]
        : [
          { role: "user", content: `${analysisContext}[WRITER'S SCREENPLAY/DESCRIPTION]\n${updatedMessages[0].content}` },
          ...updatedMessages.slice(1, -1).map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: trimmed },
        ];

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: INSTRUCTOR_SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });

      const data = await res.json();
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "...";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection dropped. Try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatMessage = (text) => {
    const lines = text.split("\n");
    const elements = [];
    let block = [];
    const flush = (key) => {
      if (block.length > 0) {
        elements.push(<p key={key} style={{ margin: "0 0 12px 0" }}>{formatInline(block.join("\n"))}</p>);
        block = [];
      }
    };
    lines.forEach((line, i) => {
      if (line.trim() === "") flush(`p-${i}`);
      else block.push(line);
    });
    flush("p-final");
    return elements.length > 0 ? elements : <p style={{ margin: 0 }}>{text}</p>;
  };

  const formatInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|"[^"]*")/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i} style={{ color: "#e8d5b5", fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*"))
        return <em key={i} style={{ color: "#c8b89a" }}>{part.slice(1, -1)}</em>;
      if (part.startsWith('"') && part.endsWith('"'))
        return <span key={i} style={{ color: "#c89868", fontStyle: "italic" }}>{part}</span>;
      return part;
    });
  };

  const hasAnalysis = !!analysis;

  return (
    <div style={{
      width: "100%", height: "100vh", background: "#1a1714", color: "#b8a88a",
      fontFamily: "'Newsreader', Georgia, serif", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=JetBrains+Mono:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid rgba(200,160,100,0.1)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
          <h1 style={{
            margin: 0, fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: "20px", fontWeight: 400, color: "#d4c5a9",
          }}>The Instructor</h1>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
            color: "rgba(200,160,100,0.3)", textTransform: "uppercase", letterSpacing: "0.15em",
          }}>Screenplay Workshop</span>
        </div>
        {hasAnalysis && (
          <button onClick={() => setShowMap(!showMap)} style={{
            background: "rgba(200,160,100,0.08)", border: "1px solid rgba(200,160,100,0.15)",
            borderRadius: "6px", padding: "6px 14px", color: "#b8a88a",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
            cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em",
          }}>{showMap ? "Hide Map" : "Show Map"}</button>
        )}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* LEFT — Map */}
        {(hasAnalysis || isAnalyzing) && showMap && (
          <div style={{
            width: "420px", flexShrink: 0, borderRight: "1px solid rgba(200,160,100,0.08)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {isAnalyzing && !hasAnalysis ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "16px",
              }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                      width: "4px", height: "20px", borderRadius: "2px",
                      background: "rgba(200,160,100,0.2)",
                      animation: `barPulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                    }} />
                  ))}
                </div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
                  color: "rgba(200,160,100,0.3)", textTransform: "uppercase",
                  letterSpacing: "0.15em",
                }}>Analyzing structure</div>
              </div>
            ) : hasAnalysis ? (
              <>
            <div style={{ display: "flex", borderBottom: "1px solid rgba(200,160,100,0.06)", flexShrink: 0 }}>
              {["tension", "characters", "scenes"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  flex: 1, padding: "10px 0", background: activeTab === tab ? "rgba(200,160,100,0.04)" : "transparent",
                  border: "none", borderBottom: activeTab === tab ? "2px solid rgba(200,160,100,0.35)" : "2px solid transparent",
                  color: activeTab === tab ? "#d4c5a9" : "rgba(200,160,100,0.3)",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
                  textTransform: "uppercase", letterSpacing: "0.12em", cursor: "pointer", transition: "all 0.2s",
                }}>{tab}</button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {activeTab === "tension" && (
                <div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
                    textTransform: "uppercase", letterSpacing: "0.15em",
                    color: "rgba(200,160,100,0.35)", marginBottom: "12px",
                  }}>Tension / Pressure Arc</div>
                  <div style={{ height: "180px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analysis.scenes} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                        <defs>
                          <linearGradient id="tensionGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#c89868" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#c89868" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,160,100,0.05)" />
                        <XAxis dataKey="number"
                          tick={{ fontSize: 10, fill: "rgba(200,160,100,0.3)", fontFamily: "'JetBrains Mono', monospace" }}
                          axisLine={{ stroke: "rgba(200,160,100,0.08)" }} tickLine={false} />
                        <YAxis domain={[0, 1]}
                          tick={{ fontSize: 9, fill: "rgba(200,160,100,0.2)", fontFamily: "'JetBrains Mono', monospace" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<TensionTooltip />} />
                        {analysis.structure?.act_break_scenes?.map(s => (
                          <ReferenceLine key={`act-${s}`} x={s} stroke="rgba(200,160,100,0.2)" strokeDasharray="4 4"
                            label={{ value: "ACT", position: "top", fontSize: 8, fill: "rgba(200,160,100,0.25)", fontFamily: "'JetBrains Mono', monospace" }} />
                        ))}
                        {analysis.structure?.midpoint_scene && (
                          <ReferenceLine x={analysis.structure.midpoint_scene} stroke="rgba(200,100,100,0.2)" strokeDasharray="4 4"
                            label={{ value: "MID", position: "top", fontSize: 8, fill: "rgba(200,100,100,0.25)", fontFamily: "'JetBrains Mono', monospace" }} />
                        )}
                        <Area type="monotone" dataKey="tension" stroke="#c89868" strokeWidth={2}
                          fill="url(#tensionGrad)"
                          dot={{ r: 3, fill: "#c89868", stroke: "#1a1714", strokeWidth: 2 }}
                          activeDot={{ r: 5, fill: "#e8b878" }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ marginTop: "16px" }}>
                    <StructurePanel structure={analysis.structure} />
                  </div>
                </div>
              )}

              {activeTab === "characters" && (
                <div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
                    textTransform: "uppercase", letterSpacing: "0.15em",
                    color: "rgba(200,160,100,0.35)", marginBottom: "12px",
                  }}>Relationship Web</div>
                  <CharacterWeb characters={analysis.characters} relationships={analysis.relationships} />
                  <div style={{ marginTop: "16px" }}>
                    {analysis.characters?.map((c, i) => (
                      <div key={i} style={{
                        padding: "10px 14px", borderLeft: "2px solid rgba(200,160,100,0.12)", marginBottom: "8px",
                      }}>
                        <div style={{ color: "#d4c5a9", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>{c.name}</div>
                        <div style={{ fontSize: "11px", color: "rgba(200,160,100,0.5)", lineHeight: 1.6 }}>
                          <div><span style={{ color: "rgba(200,160,100,0.3)" }}>Want:</span> {c.want || "?"}</div>
                          <div><span style={{ color: "rgba(200,160,100,0.3)" }}>Need:</span> {c.need || "?"}</div>
                          <div><span style={{ color: "rgba(200,160,100,0.3)" }}>Arc:</span> {c.arc_summary || "?"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "scenes" && (
                <div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
                    textTransform: "uppercase", letterSpacing: "0.15em",
                    color: "rgba(200,160,100,0.35)", marginBottom: "12px",
                  }}>Scene Breakdown</div>
                  {analysis.scenes?.map((s, i) => (
                    <SceneCard key={i} scene={s} isSelected={selectedScene === i}
                      onClick={() => setSelectedScene(selectedScene === i ? null : i)} />
                  ))}
                </div>
              )}
            </div>
            </>) : null}
          </div>
        )}

        {/* RIGHT — Instructor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {messages.length === 0 && (
              <div style={{ maxWidth: "480px", margin: "48px auto 0", textAlign: "center" }}>
                <div style={{
                  fontFamily: "'Instrument Serif', Georgia, serif", fontSize: "28px",
                  color: "#d4c5a9", marginBottom: "20px", fontStyle: "italic", lineHeight: 1.3,
                }}>Show me your pages.</div>
                <p style={{ fontSize: "14px", lineHeight: 1.7, color: "rgba(184,168,138,0.45)", margin: 0 }}>
                  Paste a screenplay excerpt, a scene, or describe what you're working on.
                  I'll map the structure and tell you what I see.
                </p>
              </div>
            )}

            {(isAnalyzing && messages.length === 1) && (
              <div style={{
                maxWidth: "480px", margin: "0 0 20px 0", padding: "16px",
                borderLeft: "2px solid rgba(200,160,100,0.12)",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "rgba(200,160,100,0.35)",
                }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: "rgba(200,160,100,0.3)",
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
                maxWidth: "480px", margin: "0 0 20px 0", padding: "14px 16px",
                borderLeft: "2px solid #c86858",
                background: "rgba(200,104,88,0.04)",
                borderRadius: "0 6px 6px 0",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "11px",
                  color: "#c86858", marginBottom: "8px",
                }}>
                  Structural analysis failed: {analysisError}
                </div>
                <button onClick={() => {
                  if (messages.length > 0) analyzeScreenplay(messages[0].content);
                }} style={{
                  background: "rgba(200,104,88,0.1)", border: "1px solid rgba(200,104,88,0.25)",
                  borderRadius: "5px", padding: "6px 14px", color: "#c86858",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
                  cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em",
                }}>Retry Analysis</button>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                maxWidth: "580px", margin: msg.role === "user" ? "0 0 20px auto" : "0 0 20px 0",
              }}>
                {msg.role === "user" ? (
                  <div style={{
                    background: "rgba(200,160,100,0.04)", border: "1px solid rgba(200,160,100,0.08)",
                    borderRadius: "8px", padding: "12px 16px",
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "12px",
                    lineHeight: 1.6, color: "rgba(200,180,150,0.6)", whiteSpace: "pre-wrap",
                    maxWidth: "80%", marginLeft: "auto", maxHeight: "180px", overflowY: "auto",
                  }}>
                    {msg.content.length > 600 ? msg.content.slice(0, 600) + "…" : msg.content}
                  </div>
                ) : (
                  <div style={{
                    fontSize: "14px", lineHeight: 1.75, color: "#c8b89a",
                    paddingLeft: "14px", borderLeft: "2px solid rgba(200,160,100,0.1)",
                  }}>
                    {formatMessage(msg.content)}
                  </div>
                )}
              </div>
            ))}

            {isLoading && !isAnalyzing && (
              <div style={{
                maxWidth: "580px", paddingLeft: "14px", borderLeft: "2px solid rgba(200,160,100,0.1)",
              }}>
                <div style={{ display: "flex", gap: "5px", padding: "8px 0" }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: "5px", height: "5px", borderRadius: "50%",
                      background: "rgba(200,160,100,0.3)",
                      animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "12px 24px 20px", borderTop: "1px solid rgba(200,160,100,0.06)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
              <textarea ref={textareaRef} value={input}
                onChange={(e) => { setInput(e.target.value); adjustTextarea(); }}
                onKeyDown={handleKeyDown}
                placeholder={messages.length === 0 ? "Paste your screenplay or describe your story..." : "Respond to the instructor..."}
                rows={1}
                style={{
                  flex: 1, background: "rgba(200,160,100,0.03)", border: "1px solid rgba(200,160,100,0.1)",
                  borderRadius: "8px", padding: "12px 16px", color: "#c8b89a",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", lineHeight: 1.6,
                  resize: "none", outline: "none", transition: "border-color 0.2s",
                  minHeight: "44px", maxHeight: "240px",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(200,160,100,0.3)"}
                onBlur={e => e.target.style.borderColor = "rgba(200,160,100,0.1)"}
              />
              <button onClick={sendMessage} disabled={isLoading || !input.trim()} style={{
                background: input.trim() && !isLoading ? "rgba(200,160,100,0.1)" : "rgba(200,160,100,0.03)",
                border: "1px solid rgba(200,160,100,0.12)", borderRadius: "8px", padding: "12px 18px",
                color: input.trim() && !isLoading ? "#c8b090" : "rgba(200,160,100,0.18)",
                cursor: input.trim() && !isLoading ? "pointer" : "default",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0, height: "44px",
              }}>Submit</button>
            </div>
            <div style={{
              textAlign: "center", fontSize: "10px", color: "rgba(200,160,100,0.15)",
              fontFamily: "'JetBrains Mono', monospace", marginTop: "6px",
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
        textarea::placeholder { color: rgba(200,160,100,0.2); }
      `}</style>
    </div>
  );
}