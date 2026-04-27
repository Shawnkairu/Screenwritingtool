"""
Scrape publicly available screenplays from IMSDB for the RAG corpus.

Usage:
    python scripts/scrape_screenplays.py --limit 100 --output data/raw

Output:
    data/raw/{title}.txt  — one plain-text screenplay per file
    data/raw/manifest.json — metadata for each downloaded script
"""

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://imsdb.com"
ALL_SCRIPTS_URL = f"{BASE_URL}/all-scripts.html"
HEADERS = {"User-Agent": "Mozilla/5.0 (academic research use)"}
RATE_LIMIT_SECONDS = 1.5  # Be polite


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [WARN] Failed to fetch {url}: {e}")
        return None


def get_script_list() -> list[dict]:
    """Return list of {title, detail_url} from the all-scripts page."""
    print("Fetching script list...")
    soup = fetch(ALL_SCRIPTS_URL)
    if not soup:
        return []

    scripts = []
    for a in soup.select("td p a"):
        href = a.get("href", "")
        title = a.text.strip()
        if href.startswith("/Movie Scripts/") and title:
            scripts.append({"title": title, "detail_url": BASE_URL + href})

    print(f"Found {len(scripts)} scripts on IMSDB.")
    return scripts


def get_script_text_url(detail_url: str) -> str | None:
    """From the detail page, find the link to the actual script text."""
    soup = fetch(detail_url)
    if not soup:
        return None
    # The "Read Script" link points to /scripts/Title.html
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/scripts/") and href.endswith(".html"):
            return BASE_URL + href
    return None


def extract_script_text(script_url: str) -> str | None:
    """Extract raw screenplay text from the <pre> block."""
    soup = fetch(script_url)
    if not soup:
        return None
    pre = soup.find("pre")
    if not pre:
        return None
    return pre.get_text()


def sanitize_filename(title: str) -> str:
    return re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '_')


def scrape(limit: int, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"

    # Load existing manifest to allow resuming
    manifest: list[dict] = []
    existing_titles: set[str] = set()
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        existing_titles = {m["title"] for m in manifest}
        print(f"Resuming: {len(manifest)} already downloaded.")

    scripts = get_script_list()
    downloaded = 0

    for script in scripts:
        if downloaded >= limit:
            break
        if script["title"] in existing_titles:
            continue

        title = script["title"]
        print(f"[{downloaded + 1}/{limit}] {title}")

        time.sleep(RATE_LIMIT_SECONDS)
        script_url = get_script_text_url(script["detail_url"])
        if not script_url:
            print(f"  Could not find script URL for {title}")
            continue

        time.sleep(RATE_LIMIT_SECONDS)
        text = extract_script_text(script_url)
        if not text or len(text) < 500:
            print(f"  Script too short or empty, skipping.")
            continue

        filename = sanitize_filename(title) + ".txt"
        filepath = output_dir / filename
        filepath.write_text(text, encoding="utf-8")

        manifest.append({
            "title": title,
            "filename": filename,
            "detail_url": script["detail_url"],
            "script_url": script_url,
            "char_count": len(text),
        })
        manifest_path.write_text(json.dumps(manifest, indent=2))
        downloaded += 1
        print(f"  Saved {filename} ({len(text):,} chars)")

    print(f"\nDone. Downloaded {downloaded} screenplays to {output_dir}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="Max scripts to download")
    parser.add_argument("--output", type=str, default="data/raw", help="Output directory")
    args = parser.parse_args()
    scrape(args.limit, Path(args.output))
