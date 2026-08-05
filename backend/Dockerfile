FROM python:3.11-slim

WORKDIR /app

# Install ALL required system dependencies for OpenCV and YOLO
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libxcb1 \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Force remove GUI OpenCV and ensure headless is installed
RUN pip uninstall -y opencv-python opencv-contrib-python || true
RUN pip install --no-cache-dir opencv-python-headless

COPY . .

# Railway provides the PORT environment variable
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
