import platform
import traceback

try:
    import paddle
    from paddleocr import PaddleOCR
except Exception:
    print("Failed to import Paddle or PaddleOCR")
    traceback.print_exc()
    raise

print(f"Python version: {platform.python_version()} ({platform.python_implementation()})")
print(f"paddle.__version__: {getattr(paddle, '__version__', 'unknown')}")
print(f"paddleocr.__version__: {getattr(PaddleOCR, '__module__', 'unknown')}")

try:
    print(f"paddle.get_device(): {paddle.get_device()}")
except Exception:
    print("Failed to query paddle.get_device()")
    traceback.print_exc()
    raise


def try_init(**kwargs):
    try:
        print(f"Trying PaddleOCR({', '.join(f'{k}={v!r}' for k, v in kwargs.items())})")
        ocr = PaddleOCR(**kwargs)
        print("READY")
        return True
    except Exception:
        traceback.print_exc()
        return False

if not try_init():
    retry_configs = [
        {"device": "cpu"},
        {
            "device": "cpu",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
    ]
    for config in retry_configs:
        if try_init(**config):
            break
