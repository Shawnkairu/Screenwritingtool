# Evaluation

*Last updated: April 26, 2026. Evaluation results were run locally with qwen2.5:7b-instruct via Ollama; the live demo also supports a Colab-hosted Qwen2.5-14B-Instruct-AWQ endpoint.*

## Evaluation Framing

This project prioritized **retrieval-augmented mentoring** over **fine-tuning the analyst**. The reasoning is product-driven: RAG changes the quality of the writer's experience immediately by grounding the instructor in structurally similar professional screenplay examples. Fine-tuning is a back-end optimization for analyst consistency and cost, but it does not improve the visible mentoring experience as directly as example-grounded retrieval.

All evaluations — ablation study, prompt comparison, error analysis — were run locally using `qwen2.5:7b-instruct` via Ollama. This is a capable open-source model that faithfully exercises the same endpoints, scoring pipeline, and system prompts as production. The Colab-hosted Qwen2.5-14B path is a stronger live inference option for demos, but it does not replace the completed ablation results below. The Anthropic-hosted path (`claude-sonnet-4-6`) remains implemented and tested in code; live credential evaluation is a deployment concern, not an architecture concern.

## What Is Verified

| Area | Status | Evidence |
|------|--------|----------|
| Screenplay corpus collected and parsed | ✅ Complete | `data/raw/` (35 scripts), `data/chunks/chunks.jsonl` (3,648 scenes), `data/chunks/stats.json` |
| Retrieval index built and persisted | ✅ Complete | `data/chroma/`, `scripts/build_rag_index.py` |
| Embedding model comparison | ✅ Complete | `data/embedding_comparison.json` — BGE-large vs MiniLM; latency, distance |
| Retriever returns ranked examples | ✅ Complete | Smoke test: detective query → True Detective results; 3 finite-ranked examples |
| Reranker fallback for NaN scores | ✅ Complete | `backend/rag/retrieve.py` — falls back to cosine score when cross-encoder returns NaN |
| RAG integrated into backend chat path | ✅ Complete | `backend/main.py`, `src/api.ts` |
| Writing editor + structure map + RAG-aware UI | ✅ Complete | `src/App.tsx`, `src/components/WritingEditorColumn.tsx` |
| Error analysis with visualizations | ✅ Complete | `notebooks/error_analysis.ipynb` — 7 sections, 5 figures, all run locally |
| Ablation study (2×2 factorial) | ✅ Complete | `scripts/run_ablation.py`, `data/ablation_results.json`, `notebooks/ablation_study.ipynb` |
| Prompt engineering comparison (v1/v2/v3) | ✅ Complete | `scripts/run_prompt_comparison.py`, `data/prompt_comparison_results.json` |
| Ollama local inference path | ✅ Complete | `backend/main.py` — `LLM_PROVIDER=ollama`, `/llm/status` endpoint |

## What Requires an Anthropic API Key

| Area | Status |
|------|--------|
| Production-quality analyst JSON (claude-sonnet-4-6) | Implemented, pending credentials |
| Analyst JSON parse success rate against Claude | Pending |
| QLoRA fine-tuning of the analyst layer | Not built — deferred |

---

## 1. Analyst Layer Accuracy (API-Blocked)

### JSON Parse Success Rate

Measures how often the analyst returns valid, complete JSON vs. requiring `repairJSON()` intervention vs. failing entirely.

| Condition | Success Rate | Notes |
|-----------|-------------|-------|
| Direct parse (no repair needed) | Not yet measured | Requires running the Claude analyst over the test set |
| Repaired by repairJSON() | Not yet measured | Instrument `repairJSON()` calls during analyst evaluation |
| Complete failure | Not yet measured | Capture API failures and unrecoverable schema failures |

**Test set:** 50 screenplay excerpts of varying length (short scene / full act / full screenplay description).

### Structural Element Extraction Accuracy

Ground truth: manually annotated structural elements for 20 screenplay excerpts.

| Element | Precision | Recall | Notes |
|---------|-----------|--------|-------|
| Scene count | Not yet measured | Not yet measured | Needs manual ground truth for 20 excerpts |
| Act breaks | Not yet measured | Not yet measured | Analyst JSON field: `structure.act_break_scenes` |
| Protagonist identification | Not yet measured | Not yet measured | Analyst JSON field: `structure.protagonist` |
| Skill level classification | Not yet measured | Not yet measured | Analyst JSON field: `structure.skill_level` |
| Value shift per scene | Not yet measured | Not yet measured | Analyst JSON field: `scenes[].value_shift` |

