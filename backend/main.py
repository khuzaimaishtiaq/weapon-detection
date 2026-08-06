from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import numpy as np
import base64
import os
import time
import sqlite3
import io
from datetime import datetime
from PIL import Image
from io import BytesIO

# Initialize SQLite Database
DB_FILE = "detections.db"
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS detection_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            num_detections INTEGER,
            weapon_classes TEXT,
            highest_confidence REAL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

app = FastAPI(title="Weapon Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class YOLOv5BoxWrapper:
    def __init__(self, x1, y1, x2, y2, conf, cls_id):
        self.cls = float(cls_id)
        self.conf = [float(conf)]
        self.xyxy = [[float(x1), float(y1), float(x2), float(y2)]]

class YOLOv5ResultWrapper:
    def __init__(self, results_v5, conf_thresh):
        self.results_v5 = results_v5
        pred = results_v5.xyxy[0].cpu().numpy()
        self.boxes = []
        for box in pred:
            x1, y1, x2, y2, conf, cls_id = box
            if conf >= conf_thresh:
                self.boxes.append(YOLOv5BoxWrapper(x1, y1, x2, y2, conf, cls_id))
                
    def plot(self, labels=True, conf=True, line_width=2):
        self.results_v5.render()
        annotated_rgb = self.results_v5.ims[0]
        # Convert RGB to BGR to match YOLOv8 plot() output format
        return cv2.cvtColor(annotated_rgb, cv2.COLOR_RGB2BGR)

class YOLOv5Adapter:
    def __init__(self, model_v5):
        self.model_v5 = model_v5
        self.names = model_v5.names
        self.overrides = {'imgsz': 640}

    def predict(self, source, conf=0.25, iou=0.45, imgsz=640, verbose=False):
        results = self.model_v5(source, size=imgsz)
        return [YOLOv5ResultWrapper(results, conf)]

# Load model (looks for best (1).pt, best.pt in backend dir or parent dir, falls back to yolov8n.pt)
model = None

# Apply monkey patches to support loading Linux-trained YOLOv5 models on Windows
import pathlib
pathlib.PosixPath = pathlib.WindowsPath
import torch
original_load = torch.load
torch.load = lambda *args, **kwargs: original_load(*args, **{**kwargs, 'weights_only': False})

try:
    weights_files = ['best (1).pt', 'best.pt', '../best (1).pt', '../best.pt', 'yolov8n.pt']
    weights_path = None
    for f in weights_files:
        if os.path.exists(f):
            weights_path = f
            break
            
    if weights_path:
        # Try loading as YOLOv8 first
        try:
            model = YOLO(weights_path)
            print(f"Successfully loaded YOLOv8 model from {weights_path}")
        except Exception as e:
            print(f"Failed to load as YOLOv8: {e}. Trying YOLOv5...")
            # Try loading as YOLOv5
            import yolov5
            model = YOLOv5Adapter(yolov5.load(weights_path))
            print(f"Successfully loaded YOLOv5 model from {weights_path}")
    else:
        model = YOLO('yolov8n.pt')
        print("Fallback: loaded yolov8n.pt")
except Exception as e:
    print(f"Error loading model: {e}")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Weapon Detection API is running"}

@app.post("/api/predict")
async def predict(
    file: UploadFile = File(...), 
    conf_thresh: float = Form(0.60),
    return_image: bool = Form(True)
):
    if not model:
        return {"error": "Model not loaded"}
    
    # Read image using PIL
    contents = await file.read()
    try:
        img = Image.open(BytesIO(contents)).convert("RGB")
    except Exception:
        return {"error": "Invalid image file"}
    
    # Resolve native training image size from model overrides (e.g. 416 for best.pt)
    imgsz = model.overrides.get('imgsz', 416) if hasattr(model, 'overrides') and model.overrides else 416
    
    # Run inference with explicit confidence, IOU, and native image size constraints
    t0 = time.time()
    results = model.predict(
        source=img,
        conf=conf_thresh,
        iou=0.45,
        imgsz=imgsz,
        verbose=False
    )
    elapsed = time.time() - t0
    
    result = results[0]
    
    # Draw annotations (returns BGR numpy array) if return_image is True
    img_base64 = ""
    if return_image:
        try:
            annotated = result.plot(line_width=2)
            annotated_rgb = annotated[..., ::-1] # Convert BGR to RGB
            res_img = Image.fromarray(annotated_rgb)
            buffered = BytesIO()
            res_img.save(buffered, format="JPEG")
            img_base64 = f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
        except Exception as e:
            print(f"Error drawing annotations: {e}")
    
    # Parse detections
    detections = []
    if result.boxes:
        for box in result.boxes:
            cls_id = int(box.cls)
            name = model.names[cls_id] if hasattr(model, 'names') and cls_id in model.names else str(cls_id)
            detections.append({
                "class": name,
                "confidence": round(float(box.conf[0]), 2),
                "box": box.xyxy[0]
            })
            
    total_detections = len(detections)
    
    # Log to SQLite Database if a weapon is detected (with de-duplication)
    if total_detections > 0:
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            classes_str = ", ".join(list(set([d["class"] for d in detections])))
            highest_conf = max([d["confidence"] for d in detections])
            
            # Check last logged entry to avoid flooding duplicates during continuous stream
            c.execute('SELECT timestamp, weapon_classes FROM detection_history ORDER BY id DESC LIMIT 1')
            last_row = c.fetchone()
            is_duplicate = False
            if last_row:
                last_time_str, last_classes = last_row
                try:
                    last_time = datetime.fromisoformat(last_time_str)
                    time_diff = (datetime.now() - last_time).total_seconds()
                    # 4 seconds de-duplication window
                    if time_diff < 4.0 and last_classes == classes_str:
                        is_duplicate = True
                except Exception:
                    pass
                    
            if not is_duplicate:
                c.execute('''
                    INSERT INTO detection_history (timestamp, num_detections, weapon_classes, highest_confidence)
                    VALUES (?, ?, ?, ?)
                ''', (datetime.now().isoformat(), total_detections, classes_str, highest_conf))
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"Database error: {e}")
            
    return {
        "detections": detections,
        "inference_time_ms": round(elapsed * 1000, 2),
        "annotated_image": img_base64,
        "total_detections": total_detections
    }

@app.get("/api/history")
async def get_history(limit: int = 50):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        if limit > 0:
            c.execute('SELECT * FROM detection_history ORDER BY id DESC LIMIT ?', (limit,))
        else:
            c.execute('SELECT * FROM detection_history ORDER BY id DESC')
        rows = c.fetchall()
        conn.close()
        
        history = []
        for row in rows:
            history.append({
                "id": row[0],
                "timestamp": row[1],
                "num_detections": row[2],
                "weapon_classes": row[3],
                "highest_confidence": row[4]
            })
        return {"history": history}
    except Exception as e:
        return {"error": str(e)}

# Serve frontend files locally from the FastAPI web server
try:
    from fastapi.staticfiles import StaticFiles
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend"))
    if os.path.exists(frontend_dir):
        app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
        print(f"Successfully mounted frontend static files from: {frontend_dir}")
except Exception as e:
    print(f"Could not mount static files: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
