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

COPY . .

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
ENV PADDLE_PDX_CACHE_HOME=/root/.paddlex_cache

CMD ["sh", "-c", "export OCR_PORT=\"${PORT:-5055}\"; python main.py"]
