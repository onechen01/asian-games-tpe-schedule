"""Emit positioned text fragments from a text-layer PDF as JSON.

Used by scripts/fetch-tpenoc.ts. Text extraction only -- no OCR, no network.
Requires Python with pypdf installed; the caller fails closed if either is missing.
"""
import json
import sys

from pypdf import PdfReader


def main() -> int:
    reader = PdfReader(sys.argv[1])
    fragments = []
    for number, page in enumerate(reader.pages, start=1):
        def visit(text, cm, tm, font_dict, font_size, page=number):
            if text.strip():
                fragments.append({"page": page, "x": round(tm[4], 1), "y": round(tm[5], 1), "text": text})
        page.extract_text(visitor_text=visit)
    payload = json.dumps({"pages": len(reader.pages), "fragments": fragments}, ensure_ascii=False)
    # Windows consoles default to a legacy codepage; write UTF-8 bytes so CJK survives.
    sys.stdout.buffer.write(payload.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
