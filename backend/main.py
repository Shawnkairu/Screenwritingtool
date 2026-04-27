"""
FastAPI backend for The Instructor.

Endpoints:
  POST /analyze   — Run the analyst layer, return structured JSON
  POST /chat      — Run the instructor layer with RAG context, return response
  GET  /rag/status — Check whether the RAG index is built and ready
  GET  /llm/status — Check which LLM provider is configured

Routes LLM calls server-side so API keys are never exposed to the browser.
Supports Anthropic, local Ollama, and OpenAI-compatible GPU endpoints.
"""

from __future__ import annotations

import os
import json
import re
from pathlib import Path
from typing import Any

import anthropic
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import format_rag_context, retrieve

# Load .env.local from project root
load_dotenv(Path(__file__).parent.parent / ".env.local")

ANTHROPIC_API_KEY = os.environ.get("VITE_ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b-instruct")
OLLAMA_NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "4096"))
OLLAMA_NUM_PREDICT = int(os.environ.get("OLLAMA_NUM_PREDICT", "900"))
OPENAI_COMPAT_BASE_URL = os.environ.get("OPENAI_COMPAT_BASE_URL", "").rstrip("/")
OPENAI_COMPAT_API_KEY = os.environ.get("OPENAI_COMPAT_API_KEY", "")
OPENAI_COMPAT_MODEL = os.environ.get("OPENAI_COMPAT_MODEL", "Qwen/Qwen2.5-14B-Instruct-AWQ")
OPENAI_COMPAT_MAX_TOKENS = int(os.environ.get("OPENAI_COMPAT_MAX_TOKENS", "500"))
OPENAI_COMPAT_STREAM = os.environ.get("OPENAI_COMPAT_STREAM", "true").lower() != "false"
OPENAI_COMPAT_FAST_ANALYSIS = os.environ.get("OPENAI_COMPAT_FAST_ANALYSIS", "false").lower() != "false"
LLM_PROVIDER = os.environ.get(
    "LLM_PROVIDER",
    "anthropic" if ANTHROPIC_API_KEY else "ollama",
).lower()

# Read system prompts from existing src/ files at startup
PROMPTS_DIR = Path(__file__).parent.parent / "src" / "system-prompts"

def _read_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    if not path.exists():
        raise RuntimeError(f"System prompt not found: {path}")
    content = path.read_text(encoding="utf-8")
    # Strip TS export wrapper: export const X_PROMPT = `...`;
    import re
    match = re.search(r'`([\s\S]+)`', content)
    return match.group(1).strip() if match else content


ANALYSIS_PROMPT = _read_prompt("analysis.ts")
INSTRUCTOR_PROMPT = _read_prompt("instructor.ts")

app = FastAPI(title="The Instructor API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
http_session = requests.Session()
http_session.trust_env = False


# ─── LLM Provider Abstraction ────────────────────────────────────────────────

def _provider_label() -> str:
    if LLM_PROVIDER == "anthropic":
        return f"anthropic:{ANTHROPIC_MODEL}"
    if LLM_PROVIDER == "ollama":
        return f"ollama:{OLLAMA_MODEL}"
    if LLM_PROVIDER in {"openai_compat", "openai-compatible", "vllm", "colab"}:
        return f"openai_compat:{OPENAI_COMPAT_MODEL}"
    return LLM_PROVIDER


def _call_anthropic(system: str, messages: list[dict[str, str]], max_tokens: int) -> str:
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "VITE_ANTHROPIC_API_KEY not set")

    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
    except anthropic.APIError as e:
        raise HTTPException(502, f"Anthropic API error: {e}")

    return "".join(block.text for block in response.content if hasattr(block, "text"))


def _call_ollama(system: str, messages: list[dict[str, str]], max_tokens: int) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system},
            *messages,
        ],
        "options": {
            "temperature": 0.2,
            "num_predict": min(max_tokens, OLLAMA_NUM_PREDICT),
            "num_ctx": OLLAMA_NUM_CTX,
        },
        "keep_alive": "15m",
    }

    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=600,
        )
        response.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(
            502,
            f"Ollama error: {e}. Start Ollama and run `ollama pull {OLLAMA_MODEL}`.",
        )

    data = response.json()
    content = data.get("message", {}).get("content", "")
    return content.strip()


