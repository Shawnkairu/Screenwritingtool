"""
RAG retrieval: embed a query, fetch top-k from ChromaDB, rerank, return examples.

The retriever is imported by the FastAPI backend and called before each
instructor API call to inject structurally relevant screenplay examples.
"""

from __future__ import annotations

import os
import math
from functools import lru_cache
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder

# Paths — relative to project root (backend runs from project root)
CHROMA_PATH = str(Path(__file__).parent.parent.parent / "data" / "chroma")
COLLECTION_NAME = "screenplay_scenes_minilm"
EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


@lru_cache(maxsize=1)
def _get_embedder() -> SentenceTransformer:
    print(f"[RAG] Loading embedding model: {EMBED_MODEL_NAME}")
    return SentenceTransformer(EMBED_MODEL_NAME, trust_remote_code=True)


@lru_cache(maxsize=1)
def _get_reranker() -> CrossEncoder:
    print(f"[RAG] Loading reranker: {RERANK_MODEL_NAME}")
    return CrossEncoder(RERANK_MODEL_NAME)


@lru_cache(maxsize=1)
def _get_collection() -> chromadb.Collection | None:
    if not Path(CHROMA_PATH).exists():
        print("[RAG] Chroma DB not found — run scripts/build_rag_index.py first.")
        return None
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    try:
        return client.get_collection(COLLECTION_NAME)
    except Exception as e:
        print(f"[RAG] Collection not found: {e}")
        return None


def retrieve(
    query_text: str,
    n_candidates: int = 20,
    n_final: int = 3,
    filter_metadata: dict | None = None,
) -> list[dict]:
    """
    Retrieve and rerank the most structurally relevant screenplay scenes
    for a given query (typically the writer's submitted screenplay text).

    Returns a list of dicts with keys: title, scene_heading, text, score.
    Returns [] if the index isn't built yet (graceful degradation).
    """
    collection = _get_collection()
    if collection is None or collection.count() == 0:
        return []

    embedder = _get_embedder()

    # Embed the query (first 512 tokens worth — enough for a scene)
    query_snippet = query_text[:2000]
    q_emb = embedder.encode([query_snippet], normalize_embeddings=True).tolist()

    # Initial retrieval — get more candidates than we need for reranking
    where = filter_metadata if filter_metadata else None
    results = collection.query(
        query_embeddings=q_emb,
        n_results=min(n_candidates, collection.count()),
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    if not results["ids"] or not results["ids"][0]:
        return []

    candidates = [
        {
            "id": results["ids"][0][i],
            "text": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "distance": results["distances"][0][i],
        }
        for i in range(len(results["ids"][0]))
    ]

    # Rerank using cross-encoder for higher precision
    reranker = _get_reranker()
    pairs = [(query_snippet, c["text"][:512]) for c in candidates]
    scores = reranker.predict(pairs)

    for i, candidate in enumerate(candidates):
        score = float(scores[i])
        if not math.isfinite(score):
            # Some local torch/MPS combinations can produce NaN cross-encoder
            # scores. Fall back to vector similarity so retrieval remains usable.
            score = 1.0 - float(candidate["distance"])
        candidate["rerank_score"] = score

    candidates.sort(key=lambda x: x["rerank_score"], reverse=True)
    top = candidates[:n_final]

    return [
        {
            "title": c["metadata"].get("title", "Unknown"),
            "scene_heading": c["metadata"].get("scene_heading", ""),
            "act_position": c["metadata"].get("act_position", ""),
            "scene_type": c["metadata"].get("scene_type", ""),
            "text": c["text"],
            "rerank_score": c["rerank_score"],
        }
        for c in top
    ]


def format_rag_context(examples: list[dict]) -> str:
    """
    Format retrieved examples for injection into the instructor's system context.
    Returns empty string if no examples.
    """
    if not examples:
        return ""

    lines = [
        "[STRUCTURALLY SIMILAR PROFESSIONAL EXAMPLES — for reference only]",
        "These scenes share structural characteristics with the writer's material.",
        "You may reference these as craft examples when relevant, but do not describe them",
        "unless they directly illuminate a point you are making.\n",
    ]

    for i, ex in enumerate(examples, 1):
        lines.append(f"--- Example {i}: {ex['title']} ({ex['act_position'].replace('_', ' ')}) ---")
        lines.append(ex["scene_heading"])
        # Include first 400 chars of scene text — enough for craft reference
        snippet = ex["text"][len(ex["scene_heading"]):].strip()[:400]
        lines.append(snippet)
        lines.append("")

    return "\n".join(lines)