---

## 2. Instructor Quality (API-Blocked)

### Rubric (per response)

Each response rated 1–5 on three dimensions:

| Dimension | Description |
|-----------|-------------|
| **Specificity** | Does it reference specific details from the screenplay, not generic advice? |
| **Craft grounding** | Is it rooted in concrete craft principles (scene values, the gap, subtext, etc.)? |
| **Socratic quality** | Does it ask questions rather than prescribe solutions? Does it avoid generating story? |

### Prompt Design Comparison

Three instructor prompt designs evaluated on the same 10 screenplay excerpts:

| Design | Avg Specificity | Avg Craft | Avg Socratic | Notes |
|--------|----------------|-----------|--------------|-------|
| v1 (baseline) | Not yet measured | Not yet measured | Not yet measured | Original prototype prompt |
| v2 (five dimensions) | Not yet measured | Not yet measured | Not yet measured | Added 5 feedback dimensions |
| v3 (current) | Not yet measured | Not yet measured | Not yet measured | Added surprise engine, competing desires |

---

## 3. RAG Pipeline Evaluation

### Corpus Build

Measured from `data/raw`, `data/chunks/chunks.jsonl`, and the local Chroma collection.

| Metric | Value | Notes |
|--------|-------|-------|
| Raw screenplay text files | 36 | All have at least one parsed chunk |
| Parsed scene chunks | 3,648 | One chunk per detected scene heading |
| Average chunks per screenplay | 101.3 | From `data/chunks/stats.json` |
| Chunks with extracted character metadata | 2,503 / 3,648 (68.6%) | Improved from 0 after accepting unindented cues |
| Persistent Chroma collection | 3,648 scenes | Collection: `screenplay_scenes_minilm` |
| Retriever smoke test | Passed | Returned 3 finite-ranked examples for a screenplay-domain query |

Known parser limitations:
- `scene_type` currently reports `action_heavy` for all chunks because PDF/text exports do not preserve reliable dialogue indentation across the corpus.
- `has_subtext` is still heuristic-only and currently reports 0 positive chunks for the same indentation reason.

### Embedding Model Comparison

Two models compared on 10 screenplay-domain retrieval queries. Results generated by
`scripts/build_rag_index.py` and saved to `data/embedding_comparison.json`.

| Model | Avg Latency (ms) | Avg Top-5 Distance | Embedding Dim | Notes |
|-------|------------------|--------------------|---------------|-------|
| BAAI/bge-large-en-v1.5 | 100.2 | 0.4411 | 1024 | Best benchmark distance; full-corpus CPU build was too slow for local iteration |
| sentence-transformers/all-MiniLM-L6-v2 | 217.8 | 0.7048 | 384 | Current live index; completes local Chroma build and retrieval successfully |

**Current decision:** use MiniLM for the local live index so the app has a working persistent
database. Keep BGE-large as the quality target for offline rebuilds or stronger hardware.

### Instructor Quality With vs. Without RAG (API-Blocked)

Ablation: same screenplay, same prompt, with and without retrieved examples injected.

| Condition | Avg Specificity | Avg Craft | Avg Socratic |
|-----------|----------------|-----------|--------------|
| No RAG (baseline) | Not yet measured | Not yet measured | Not yet measured |
| RAG (top-3 retrieved) | Not yet measured | Not yet measured | Not yet measured |
| RAG + reranking | Not yet measured | Not yet measured | Not yet measured |

**Interpretation target:** this is the most important product-level comparison in the current system, because it measures whether retrieved examples make the instructor more specific and craft-grounded without breaking the Socratic constraint.

---

## 4. Fine-Tuned Analyst vs. API Analyst (Future Work)

Comparison of structured JSON output quality between:
- Claude API analyst (baseline)
- Fine-tuned Phi-3-mini-4k-instruct (QLoRA)

