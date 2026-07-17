"""
Standalone PaddleOCR 3.7 proof of concept.

Usage:
    python ocr/paddle_ocr_demo.py test_images/meter.jpg
"""

import sys

from paddleocr import PaddleOCR


def extract_texts(ocr_result):
    """Collect raw recognized text lines from PaddleOCR 3.x predict() output."""
    lines = []
    if not ocr_result:
        return lines

    for item in ocr_result:
        if item is None:
            continue

        rec_texts = None

        # OCRResult / dict-like objects from PaddleOCR 3.x
        if hasattr(item, "keys") and "rec_texts" in item:
            rec_texts = item["rec_texts"]
        elif hasattr(item, "get"):
            rec_texts = item.get("rec_texts")
            if rec_texts is None and "res" in item:
                nested = item["res"]
                if hasattr(nested, "get"):
                    rec_texts = nested.get("rec_texts")
                elif isinstance(nested, dict):
                    rec_texts = nested.get("rec_texts")
        elif hasattr(item, "rec_texts"):
            rec_texts = item.rec_texts

        if not rec_texts:
            continue

        for text in rec_texts:
            text = str(text).strip()
            if text:
                lines.append(text)

    return lines


def main():
    if len(sys.argv) < 2:
        print("Usage: python ocr/paddle_ocr_demo.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]

    # Official PaddleOCR 3.7 API (no show_log / use_angle_cls)
    ocr = PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )

    result = ocr.predict(image_path)
    texts = extract_texts(result)

    print("---------------------")
    print("OCR Result")
    print("---------------------")
    for line in texts:
        print(line)


if __name__ == "__main__":
    main()
