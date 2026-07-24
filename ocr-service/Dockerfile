FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-render.txt .

RUN pip install --upgrade pip \
    && pip install paddlepaddle==3.2.2 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && pip install -r requirements-render.txt

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
ENV PADDLE_PDX_CACHE_HOME=/root/.paddlex_cache

# Pre-download the PaddleOCR models at build time and bake them into the
# image. /root/.paddlex_cache does not persist across Cloud Run cold starts
# (ephemeral container filesystem + scale-to-zero), so without this every
# cold start had to re-download both models from the network before the
# engine became ready. Must match OCR_PADDLE_DET_MODEL/REC_MODEL on Cloud
# Run. Using medium (not small) models now that Cloud Run gives 2GiB —
# small models + aggressive downscaling were a Render-512MB-only tradeoff
# and were causing zero detections on real high-res meter photos.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en', text_detection_model_name='PP-OCRv6_medium_det', text_recognition_model_name='PP-OCRv6_medium_rec', use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)"

COPY . .

CMD ["sh", "-c", "export OCR_PORT=\"${PORT:-5055}\"; python main.py"]
