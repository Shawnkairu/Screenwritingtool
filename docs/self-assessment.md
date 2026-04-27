# CS 372 Final Project — Self-Assessment

*The Instructor: A Socratic AI Screenwriting Mentor*
*Shawn Kairu | shawn.kairu@duke.edu | Solo project*

---

## Machine Learning Items Claimed

### 1. Deployed functional web application with UI (10 pts)

**Evidence:** `src/App.tsx`, `src/components/WritingEditorColumn.tsx`

The app runs locally at `http://localhost:5173` with:
- Live screenplay editor with formatting assistance and scene/act check-ins
- Structural visualization panel (tension arc, character web, scene breakdown)
- Instructor chat panel with full conversation history
- Real-time RAG retrieval on each message

To verify: `npm install && npm run dev`

---

### 2. Multi-stage ML pipeline (7 pts)

**Evidence:** `src/api.ts`, `backend/main.py`

Two-layer pipeline with structured JSON handoff:
1. **Analyst layer** (`POST /analyze`): silent, max 6000 tokens, returns structured JSON with scenes, characters, tension arc, skill level, draft stage
2. **Instructor layer** (`POST /chat`): receives analyst JSON as context, responds in Socratic mentor voice

The separation is a deliberate product decision: mixing analytical pattern recognition with mentor voice in a single call produces worse output.

---

### 3. Multi-turn conversation with context management (7 pts)

**Evidence:** `src/App.tsx` lines ~120–220 (`messages` state, `handleSendMessage`)

- First turn: fires analyst + instructor calls, stores analyst JSON in state
- Subsequent turns: skip analyst, reuse stored `analysis` as context
- Full `messages` array passed on each subsequent call for conversation history
- `current_screenplay` field allows Writing Environment editor to inject live draft

---

### 4. API calls to SOTA model (5 pts)

**Evidence:** `backend/main.py` (`_call_anthropic`, `_call_ollama`, `_call_openai_compat`), `src/api.ts`, `notebooks/qwen.ipynb`

Integrated with `claude-sonnet-4-6` via Anthropic API. Backend proxies all calls (no API key exposed to browser). Ollama path (`qwen2.5:7b-instruct`) available for local demo without credentials. Colab/vLLM path (`Qwen/Qwen2.5-14B-Instruct-AWQ`) is available for a stronger GPU-backed open-source demo through an OpenAI-compatible endpoint.

---

### 5. In-context learning / chain-of-thought prompting (5 pts)

**Evidence:** `src/system-prompts/instructor.ts`, `src/system-prompts/analysis.ts`

Instructor prompt encodes a structured reasoning chain:
- **TRIAGE INTELLIGENCE**: explicit instruction to identify highest-leverage observation first
- **DRAFT STAGE calibration**: different behavior for First Draft / Revision / Polish
- **FIVE DIMENSIONS**: structured feedback framework (structure, character, world, visual, consequence)
- **SURPRISE ENGINE**: collision surprise reasoning pattern

Analysis prompt encodes JSON schema inference with field-by-field CoT instructions.

---

### 6. Original dataset through substantial engineering (10 pts)

**Evidence:** `scripts/convert_pdfs.py`, `scripts/parse_screenplay.py`, `data/raw/`, `data/chunks/chunks.jsonl`, `data/chunks/stats.json`

- 35 professional screenplays converted from PDF/text
- Custom scene heading regex covering 4 formats (standard, scene-numbered, hyphen, em-dash)
- 3,648 scene chunks with metadata: act position, character list, scene type, char count
- `data/chunks/stats.json`: full corpus statistics

---

### 7. Custom RAG pipeline (10 pts)

**Evidence:** `scripts/build_rag_index.py`, `backend/rag/retrieve.py`, `backend/main.py`, `data/chroma/`

Full pipeline:
1. **Chunking**: scene-level structural chunks with act position metadata
2. **Embedding**: `all-MiniLM-L6-v2` (384-dim); comparison against `BAAI/bge-large-en-v1.5` (1024-dim)
3. **Vector store**: ChromaDB persistent collection (`screenplay_scenes_minilm`, 3,648 scenes)
4. **Retrieval**: cosine similarity top-20 candidates
5. **Reranking**: cross-encoder (`ms-marco-MiniLM-L-6-v2`), NaN fallback to cosine score
6. **Injection**: top-3 examples prepended to instructor system prompt at request time

