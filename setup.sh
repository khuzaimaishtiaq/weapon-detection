#!/bin/bash
echo "============================================"
echo "  Weapon Detection System - CoderAxo 2026"
echo "  Offer ID: CAX-OL-2026-265"
echo "============================================"

echo "[1/4] Checking Python..."
python3 --version || { echo "Python not found! Install from python.org"; exit 1; }

echo "[2/4] Upgrading pip..."
python3 -m pip install --upgrade pip --quiet

echo "[3/4] Installing dependencies..."
pip3 install ultralytics streamlit opencv-python pillow numpy torch torchvision --quiet

echo "[4/4] Done! Starting app..."
echo "Open browser at: http://localhost:8501"
streamlit run Source_Code/app.py