def _call_openai_compat(system: str, messages: list[dict[str, str]], max_tokens: int) -> str:
    if not OPENAI_COMPAT_BASE_URL:
        raise HTTPException(500, "OPENAI_COMPAT_BASE_URL not set")

    headers = {"Content-Type": "application/json"}
    if OPENAI_COMPAT_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_COMPAT_API_KEY}"

    payload = {
        "model": OPENAI_COMPAT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            *messages,
        ],
        "temperature": 0.2,
        "max_tokens": min(max_tokens, OPENAI_COMPAT_MAX_TOKENS),
    }
    if OPENAI_COMPAT_STREAM:
        payload["stream"] = True

    try:
        response = http_session.post(
            f"{OPENAI_COMPAT_BASE_URL}/v1/chat/completions",
            json=payload,
            headers=headers,
            timeout=600,
            stream=OPENAI_COMPAT_STREAM,
        )
        response.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(502, f"OpenAI-compatible LLM error: {e}")

    if OPENAI_COMPAT_STREAM:
        chunks: list[str] = []
        try:
            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue
                line = raw_line.removeprefix("data: ").strip()
                if line == "[DONE]":
                    break
                data = json.loads(line)
                delta = data.get("choices", [{}])[0].get("delta", {})
                if content := delta.get("content"):
                    chunks.append(content)
        except (json.JSONDecodeError, requests.RequestException) as e:
            raise HTTPException(502, f"OpenAI-compatible streaming error: {e}")
        return "".join(chunks).strip()

    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "").strip()


def call_llm(system: str, messages: list[dict[str, str]], max_tokens: int) -> str:
    if LLM_PROVIDER == "anthropic":
        return _call_anthropic(system, messages, max_tokens)
    if LLM_PROVIDER == "ollama":
        return _call_ollama(system, messages, max_tokens)
    if LLM_PROVIDER in {"openai_compat", "openai-compatible", "vllm", "colab"}:
        return _call_openai_compat(system, messages, max_tokens)
    raise HTTPException(500, f"Unknown LLM_PROVIDER: {LLM_PROVIDER}")


# ─── Request / Response Models ───────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    text: str  # The raw screenplay text