---

### 8. Sentence embeddings for semantic similarity (5 pts)

**Evidence:** `scripts/build_rag_index.py`, `data/embedding_comparison.json`

Two models compared on 10 screenplay-domain retrieval queries:
- `BAAI/bge-large-en-v1.5`: 1024-dim, 100.2ms avg latency, 0.441 avg top-5 distance
- `all-MiniLM-L6-v2`: 384-dim, 217.8ms avg latency, 0.705 avg top-5 distance

BGE-large has better retrieval distance but higher CPU cost. MiniLM chosen for live index.

---

### 11. Error analysis with visualization (7 pts)

**Evidence:** `notebooks/error_analysis.ipynb` (7 sections, 5 figures)

Figures produced:
- `data/fig_heading_formats.png` — scene heading format distribution across corpus
- `data/fig_repair_json.png` — repairJSON robustness under 10–100% truncation
- `data/fig_corpus_quality.png` — char count distribution, chunks per screenplay
- `data/fig_retrieval_quality.png` — retrieval distance + reranker score distributions
- `data/fig_embedding_comparison.png` — BGE-large vs MiniLM latency and distance comparison

Key finding: `repairJSON()` recovers 100% of truncated fragments from 10–95% of original length; fails only at 5% (expected — no valid JSON structure).

---

### 12. Multiple model architectures compared quantitatively (7 pts)

**Evidence:** `scripts/build_rag_index.py`, `data/embedding_comparison.json`, `notebooks/error_analysis.ipynb` §5

BGE-large-en-v1.5 vs all-MiniLM-L6-v2 compared on:
- Embedding dimensions (1024 vs 384)
- Avg inference latency (100ms vs 218ms)
- Avg top-5 cosine distance (0.441 vs 0.705)
- Full-corpus build feasibility (BGE too slow on CPU; MiniLM completes)

Decision documented and justified in `docs/evaluation.md` §3.

---

### 13. Ablation study — 2+ independent design choices (5 pts)

**Evidence:** `scripts/run_ablation.py`, `data/ablation_results.json`, `notebooks/ablation_study.ipynb`

2×2 factorial: **analyst context** × **RAG examples**, 4 conditions × 5 excerpts.

Scoring: question count, craft terms, specificity (named-entity references), prescriptions.
Model: `qwen2.5:7b-instruct` via Ollama. Results in `data/ablation_results.json`.
Figures: `data/fig_ablation_quality.png`, `data/fig_ablation_heatmap.png`, `data/fig_ablation_latency.png`.

---

### 14. Prompt engineering — 3+ designs evaluated (3 pts)

**Evidence:** `scripts/run_prompt_comparison.py`, `data/prompt_comparison_results.json`, `docs/evaluation.md` §7

Three instructor prompt versions evaluated against the same excerpt (Breaking Bad pilot):
- **v1**: minimal Socratic constraint (2 paragraphs)
- **v2**: adds triage intelligence, draft-stage calibration, 5 feedback dimensions
- **v3**: adds SURPRISE ENGINE, competing desires, character specificity pressure, reference-the-map instructions

Scored on: question count, craft terms, specificity, prescriptions, Socratic rate.

---

### 15. Text preprocessing / tokenization pipeline (3 pts)

**Evidence:** `scripts/convert_pdfs.py`, `scripts/parse_screenplay.py`, `data/chunks/chunks.jsonl`

Pipeline:
1. PDF → plain text (pdfplumber, with empty-file removal for image-based PDFs)
2. Scene heading detection (4-format regex with optional scene number prefix)
3. Character extraction (handles flush-left and standard indented cue formats)
4. Metadata extraction: act position (from scene index), char count, interior/exterior flag
5. Output: JSONL with one record per scene, all metadata fields

---

## Exact Evidence References

Use these line ranges if the submission form asks for concrete evidence locations:

