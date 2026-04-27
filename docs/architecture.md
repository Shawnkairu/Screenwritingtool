# Technical Architecture

## System Overview

The Instructor is a two-layer AI system. The layers are deliberately separated: one is a silent pattern recognizer that produces structured data, the other is a personality-driven mentor that interprets that data to challenge the writer.

```
                    ┌──────────────────────────────────────┐
                    │           React Frontend             │
                    │                                      │
                    │  ┌─────────────┐  ┌───────────────┐ │
                    │  │ Structural  │  │  Instructor   │ │
                    │  │    Map      │  │     Chat      │ │
                    │  │             │  │               │ │
                    │  │ TensionArc  │  │ Multi-turn    │ │
                    │  │ CharacterWeb│  │ conversation  │ │
                    │  │ SceneCards  │  │               │ │
                    │  └──────┬──────┘  └──────┬────────┘ │
                    └─────────┼────────────────┼──────────┘
                              │                │
                    ┌─────────▼────────────────▼──────────┐
                    │            api.ts                    │
                    │                                      │
                    │  analyzeScreenplay()  (first msg)    │
                    │  getInstructorResponse() (every msg) │
                    └─────────┬────────────────┬──────────┘
                              │                │
               ┌──────────────▼──┐    ┌────────▼──────────┐
               │  Analyst Layer  │    │ Instructor Layer   │
               │                 │    │                    │
               │ system-prompts/ │    │ system-prompts/    │
               │ analysis.ts     │    │ instructor.ts      │
               │                 │    │                    │
               │ Returns JSON    │    │ Returns natural    │
               │ (no prose)      │    │ language response  │
               │                 │    │                    │
               └──────────────────┘   └───────────────────┘
                              │                │
                    ┌─────────▼────────────────▼──────────┐
                    │               Qwen                  │
                    └─────────────────────────────────────┘
```

---

## Layer 1: The Analyst

**File:** `src/system-prompts/analysis.ts`, called via `src/api.ts::analyzeScreenplay()`

**Runs:** First message only. Output is stored in state and reused for all subsequent turns.

**Purpose:** Pure structural pattern recognition. No personality. No prose. Returns only valid JSON.

**Output schema:**

```typescript
{
  scenes: [{
    number, title, summary, tension,     // 0.0–1.0 dramatic pressure
    characters, value_shift,              // positive_to_negative | negative_to_positive | static
    conflict_type, has_subtext
  }],
  characters: [{
    name, want, need, fear,
    competing_desires, arc_summary, scenes_in
  }],
  relationships: [{
    from, to,
    type,      // allied | conflict | tension | romantic | power | neutral
    intensity, label
  }],
  structure: {
    dramatic_question, protagonist, protagonist_want,
    central_conflict, act_break_scenes, midpoint_scene,
    turning_points, skill_level, draft_stage, biggest_issue
  }
}
```

**Reliability challenge:** The analyst response frequently arrives truncated. `src/utils/repairJSON.ts` handles this — it reconstructs valid JSON from partial responses by tracking open brackets, removing trailing partial key-values, and closing unclosed structures. This is load-bearing; do not remove it.

**Design decision — separate analyst from instructor:** Splitting into two calls ensures the instructor never gets contaminated by the analyst's pattern-matching mode. The analyst is constrained to structural facts; the instructor is free to interpret them in voice. Merging them produced responses that were simultaneously diagnostic and prescriptive — the opposite of Socratic.

---

## Layer 2: The Instructor

**File:** `src/system-prompts/instructor.ts`, called via `src/api.ts::getInstructorResponse()`

**Runs:** Every message. Receives the analyst JSON as prepended context on the first turn.

**Purpose:** Socratic mentor. Interrogates, never prescribes. Voice is direct, dry, calibrated to skill level and draft stage.

**Five dimensions of feedback:**

1. Structural architecture (scene values, act structure, tension)
2. Character depth & psychology (competing desires, specificity, fear)
3. World-building & authenticity (culture, speech register, setting)
4. Visual language & cinematic thinking (description as direction)
5. Consequence chains & plotting (causality, planted details, payoffs)

**Calibration signals from analyst JSON:**

- `skill_level`: beginner → teach principles; intermediate → push subtext; advanced → spar
- `draft_stage`: first_draft → momentum only; revision → interiority; polish → everything

---

## Context Management

The instructor receives the full conversation history on every call, with the analyst JSON prepended to the first user message:

```
Turn 1 user message:
  [STRUCTURAL ANALYSIS — displayed visually to the writer]
  { ...analyst JSON... }

  [WRITER'S SCREENPLAY/DESCRIPTION]
  { ...original screenplay text... }

Turn 2+ user messages:
  Same structure for turn 1 (analyst context stays)
  + all subsequent turns in natural conversation format
```

