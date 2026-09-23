FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements-runtime.txt

COPY api.py inference.py explainability.py ./
COPY data/manifest.json ./data/manifest.json
COPY data/model ./data/model
COPY data/raw/ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData ./data/raw/ASNR-MICCAI-BraTS2023-GLI-Challenge-TrainingData
COPY data/jobs ./data/jobs

CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