- **Multi-stage analyst → instructor pipeline:** `src/api.ts` lines 17-40 call `/analyze` and repair/validate analyst JSON; `src/api.ts` lines 60-86 send chat history, analyst context, RAG flag, and live screenplay text to `/chat`.
- **Open-source / hosted model switching:** `backend/main.py` lines 145-198 implement the OpenAI-compatible Colab/vLLM provider; `backend/main.py` lines 201-208 dispatch between Anthropic, Ollama, and Colab providers.
- **Fast demo structural map:** `backend/main.py` lines 248-341 implement the local quick-analysis fallback; `backend/main.py` lines 423-437 show `/analyze` using that fallback for Colab demo mode or the configured LLM otherwise.
- **RAG retrieval + reranking impact path:** `backend/rag/retrieve.py` lines 50-121 embed the query, retrieve Chroma candidates, rerank with a cross-encoder, and return top examples; `backend/rag/retrieve.py` lines 124-147 format retrieved scenes for prompt injection.
- **RAG integration into instructor prompt:** `backend/main.py` lines 456-474 retrieve top-3 examples and prepend them to the instructor system prompt; `backend/main.py` lines 480-499 include analyst context and return RAG usage metadata.
- **Screenplay preprocessing / chunking:** `scripts/parse_screenplay.py` lines 21-48 define scene-heading and character-cue detection; `scripts/parse_screenplay.py` lines 148-195 create scene chunks with metadata; `scripts/parse_screenplay.py` lines 198-227 write `chunks.jsonl` and corpus stats.
- **Embedding model comparison:** `scripts/build_rag_index.py` lines 23-35 define BGE-large vs MiniLM and the live index choice; `scripts/build_rag_index.py` lines 103-167 run the quantitative benchmark; `docs/evaluation.md` lines 108-119 report the comparison table.
- **Ablation study:** `scripts/run_ablation.py` lines 5-18 define the 2x2 design; `scripts/run_ablation.py` lines 75-93 define scoring metrics; `scripts/run_ablation.py` lines 164-169 define the four conditions; `docs/evaluation.md` lines 199-220 report the final results table.
- **Prompt engineering comparison:** `scripts/run_prompt_comparison.py` lines 22-56 define prompt versions v1/v2/v3; `scripts/run_prompt_comparison.py` lines 91-113 define scoring; `docs/evaluation.md` lines 230-250 report the comparison results.

---

## Score Summary

| Category | Max | Claimed |
|----------|-----|---------|
| Machine Learning (items 1,2,3,4,5,6,7,8,11,12,13,14,15) | 73 | 73 (84 pts claimed, capped) |
| Following Directions | 15 | 15 |
| Project Cohesion | 15 | 15 |
| Solo Bonus | +10 | +10 |
| **Total** | **103** | **113** |

---

## Solo Confirmation

This project was completed independently. No partner. Confirm on Gradescope.

---

## Technical Walkthrough Video Outline

*(10–15 min)*

1. **The product** (2 min) — open the app, paste a screenplay excerpt, show the instructor responding with a Socratic question, not a prescriptive suggestion. Point at the tension arc and character web populating in real time.

2. **Two-layer architecture** (2 min) — show the network tab: two API calls on first submission (analyst → instructor). Show the analyst JSON. Explain why the separation exists.

3. **RAG pipeline** (3 min) — run the RAG smoke test live (`curl http://localhost:8000/rag/status`). Show the retrieval working (`python3 -c "from rag import retrieve; ..."`). Explain cosine → cross-encoder reranking.

4. **Error analysis notebook** (2 min) — open `notebooks/error_analysis.ipynb`, scroll through the 5 figures. Highlight the repairJSON truncation chart.

5. **Ablation study** (2 min) — show `data/ablation_results.json`, open `notebooks/ablation_study.ipynb`, walk through the bar charts. Explain what the 2×2 factorial shows.

6. **Prompt engineering** (1 min) — show v1/v2/v3 in `scripts/run_prompt_comparison.py`, reference results.

7. **Demo without API key** (1 min) — show `LLM_PROVIDER=ollama` for fully local mode, or `LLM_PROVIDER=colab` with `notebooks/qwen.ipynb` for the GPU-backed Qwen 14B demo. Confirm `/llm/status` and `/rag/status` are ready.

8. **What's next** (30 sec) — fine-tuned analyst layer (QLoRA), hosted deployment, Character Workshop.
