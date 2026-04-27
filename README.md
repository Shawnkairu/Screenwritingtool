# The Instructor

A Socratic AI screenwriting mentor for serious writers. The Instructor never generates story, it interrogates the writer's choices through questions and gives feedback until the story is airtight. I was thinking about David Benioff (Game of Thrones Show Runner), and whether this tool would have helped them stick the landing in the last season of GoT having run out of story supply from G.R.R Martin. This tool is aimed at helping writers think more like World Builders and always strive for nuance. 

**Core constraint:** Reactive, not generative. It challenges, provokes, and questions. It never writes for the writer.

---

## What It Does

Write/Paste a screenplay excerpt or scene. The Instructor:

1. **Maps the structure** — a silent analyst layer parses the screenplay into structured JSON: tension arc, character profiles, relationship graph, scene-by-scene value shifts, structural markers
2. **Opens a dialogue** — a Socratic instructor voice, calibrated to your skill level and draft stage, surfaces the 1–2 highest-leverage observations and asks the questions you can't dodge
3. **Tracks the conversation** — subsequent messages maintain full screenplay context; the instructor follows threads, pushes on evasions, and notices what you've fixed

The left panel shows the living structural map (tension graph, character web, scene breakdown). The right panel is the instructor conversation. Both update in real time.

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full technical breakdown.

**Why RAG before fine-tuning:** For this project, retrieval adds the clearest immediate product value. The instructor becomes more grounded by pulling structurally similar professional screenplay scenes at response time, which directly improves the writer-facing experience. Fine-tuning the analyst remains a promising future optimization for reliability and cost, but it does not improve the visible mentoring experience as directly as RAG.

**Two-layer API system:**

```
Screenplay input
      │
      ▼
┌─────────────────┐
│  Analyst Layer  │  ← Silent. Returns structured JSON only.
│      (Qwen)     │      Scenes, characters, relationships,
│                 │    structure, skill level, draft stage.
└────────┬────────┘
         │ JSON
         ▼
┌─────────────────┐
│ Instructor Layer│  ← Has personality. Socratic mentor voice.
│  (    Qwen  )   │    Receives analyst JSON as context.
│                 │    Calibrates to skill level + draft stage.
└─────────────────┘
         │ Response
         ▼
   Writer's screen
```
## Product Demo
1. https://www.loom.com/share/207a8c3dd0e846cda1ba5a13a2c1328c
2. https://www.loom.com/share/fa1a548ebbf2422fa8b0e3f9d34a8dba

## Technical Demo
https://www.loom.com/share/588ed635099f4187acc398ca3ce095c2 


**Tech stack:**
- Frontend: React 19 + TypeScript + Vite
- Visualizations: Recharts (tension arc, character web)
- AI: Ollama with Qwen 7B
- Backend: FastAPI
- RAG: sentence-transformers + ChromaDB


**Current verification status:** the corpus, parser, embeddings, Chroma index, retrieval, reranking, and app integration are all verifiable locally. Live analyst/instructor evaluation requires an Anthropic API key.

---

## ML Components

| Component | Description | Status |
|-----------|-------------|--------|
| Two-stage LLM pipeline | Analyst → Instructor, structured JSON handoff | Complete |
| Multi-turn conversation | Full history + screenplay context across turns | Complete |
| Instructor system prompt | Socratic reasoning, calibrated to skill level and draft stage | Complete |
| Writing Environment | Live screenplay editor, formatting assistance, scene/act check-ins | Complete |
| Prompt engineering | 3+ prompt designs evaluated against quality rubric | Complete |
| Screenplay dataset | Scraped + parsed screenplay corpus for RAG and fine-tuning | Complete |
| Custom RAG pipeline | Structural chunking, embedding comparison, ChromaDB retrieval, backend injection | Complete |
| QLoRA fine-tuning | Phi-3-mini fine-tuned as analyst layer on screenplay→JSON pairs | Planned |
| Error analysis | JSON repair failures, analyst accuracy, instructor quality | Complete |
| Model comparison | Fine-tuned analyst vs. API analyst, quantitative evaluation | Complete |

---

## Setup

### Frontend
```bash
npm install
npm run dev        # http://localhost:5173
```

Create `.env.local`:
```
VITE_USE_BACKEND=true
VITE_BACKEND_URL=http://localhost:8000

# Local open-source demo mode (no hosted API key required)
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b-instruct
```

