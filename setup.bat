@echo off
title Weapon Detection Setup
color 0A

echo ============================================
echo   Weapon Detection System - CoderAxo 2026
echo   Offer ID: CAX-OL-2026-265
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found!
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit
)

echo [1/4] Python found!

:: Upgrade pip
echo [2/4] Upgrading pip...
python -m pip install --upgrade pip --quiet

:: Install dependencies
echo [3/4] Installing dependencies (this may take 2-3 minutes)...
pip install ultralytics streamlit opencv-python pillow numpy torch torchvision --quiet

echo [4/4] All dependencies installed!
echo.
echo ============================================
echo   Starting Weapon Detection App...
echo   Open your browser at: http://localhost:8501
echo ============================================
echo.

:: Run app
streamlit run Source_Code/app.py

pause
