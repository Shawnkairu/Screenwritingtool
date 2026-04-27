"""
Embed scene chunks and load them into ChromaDB.
Compares two embedding models (BGE vs Nomic) — results logged for
the embedding model comparison rubric item.

Usage:
    python scripts/build_rag_index.py --chunks data/chunks/chunks.jsonl

    # To rebuild from scratch:
    python scripts/build_rag_index.py --chunks data/chunks/chunks.jsonl --reset
"""

import argparse
import json
import time
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

CHROMA_PATH = "data/chroma"

# Models to compare — results logged to data/embedding_comparison.json
# BGE-large-en-v1.5: large specialized retrieval model (~1.3GB, 1024-dim)
# all-MiniLM-L6-v2:  small general-purpose model (~90MB, 384-dim) — baseline comparison
EMBEDDING_MODELS = {
    "bge-large": "BAAI/bge-large-en-v1.5",
    "minilm": "sentence-transformers/all-MiniLM-L6-v2",
}

# Primary model used for the actual local index. MiniLM keeps the app responsive
# on CPU while the larger BGE model remains available for offline comparison.
PRIMARY_MODEL = "minilm"
COLLECTION_NAME = "screenplay_scenes"
BATCH_SIZE = 64


def load_chunks(path: Path) -> list[dict]:
    chunks = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                chunks.append(json.loads(line))
    return chunks


def build_index(chunks: list[dict], model_key: str, reset: bool) -> chromadb.Collection:
    model_name = EMBEDDING_MODELS[model_key]
    print(f"\nLoading embedding model: {model_name}")
    model = SentenceTransformer(model_name, trust_remote_code=True)

    collection_name = f"{COLLECTION_NAME}_{model_key}"
    client = chromadb.PersistentClient(path=CHROMA_PATH)

    if reset:
        try:
            client.delete_collection(collection_name)
            print(f"Deleted existing collection: {collection_name}")
        except Exception:
            pass

    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    existing_count = collection.count()
    if existing_count > 0 and not reset:
        print(f"Collection already has {existing_count} items. Use --reset to rebuild.")
        return collection

    print(f"Embedding {len(chunks)} chunks in batches of {BATCH_SIZE}...")
    total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        batch = chunks[batch_idx * BATCH_SIZE:(batch_idx + 1) * BATCH_SIZE]
        texts = [c["text"] for c in batch]
        ids = [c["id"] for c in batch]
        metadatas = [
            {
                "title": c["title"],
                "act_position": c["act_position"],
                "scene_type": c["scene_type"],
                "has_subtext": str(c["has_subtext"]),
                "is_interior": str(c["is_interior"]),
                "scene_heading": c["scene_heading"][:100],
                "approx_page": str(round(c.get("approx_page", 0), 1)),
            }
            for c in batch
        ]

        embeddings = model.encode(texts, normalize_embeddings=True).tolist()
        collection.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)

        if (batch_idx + 1) % 10 == 0 or batch_idx == total_batches - 1:
            print(f"  Batch {batch_idx + 1}/{total_batches} ({(batch_idx + 1) * BATCH_SIZE} chunks)")

    print(f"Index built: {collection.count()} chunks in collection '{collection_name}'")
    return collection


def compare_models(chunks: list[dict], output_path: Path) -> None:
    """
    Run a small retrieval benchmark comparing both embedding models.
    Uses 10 sample queries, measures latency and reports top-5 results.
    Results saved for the embedding model comparison rubric item.
    """
    sample_queries = [
        "a character confronts their father about a secret from the past",
        "two strangers meet in an unexpected place and feel an instant connection",
        "a detective examines a crime scene alone at night",
        "a character must make an impossible choice under time pressure",
        "a quiet scene where nothing is said but everything changes",
        "a group plans a heist or dangerous mission",
        "a character discovers they have been betrayed by someone they trusted",
        "an argument between two people who love each other",
        "a character runs from something, either physically or emotionally",
        "a moment of unexpected comedy in an otherwise tense situation",
    ]

    results = {}
    sample_chunks = chunks[:500]  # Use first 500 for comparison speed

    for model_key, model_name in EMBEDDING_MODELS.items():
        print(f"\nBenchmarking: {model_key} ({model_name})")
        model = SentenceTransformer(model_name, trust_remote_code=True)

        # Build in-memory index for comparison
        client = chromadb.EphemeralClient()
        col = client.create_collection(f"compare_{model_key}", metadata={"hnsw:space": "cosine"})
        texts = [c["text"] for c in sample_chunks]
        ids = [c["id"] for c in sample_chunks]
        embeddings = model.encode(texts, normalize_embeddings=True).tolist()
        col.add(ids=ids, embeddings=embeddings, documents=texts)

        query_results = []
        for query in sample_queries:
            start = time.time()
            q_emb = model.encode([query], normalize_embeddings=True).tolist()
            res = col.query(query_embeddings=q_emb, n_results=5)
            latency_ms = (time.time() - start) * 1000

            query_results.append({
                "query": query,
                "latency_ms": round(latency_ms, 2),
                "top_results": [
                    {"id": res["ids"][0][i], "distance": round(res["distances"][0][i], 4)}
                    for i in range(len(res["ids"][0]))
                ],
            })

        avg_latency = sum(r["latency_ms"] for r in query_results) / len(query_results)
        results[model_key] = {
            "model_name": model_name,
            "avg_latency_ms": round(avg_latency, 2),
            "queries": query_results,
        }
        print(f"  Avg latency: {avg_latency:.1f}ms")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2))
    print(f"\nComparison saved to {output_path}")
    print("\nSummary:")
    for key, r in results.items():
        print(f"  {key}: {r['avg_latency_ms']}ms avg")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--chunks", type=str, default="data/chunks/chunks.jsonl")
    parser.add_argument("--reset", action="store_true", help="Delete and rebuild index")
    parser.add_argument("--compare-only", action="store_true",
                        help="Only run model comparison, don't build full index")
    args = parser.parse_args()

    chunks_path = Path(args.chunks)
    if not chunks_path.exists():
        print(f"Chunks file not found: {chunks_path}")
        print("Run parse_screenplay.py first.")
        exit(1)

    chunks = load_chunks(chunks_path)
    print(f"Loaded {len(chunks)} chunks from {chunks_path}")

    # Always run comparison (documents results for rubric)
    compare_models(chunks, Path("data/embedding_comparison.json"))

    if not args.compare_only:
        # Build the primary index with the winning model
        build_index(chunks, PRIMARY_MODEL, args.reset)
        print(f"\nPrimary index built with {PRIMARY_MODEL}.")
        print("Start the backend: cd backend && uvicorn main:app --reload")
