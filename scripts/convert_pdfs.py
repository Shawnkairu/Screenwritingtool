"""
Convert PDF screenplays to plain text files for the RAG pipeline.

Extracts text page-by-page using pdfplumber, preserves whitespace
(important for detecting INT./EXT. headings and character names).

Usage:
    python scripts/convert_pdfs.py --input /path/to/pdfs --output data/raw

Output:
    data/raw/<title>.txt — one file per screenplay
"""

import argparse
import re
from pathlib import Path


def pdf_to_text(pdf_path: Path) -> str:
    """Extract plain text from a PDF, preserving indentation for screenplay format."""
    import pdfplumber

    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if text:
                pages.append(text)

    return "\n\n".join(pages)


def clean_screenplay_text(text: str) -> str:
    """
    Light cleanup — remove page numbers, headers, and double-blank-lines
    without destroying screenplay indentation.
    """
    lines = text.split('\n')
    cleaned = []

    for line in lines:
        stripped = line.strip()

        # Skip bare page numbers (a digit or two on its own line)
        if re.match(r'^\d{1,3}\.?\s*$', stripped):
            continue

        # Skip common PDF header/footer artifacts
        if re.match(r'^(CONTINUED|END OF ACT|TITLE CARD)\s*[:\-]?\s*\d*\s*$', stripped, re.IGNORECASE):
            continue

        cleaned.append(line)

    # Collapse runs of 3+ blank lines to 2
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(cleaned))
    return result.strip()


def convert_all(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_files = sorted(input_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDFs found in {input_dir}")
        return

    print(f"Converting {len(pdf_files)} PDFs → {output_dir}")
    success, failed = 0, []

    for pdf_path in pdf_files:
        out_name = pdf_path.stem + ".txt"
        out_path = output_dir / out_name

        if out_path.exists():
            print(f"  [skip] {pdf_path.name} — already converted")
            success += 1
            continue

        try:
            raw = pdf_to_text(pdf_path)
            cleaned = clean_screenplay_text(raw)

            if len(cleaned) < 500:
                print(f"  [warn] {pdf_path.name} — very short ({len(cleaned)} chars), might be image-based PDF")

            out_path.write_text(cleaned, encoding="utf-8")
            print(f"  [ok]   {pdf_path.name} → {out_name} ({len(cleaned):,} chars)")
            success += 1

        except Exception as e:
            print(f"  [FAIL] {pdf_path.name}: {e}")
            failed.append(pdf_path.name)

    print(f"\nDone: {success} converted, {len(failed)} failed")
    if failed:
        print("Failed files:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=str,
        default="/Users/shawnkairu/Library/Mobile Documents/com~apple~CloudDocs/Film/Sample Screenplays",
        help="Folder containing PDF screenplays"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="data/raw",
        help="Output folder for .txt files"
    )
    args = parser.parse_args()

    convert_all(Path(args.input), Path(args.output))
