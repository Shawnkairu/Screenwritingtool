import type { Analysis, Message } from './types';
import { repairJSON } from './utils/repairJSON';

// Backend URL — FastAPI server running locally
// Falls back to direct Anthropic API if backend is not running (dev convenience)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string ?? 'http://localhost:8000';
const USE_BACKEND = import.meta.env.VITE_USE_BACKEND !== 'false';

// Direct API fallback (dev only — never expose keys in production)
const DIRECT_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string ?? '';


// ─── Backend path ─────────────────────────────────────────────────────────

async function analyzeViaBackend(text: string): Promise<Analysis> {
  const res = await fetch(`${BACKEND_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Backend error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw: string = data.raw ?? '';

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON found in analysis response');

  const parsed = repairJSON(raw.slice(firstBrace, lastBrace + 1)) as Analysis;
  if (!parsed.scenes || !parsed.characters || !parsed.structure) {
    throw new Error('Analysis returned incomplete structure');
  }
  return parsed;
}

export type InstructorChatOptions = {
  /** Live draft from the Writing Environment — overrides messages[0] for screenplay + RAG. */
  currentScreenplay?: string;
};

export type RagStatus = {
  ready: boolean;
  count: number;
  message: string;
};

export type InstructorReply = {
  text: string;
  ragUsed: boolean;
  ragExampleCount: number;
};

async function chatViaBackend(
  messages: Message[],
  analysis: Analysis | null,
  options?: InstructorChatOptions,
): Promise<InstructorReply> {
  const res = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      analysis,
      use_rag: true,
      current_screenplay: options?.currentScreenplay?.trim() || null,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Backend error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    text: data.response ?? '...',
    ragUsed: Boolean(data.rag_used),
    ragExampleCount: Number(data.rag_example_count ?? 0),
  };
}


// ─── Direct API fallback ──────────────────────────────────────────────────
// Used when VITE_USE_BACKEND=false or backend is unreachable.
// Imports prompts directly — only works in browser dev mode.

async function analyzeDirectly(text: string): Promise<Analysis> {
  const { ANALYSIS_SYSTEM_PROMPT } = await import('./system-prompts/analysis');

  const res = await fetch(DIRECT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw: string = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON found in analysis response');

  const parsed = repairJSON(raw.slice(firstBrace, lastBrace + 1)) as Analysis;
  if (!parsed.scenes || !parsed.characters || !parsed.structure) {
    throw new Error('Analysis returned incomplete structure');
  }
  return parsed;
}

async function chatDirectly(
  messages: Message[],
  analysis: Analysis | null,
  options?: InstructorChatOptions,
): Promise<InstructorReply> {
  const { INSTRUCTOR_SYSTEM_PROMPT } = await import('./system-prompts/instructor');

  const analysisContext = analysis
    ? `[STRUCTURAL ANALYSIS — displayed visually to the writer]\n${JSON.stringify(analysis, null, 2)}\n\n`
    : '';

  const first = messages[0];
  const rest = messages.slice(1);
  const screenplayBody =
    options?.currentScreenplay?.trim() ? options.currentScreenplay.trim() : first.content;

  const apiMessages =
    messages.length === 1
      ? [{ role: 'user', content: `${analysisContext}[WRITER'S SCREENPLAY/DESCRIPTION]\n${screenplayBody}` }]
      : [
          { role: 'user', content: `${analysisContext}[WRITER'S SCREENPLAY/DESCRIPTION]\n${screenplayBody}` },
          ...rest.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: messages[messages.length - 1].content },
        ];

  const res = await fetch(DIRECT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: INSTRUCTOR_SYSTEM_PROMPT,
      messages: apiMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (
    data.content
      ?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n') ?? '...'
  );
  return { text, ragUsed: false, ragExampleCount: 0 };
}


// ─── Public API ───────────────────────────────────────────────────────────

export async function analyzeScreenplay(text: string): Promise<Analysis> {
  if (USE_BACKEND) {
    return analyzeViaBackend(text);
  }
  return analyzeDirectly(text);
}

export async function getInstructorResponse(
  messages: Message[],
  analysis: Analysis | null,
  options?: InstructorChatOptions,
): Promise<InstructorReply> {
  if (USE_BACKEND) {
    return chatViaBackend(messages, analysis, options);
  }
  return chatDirectly(messages, analysis, options);
}

export async function getRagStatus(): Promise<RagStatus> {
  if (!USE_BACKEND) {
    return { ready: false, count: 0, message: 'Backend disabled; direct API mode does not use RAG' };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/rag/status`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Backend error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return {
      ready: Boolean(data.ready),
      count: Number(data.count ?? 0),
      message: String(data.message ?? ''),
    };
  } catch (e) {
    console.warn('[api] RAG status unavailable:', e);
    return { ready: false, count: 0, message: 'Backend unavailable; RAG not active' };
  }
}