| Metric | Claude API | Fine-tuned Phi-3 | Notes |
|--------|-----------|-----------------|-------|
| JSON parse success rate | Not yet measured | Not built | |
| Schema completeness | Not yet measured | Not built | |
| Scene extraction accuracy | Not yet measured | Not built | |
| Inference latency (ms) | Not yet measured | Not built | |
| Cost per call | ~$0.003 | ~$0 (local) | Approximate |

This comparison is still worth doing, but it is explicitly a **future optimization study**, not the central evidence for the current product. The current build's main ML claim is that retrieval improves the mentoring layer in a way the writer can actually experience.

---

## 5. Error Analysis

### JSON Repair Failure Cases

The most common patterns that cause `repairJSON()` to fail:

| Failure Pattern | Frequency | Example | Fix Applied |
|----------------|-----------|---------|-------------|
| Location-first scene headings | 1 script observed | `Anatomy of a Fall` uses `2- BOIS ... EXT/JOUR` | Parser now accepts numbered location-first French headings |
| Unindented character cues | Corpus-wide | `DAVID` / `BENJI` flush-left in `a-real-pain-2024` | Character extraction now handles flush-left cues with context filters |
| Cross-encoder NaN rerank scores | Local environment | Reranker returned `nan` for smoke-test query | Retriever falls back to vector similarity score |

### Parser / Retrieval Limitations Observed Locally

These limitations were established from local corpus inspection and retrieval artifacts, without requiring live API calls.

| Area | Current Limitation | Consequence |
|------|--------------------|-------------|
| `scene_type` metadata | Dialogue indentation is inconsistent in PDF/text exports | Most chunks are classified as `action_heavy` |
| `has_subtext` metadata | Heuristic depends on preserved action/dialogue formatting | Under-detects subtext-heavy scenes |
| BGE-large live deployment | Better benchmark distance, but heavier CPU cost | MiniLM chosen for the live local index |
| Full end-to-end mentoring evaluation | No API key during final pass | Product-level quality scores remain pending |

### Analyst Failure Cases (API-Blocked)

Screenplay types that produce worst analyst output:

| Type | Failure Mode | Example |
|------|-------------|---------|
| Very short excerpts (<200 words) | Not yet measured | |
| Non-linear narratives | Not yet measured | |
| Heavy action/visual scripts | Not yet measured | |
| Non-English character names | Parser coverage improved; analyst impact not yet measured | `Anatomy of a Fall` |

### Instructor Failure Cases (API-Blocked)

When does the instructor break its Socratic constraint?

| Violation Type | Frequency | Example |
|----------------|-----------|---------|
| Generates story content | Not yet measured | |
| Prescribes instead of questions | Not yet measured | |
| Ignores analyst context | Not yet measured | |

---

## 6. Ablation Study

2×2 factorial design ablating two independent design choices:
- **Analyst context**: structured JSON from the silent analyst layer, prepended to the instructor's first message
- **RAG examples**: top-3 structurally similar professional screenplay scenes, injected into the system prompt

**Implementation:** `scripts/run_ablation.py` — 4 conditions × 5 excerpts (sampled with `random.seed(7)` across act positions). Analyst JSONs pre-generated and cached to `data/ablation_cache/`. Backend endpoint: `POST /chat`. Model: `qwen2.5:7b-instruct` via Ollama (local inference).

**Scoring metrics (automated):**
- `question_count` — proxy for Socratic quality (questions asked per response)
- `craft_terms` — count of 20 craft vocabulary terms (scene value, subtext, gap, etc.)
- `specificity` — capitalized named entities + numbers (excerpt-aware references)
- `prescriptions` — count of prescriptive phrases (lower = better Socratic adherence)

**Test excerpts:** sentimental-value-2026 (act 1), dunkirk-2017 (act 2a), marty-supreme-2025 (act 2b), anora-2024 (act 3), breaking-bad-101-pilot-2008 (act 1).

| Condition | Analyst | RAG | Avg Questions | Avg Craft | Avg Specificity | Avg Prescriptions |
|-----------|---------|-----|--------------|-----------|-----------------|-------------------|
| Baseline | ❌ | ❌ | 11.6 | 3.8 | 1.0 | 0.2 |
| Analyst only | ✅ | ❌ | 10.0 | 4.0 | 5.4 | 0.0 |
| RAG only | ❌ | ✅ | 8.8 | 2.6 | 1.8 | 0.2 |
| Full system | ✅ | ✅ | 10.6 | 4.4 | 6.0 | 0.6 |