This keeps the analyst data available to the instructor throughout the session without re-running the analyst on every turn.

---

## RAG Pipeline

**Goal:** Inject 3 structurally relevant professional screenplay examples into the instructor's context at query time.

**Why this was prioritized:** RAG changes the actual mentoring experience the writer sees. Retrieved examples let the instructor ground its questions in real screenplay patterns instead of relying only on abstract craft knowledge. Fine-tuning the analyst would likely improve schema consistency and long-term cost, but RAG produces the more immediate user-facing gain for the final project build.

**Architecture:**

```
PDF corpus (49 PDFs → 36 usable after filtering image-based scans)
      │  scripts/convert_pdfs.py  (pdfplumber)
      ▼
Plain text (data/raw/*.txt)
      │  scripts/parse_screenplay.py
      │  Handles: INT./EXT., scene-number prefixes, em-dash format
      ▼
Scene chunks + metadata (data/chunks/chunks.jsonl)
  3,648 chunks · 36 screenplays
  { id, title, scene_heading, text, act_position,
    scene_type, characters, has_subtext, approx_page }
      │
      ▼
Embedding comparison (scripts/build_rag_index.py)
  BGE-large-en-v1.5 (1024-dim, ~1.3GB)  ← quality benchmark
  all-MiniLM-L6-v2  (384-dim,  ~90MB)   ← current live index
  Results → data/embedding_comparison.json
      │
      ▼
ChromaDB (data/chroma/, collection: screenplay_scenes_minilm)
      │
      ▼
At query time (backend/rag/retrieve.py):
  Embed writer's text → cosine top-20 candidates
  → cross-encoder rerank (ms-marco-MiniLM-L-6-v2) → top-3
  → injected into instructor system prompt
```

**Corpus:** 36 screenplays — Pulp Fiction, Inception, Parasite, Django Unchained, Get Out, Gladiator, The Brutalist, The Substance, Anora, Past Lives, Succession (4 eps), Breaking Bad, True Detective (2 eps), Stranger Things, Westworld, and more.

**Files:** `scripts/convert_pdfs.py`, `scripts/parse_screenplay.py`, `scripts/build_rag_index.py`, `backend/rag/retrieve.py`

---

## Fine-Tuning: QLoRA Analyst (Planned)

**Goal:** Replace the API-call analyst layer with a fine-tuned open-source model (Phi-3-mini 3.8B) that produces the structured JSON more reliably and cheaply.

**Why it is not in the final build yet:** fine-tuning is primarily an optimization of the hidden analyst layer. It matters for reliability, controllability, and cost, but it does not improve the writer-facing experience as directly as retrieval does. Given the project timeline, the final build prioritized the feature with clearer product impact: grounded instructor responses via RAG.

**Training data generation:**

- Run Claude API analyst on 200–500 diverse screenplay excerpts
- Curate and correct the outputs (remove hallucinations, fix schema violations)
- Format as instruction-tuning pairs: `[screenplay excerpt] → [structured JSON]`

**Training setup:**

- Model: `microsoft/Phi-3-mini-4k-instruct`
- Method: QLoRA (4-bit quantization + LoRA adapters via PEFT library)
- Hardware: Colab Pro A100 or Duke computing cluster
- Libraries: HuggingFace Transformers, PEFT, bitsandbytes

**Files planned:** `notebooks/finetune_analyst.ipynb`, `scripts/generate_training_pairs.py`

---

## JSON Repair

**File:** `src/utils/repairJSON.ts`

The analyst prompt instructs Claude to return only JSON, but the response is frequently truncated mid-structure when approaching the token limit. `repairJSON()` handles this in four steps:

1. Strip trailing commas before `}` or `]`
2. Attempt parse as-is
3. If failed: walk the string tracking open brackets, remove trailing partial key-value pairs, close all unclosed structures
4. Final parse attempt

This is critical infrastructure. Any weakening of this function causes the structural map to fail silently.

---

## Frontend

**Main component:** `src/App.tsx` (`ScreenplayInstructor`)

**State:**

- `messages` — full conversation history
- `analysis` — parsed analyst JSON (set on first message, reused)
- `activeTab` — which map panel is visible (tension/characters/scenes)
- `showMap` — left panel toggle
- `selectedScene` — which scene card is expanded

**Layout:** 420px fixed left panel (structural map) + flexible right chat panel. The left panel only appears after the first message triggers analysis.

**Key interaction:** Shift+Enter = newline, Enter = send. All styling is inline CSS.
