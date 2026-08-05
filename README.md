# 🔫 Weapon Detection in CCTV Footage

**Offer ID:** CAX-OL-2026-265  
**Intern:** Khuzaima Istiaq  
**Program:** CoderAxo AI/ML Internship 2026  
**Deadline:** 01-08-2026

---

## Project Overview
Real-time weapon detection using YOLOv8 — detects guns, knives, and rifles in CCTV footage with a Streamlit web interface.

**Classes:** gun | knife | rifle

---

## Folder Structure
```
Weapon_Detection/
├── Notebook.ipynb
├── Report.pdf
├── README.md
├── requirements.txt
├── Dataset/
│   ├── train/images/ & labels/
│   ├── valid/images/ & labels/
│   ├── test/images/  & labels/
│   └── data.yaml
├── Output_Images/
├── Source_Code/app.py
└── Demo_Video.mp4
```

---

## Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Download Dataset
```python
from roboflow import Roboflow
rf = Roboflow(api_key="YOUR_API_KEY")
project = rf.workspace("roboflow-100").project("weapons-detection-v2")
dataset = project.version(2).download("yolov8", location="Dataset")
```
Alternatively: https://www.kaggle.com/datasets/deepakat002/weapon-detection

### 3. Train (run Notebook.ipynb)
Recommended: use Google Colab (free T4 GPU). Upload the notebook + dataset.

### 4. Run Streamlit App
```bash
streamlit run Source_Code/app.py
```

---

## Testing the Model

### Single image
```python
from ultralytics import YOLO
model = YOLO('runs/detect/weapon_detector/weights/best.pt')
results = model.predict(source='image.jpg', conf=0.25)
results[0].show()
```

### Video file
```python
results = model.predict(source='video.mp4', conf=0.25, save=True)
```

### Webcam (live)
```python
results = model.predict(source=0, show=True, conf=0.25)
```

### Command line
```bash
yolo detect predict model=runs/detect/weapon_detector/weights/best.pt source=Dataset/test/images/ conf=0.25 save=True
```

---

## Contact
Khuzaima Istiaq
GitHub: github.com/malikmajid161