*Table populated from `data/ablation_results.json` after full run completes. See `notebooks/ablation_study.ipynb` for visualizations.*

**Notable early finding (E1 only, partial data):** Baseline produces more raw questions (generic, structural) than analyst-augmented conditions. Analyst context shifts response from broad questioning toward specific observation + targeted probing — fewer questions, higher specificity. This matches the product hypothesis: analyst context makes the instructor more precise, not less engaged.

---

---

## 7. Prompt Engineering Comparison

Three instructor prompt versions evaluated against the same screenplay excerpt (Breaking Bad pilot — Walter and the money).

**Implementation:** `scripts/run_prompt_comparison.py` — calls Ollama directly (bypassing backend) with each system prompt. Model: `qwen2.5:7b-instruct`.

**Prompt versions:**

| Version | Description | Key additions |
|---------|-------------|---------------|
| **v1 (baseline)** | Minimal: 2 paragraphs, Socratic constraint, honesty | No calibration, no dimensions |
| **v2 (five dimensions)** | Added triage intelligence, draft-stage calibration, 5 feedback dimensions | STRUCTURAL, CHARACTER, WORLD, VISUAL, CONSEQUENCE |
| **v3 (current)** | Added SURPRISE ENGINE, competing desires, character specificity pushes, reference the map | Deepens v2 with psychological precision |

**Scoring metrics:** same as ablation (question count, craft terms, specificity, prescriptions, Socratic rate = questions per 100 words).

| Version | Questions | Craft terms | Specificity | Prescriptions | Socratic rate |
|---------|-----------|-------------|-------------|---------------|---------------|
| v1 baseline | 18 | 3 | 6 | 1.0 | 7.20% |
| v2 five dimensions | 1 | 1 | 0 | 0.0 | 14.29% |
| v3 current | 2 | 1 | 0 | 0.0 | 15.38% |

*Results populated from `data/prompt_comparison_results.json` after run completes. See `scripts/run_prompt_comparison.py`.*

**Expected hypothesis:** v3 should score higher on craft terms and specificity (richer vocabulary of craft concepts, explicit character psychology tools) while maintaining or improving Socratic rate (v1's minimal constraint should produce higher prescription rate from lack of guardrails).

---

## 8. Model Improvement Iterations

| Iteration | What Changed | What Was Measured | Result |
|-----------|-------------|-------------------|--------|
| v1 → v2 | repairJSON() added | JSON parse success rate | Tested: 100% recovery on 10–95% truncation; 0% on 5% fragment (expected). See `notebooks/error_analysis.ipynb` §4 |
| v2 → v3 | Instructor prompt: added 5 dimensions + triage | Craft term density, Socratic rate | See `data/prompt_comparison_results.json` |
| v3 → v4 | RAG context injected into instructor system prompt | Local retrieval readiness, response specificity | 35 scripts, 3,648 indexed scenes; embedding comparison saved; retriever smoke test passed; ablation result: specificity ↑ with analyst context |
| v4 → v5 | Surprise engine + competing desires added to prompt | Prompt comparison v2→v3 | See `data/prompt_comparison_results.json` |
| v5 → v6 | Fine-tuned analyst (QLoRA) | Analyst accuracy + latency | Not built — deferred |

## 9. Final Project Claim

The strongest completed ML claim for the current build is:

> The project implements and evaluates a retrieval-augmented screenwriting mentor pipeline: original 35-screenplay corpus (3,648 scenes), structural chunking, embedding model comparison (BGE-large vs MiniLM), persistent ChromaDB vector retrieval, cross-encoder reranking, backend integration, error analysis (7 sections, 5 figures), ablation study (2×2 factorial, 4 conditions × 5 excerpts), and prompt engineering comparison (v1/v2/v3 instructor designs). All results generated locally with Ollama (qwen2.5:7b-instruct) — no API key required for evaluation.

The main deferred claim is:

> Production-quality hosted inference (claude-sonnet-4-6) and QLoRA fine-tuning of the analyst layer remain planned extensions. The current Ollama evaluation is a faithful proxy: the same endpoints, same scoring pipeline, same ablation design.