### Backend + RAG
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload   # http://localhost:8000
```

The ChromaDB vector index is not stored in the repo (too large). Build it once before starting the backend:
```bash
# From project root (not inside backend/)
python3 scripts/build_rag_index.py
# Indexes 3,648 scenes, saves to data/chroma/  (~2-3 min on CPU)
```

### Local Qwen/Ollama Inference

The backend can run without an Anthropic key by calling a local model through Ollama.

```bash
# Install Ollama first: https://ollama.com/download
ollama pull qwen2.5:7b-instruct
ollama serve
```

Then start the backend with `LLM_PROVIDER=ollama`. Check readiness:

```bash
curl http://localhost:8000/llm/status
curl http://localhost:8000/rag/status
```

### Colab Qwen 14B Demo Mode

For a faster hosted open-source demo, run `notebooks/qwen.ipynb` on a Colab GPU. It serves `Qwen/Qwen2.5-14B-Instruct-AWQ` through vLLM and exposes it through a Cloudflare Tunnel. Then start the local backend with:

```bash
LLM_PROVIDER=colab \
OPENAI_COMPAT_BASE_URL=https://your-cloudflare-url.trycloudflare.com \
OPENAI_COMPAT_MODEL=Qwen/Qwen2.5-14B-Instruct-AWQ \
OPENAI_COMPAT_MAX_TOKENS=500 \
OPENAI_COMPAT_STREAM=true \
OPENAI_COMPAT_FAST_ANALYSIS=true \
PYTHONPATH=backend python3 -m uvicorn backend.main:app --port 8002
```

`OPENAI_COMPAT_FAST_ANALYSIS=true` keeps the structural map responsive for demos while the instructor response still comes from Qwen 14B with RAG context.

When an Anthropic key is available, switch `.env.local` back to hosted inference:

```bash
LLM_PROVIDER=anthropic
VITE_ANTHROPIC_API_KEY=your_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-6
```

> **Note:** Direct browser-to-API calls are for development only. Production deployment requires a backend proxy — never expose API keys to the browser.

---

## Evaluating Without an API Key

The entire data pipeline, RAG index, and retrieval system can be verified locally with no API key.

**1. Check the RAG index is live:**
```bash
curl http://localhost:8000/rag/status
# → {"ready": true, "count": 3648, "message": "3648 scenes indexed"}
```

**2. Run a retrieval smoke test (no API key needed):**
```bash
python3 -c "
import sys; sys.path.insert(0, 'backend')
from rag import retrieve
results = retrieve('a character confronts their father about a secret from the past', n_final=3)
for r in results:
    print(f\"[{r['title']}] {r['scene_heading']}\")
    print(f\"  Act: {r['act_position']} | Score: {r['rerank_score']:.3f}\")
"
```

**3. Inspect the embedding model comparison:**
```bash
python3 -c "
import json
d = json.load(open('data/embedding_comparison.json'))
for model, r in d.items():
    print(f\"{model}: {r['avg_latency_ms']}ms avg latency\")
"
```

**4. Inspect the corpus stats:**
```bash
python3 -c "import json; print(json.dumps(json.load(open('data/chunks/stats.json')), indent=2))"
```

**What requires a hosted API key:** nothing for the local demo if `LLM_PROVIDER=ollama` and Qwen is installed. The Anthropic path remains implemented for production-quality hosted inference when credentials are available.

---

## Project Structure

```
src/
  App.tsx                      # Main ScreenplayInstructor component
  api.ts                       # Analyst + instructor API calls
  types.ts                     # TypeScript interfaces
  components/
    CharacterWeb.tsx            # SVG relationship diagram
    SceneCard.tsx               # Expandable scene detail
    StructurePanel.tsx          # High-level structural summary
    TensionTooltip.tsx          # Custom Recharts tooltip
    WritingEditorColumn.tsx     # Live screenplay editor with check-ins
  system-prompts/
    analysis.ts                 # Analyst layer prompt (JSON only)
    instructor.ts               # Instructor voice prompt (Socratic mentor)
  utils/
    repairJSON.ts               # Handles truncated analyst responses
    screenplayFormat.ts         # Screenplay formatting helpers for editor
backend/
  main.py                       # FastAPI proxy for analyst/chat + RAG status
  rag/retrieve.py               # Retrieval + reranking + prompt injection
docs/
  architecture.md               # Full technical architecture
  evaluation.md                 # Evaluation results and analysis
scripts/                        # Data collection and training scripts
ATTRIBUTION.md                  # AI tool usage documentation
```

---

## Instructor Behavior Rules

These are product constraints, not implementation details:

- **Never generates story content.** No plot suggestions, no dialogue, no scene rewrites.
- **Interrogates, doesn't prescribe.** Not "this scene has no conflict" — instead "I notice this scene sits in a calm space. Is that intentional? What is it doing for your story?"
- **Calibrates to skill level** (detected from the screenplay): beginner gets principles, intermediate gets subtext pressure, advanced gets sparring-partner challenge.
- **Calibrates to draft stage**: First Draft values momentum; Revision goes granular; Polish misses nothing.
- **Triage intelligence**: Surfaces the 1–2 highest-leverage observations and waits for the writer's response.

---

## Why This ML Stack

The project uses two complementary ML ideas, but they do different jobs:

- **Prompted analyst + instructor layers** handle structural interpretation and the Socratic mentoring voice.
- **RAG** grounds the instructor in retrieved professional screenplay examples when the writer's material matches relevant structural patterns.

For the final project build, RAG was prioritized over fine-tuning because it improves the product in the way the writer can feel immediately: more specific, example-grounded feedback. Fine-tuning is still valuable, but mostly as a back-end optimization for the analyst layer's schema reliability, consistency, and long-term cost.

---

## Roadmap

- [x] Structural map (tension arc, character web, scene breakdown)
- [x] RAG pipeline (inject professional screenplay examples)
- [ ] QLoRA fine-tuned analyst layer *(future optimization)*
- [x] Writing Environment (live editor with check-ins at scene/act breaks)
- [ ] Character Workshop (deep interrogation → persistent profiles)
- [ ] Dynamic Mind Map (connective tissue linking all elements)

---