class Message(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    analysis: dict[str, Any] | None = None
    use_rag: bool = True
    # When set (e.g. Writing Environment), used for screenplay injection + RAG instead of messages[0].
    current_screenplay: str | None = None


# ─── Fast Local Analysis Fallback ────────────────────────────────────────────

SCENE_HEADING_RE = re.compile(
    r"^\s*(?:\d+\s*[-.)]\s*)?(?:(?:INT|EXT|INT/EXT|I/E)\.?\b|.+?\b(?:INT|EXT|INT/EXT|I/E)\b)",
    re.IGNORECASE,
)
CHARACTER_CUE_RE = re.compile(r"^\s*([A-Z][A-Z0-9 .'\-]{1,30})(?:\s*\([^)]*\))?\s*$")
NON_CHARACTER_CUES = {
    "CUT TO",
    "FADE IN",
    "FADE OUT",
    "DISSOLVE TO",
    "INT",
    "EXT",
    "CONTINUED",
}


def _quick_analysis(text: str) -> dict[str, Any]:
    """
    Lightweight structural map for GPU tunnel demos.
    The instructor still uses the configured LLM; this keeps first-turn UI responsive.
    """
    lines = text.splitlines()
    heading_indices = [
        idx for idx, line in enumerate(lines)
        if SCENE_HEADING_RE.match(line.strip())
    ]
    if not heading_indices:
        heading_indices = [0]

    scenes = []
    character_scenes: dict[str, list[int]] = {}
    for scene_number, start in enumerate(heading_indices[:10], start=1):
        end = heading_indices[scene_number] if scene_number < len(heading_indices) else len(lines)
        scene_lines = [line.strip() for line in lines[start:end] if line.strip()]
        heading = scene_lines[0] if scene_lines else f"Scene {scene_number}"
        body = scene_lines[1:] if len(scene_lines) > 1 else scene_lines
        title = re.sub(r"^\d+\s*[-.)]\s*", "", heading).title()[:48]

        chars = []
        for line in body:
            match = CHARACTER_CUE_RE.match(line)
            if not match:
                continue
            name = match.group(1).strip(" .")
            if name in NON_CHARACTER_CUES or len(name.split()) > 4:
                continue
            if name not in chars:
                chars.append(name)
                character_scenes.setdefault(name, []).append(scene_number)

        summary_source = " ".join(body[:3]).strip()
        summary = summary_source[:120] or "Scene details are sparse."
        tension = min(1.0, 0.25 + (scene_number / max(len(heading_indices[:10]), 1)) * 0.55)
        scenes.append({
            "number": scene_number,
            "title": title or f"Scene {scene_number}",
            "summary": summary,
            "tension": round(tension, 2),
            "characters": chars[:6],
            "value_shift": "static",
            "conflict_type": "interpersonal" if len(chars) > 1 else "internal",
            "has_subtext": any(word in " ".join(body).lower() for word in ("looks", "silence", "waits", "stares")),
        })

    top_characters = sorted(character_scenes.items(), key=lambda item: len(item[1]), reverse=True)[:6]
    characters = [
        {
            "name": name.title(),
            "want": "unclear from quick map",
            "need": "unclear from quick map",
            "fear": "unclear from quick map",
            "competing_desires": "quick map only — ask the instructor to probe this",
            "arc_summary": "appears in the draft",
            "scenes_in": scene_nums,
        }
        for name, scene_nums in top_characters
    ]

    relationships = []
    if len(characters) >= 2:
        relationships.append({
            "from": characters[0]["name"],
            "to": characters[1]["name"],
            "type": "tension",
            "intensity": 0.6,
            "label": "shared scene tension",
        })

    scene_count = len(scenes)
    return {
        "scenes": scenes,
        "characters": characters,
        "relationships": relationships,
        "planted_details": [],
        "structure": {
            "dramatic_question": "unclear from quick map",
            "protagonist": characters[0]["name"] if characters else "unclear",
            "protagonist_want": "unclear from quick map",
            "central_conflict": "draft needs instructor probing",
            "act_break_scenes": [max(1, scene_count // 3), max(1, (scene_count * 2) // 3)] if scene_count >= 3 else [],
            "midpoint_scene": max(1, scene_count // 2) if scene_count >= 2 else None,
            "turning_points": [
                {"scene": scene["number"], "description": scene["summary"][:80]}
                for scene in scenes[:3]
            ],
            "skill_level": "intermediate",
            "draft_stage": "revision" if scene_count >= 3 else "first_draft",
            "biggest_issue": "Use the instructor chat for the high-leverage craft diagnosis.",
        },
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/rag/status")
def rag_status():
    """Check whether the ChromaDB index is ready."""
    from rag.retrieve import _get_collection
    collection = _get_collection()
    if collection is None:
        return {"ready": False, "count": 0, "message": "Run scripts/build_rag_index.py first"}
    count = collection.count()
    return {"ready": count > 0, "count": count, "message": f"{count} scenes indexed"}


@app.get("/llm/status")
def llm_status():
    """Check which LLM provider is configured and whether it is reachable."""
    if LLM_PROVIDER == "anthropic":
        return {
            "provider": "anthropic",
            "model": ANTHROPIC_MODEL,
            "ready": bool(ANTHROPIC_API_KEY),
            "message": "Anthropic API key configured" if ANTHROPIC_API_KEY else "VITE_ANTHROPIC_API_KEY not set",
        }

    if LLM_PROVIDER == "ollama":
        try:
            response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
            response.raise_for_status()
            models = [m.get("name", "") for m in response.json().get("models", [])]
            ready = OLLAMA_MODEL in models
            return {
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "ready": ready,
                "message": (
                    f"{OLLAMA_MODEL} is available"
                    if ready
                    else f"Ollama is running; pull the model with `ollama pull {OLLAMA_MODEL}`"
                ),
            }
        except requests.RequestException as e:
            return {
                "provider": "ollama",
                "model": OLLAMA_MODEL,
                "ready": False,
                "message": f"Ollama unavailable at {OLLAMA_BASE_URL}: {e}",
            }

    if LLM_PROVIDER in {"openai_compat", "openai-compatible", "vllm", "colab"}:
        if not OPENAI_COMPAT_BASE_URL:
            return {
                "provider": "openai_compat",
                "model": OPENAI_COMPAT_MODEL,
                "ready": False,
                "message": "OPENAI_COMPAT_BASE_URL not set",
            }
        headers = {}
        if OPENAI_COMPAT_API_KEY:
            headers["Authorization"] = f"Bearer {OPENAI_COMPAT_API_KEY}"
        try:
            response = http_session.get(f"{OPENAI_COMPAT_BASE_URL}/v1/models", headers=headers, timeout=8)
            response.raise_for_status()
            return {
                "provider": "openai_compat",
                "model": OPENAI_COMPAT_MODEL,
                "ready": True,
                "message": f"OpenAI-compatible endpoint reachable at {OPENAI_COMPAT_BASE_URL}",
            }
        except requests.RequestException as e:
            return {
                "provider": "openai_compat",
                "model": OPENAI_COMPAT_MODEL,
                "ready": False,
                "message": f"OpenAI-compatible endpoint unavailable: {e}",
            }

    return {"provider": LLM_PROVIDER, "model": "", "ready": False, "message": "Unknown provider"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """
    Run the silent analyst layer on a screenplay.
    Returns structured JSON (scenes, characters, relationships, structure).
    """
    if LLM_PROVIDER in {"openai_compat", "openai-compatible", "vllm", "colab"} and OPENAI_COMPAT_FAST_ANALYSIS:
        return {"raw": json.dumps(_quick_analysis(req.text)), "provider": f"quick-analysis:{_provider_label()}"}

    raw = call_llm(
        system=ANALYSIS_PROMPT,
        messages=[{"role": "user", "content": req.text}],
        max_tokens=6000,
    )
    return {"raw": raw, "provider": _provider_label()}


@app.post("/chat")
def chat(req: ChatRequest):
    """
    Run the instructor layer with optional RAG context injection.
    Accepts full conversation history + analyst JSON.
    Returns the instructor's next response.
    """
    if not req.messages:
        raise HTTPException(400, "messages cannot be empty")

    screenplay_body = (
        req.current_screenplay.strip()
        if req.current_screenplay and req.current_screenplay.strip()
        else req.messages[0].content
    )

    # Build RAG context from the live screenplay text
    rag_context = ""
    examples = []
    if req.use_rag and screenplay_body:
        examples = retrieve(screenplay_body, n_final=3)
        rag_context = format_rag_context(examples)

    analysis_context = ""
    if req.analysis:
        analysis_context = (
            "[STRUCTURAL ANALYSIS — displayed visually to the writer]\n"
            + json.dumps(req.analysis, indent=2)
            + "\n\n"
        )

    # Prepend RAG examples to the system prompt if available
    system_prompt = INSTRUCTOR_PROMPT
    if rag_context:
        system_prompt = rag_context + "\n\n" + system_prompt

    # Build API message list (screenplay_body may come from the Writing Environment editor)
    first = req.messages[0]
    rest = req.messages[1:]

    api_messages = (
        [{"role": "user", "content": f"{analysis_context}[WRITER'S SCREENPLAY/DESCRIPTION]\n{screenplay_body}"}]
        if len(req.messages) == 1
        else [
            {"role": "user", "content": f"{analysis_context}[WRITER'S SCREENPLAY/DESCRIPTION]\n{screenplay_body}"},
            *[{"role": m.role, "content": m.content} for m in rest[:-1]],
            {"role": "user", "content": rest[-1].content},
        ]
    )

    text = call_llm(
        system=system_prompt,
        messages=api_messages,
        max_tokens=4000,
    )
    return {
        "response": text or "...",
        "provider": _provider_label(),
        "rag_used": bool(rag_context),
        "rag_example_count": len(examples),
    }
