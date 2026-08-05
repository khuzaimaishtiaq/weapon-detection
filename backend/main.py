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

# Load model (looks for best.pt in backend dir or parent dir, falls back to yolov8n.pt)
model = None
try:
    if os.path.exists('best.pt'):
        model = YOLO('best.pt')
    elif os.path.exists('../best.pt'):
        model = YOLO('../best.pt')
    else:
        model = YOLO('yolov8n.pt')
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

    # Convert PIL Image to NumPy array (RGB) for consistent preprocessing
    img_np = np.array(img)
    
    # Resolve native training image size from model overrides (e.g. 416 for best.pt)
    imgsz = model.overrides.get('imgsz', 416) if hasattr(model, 'overrides') and model.overrides else 416
    
    # Run inference with explicit confidence, IOU, and native image size constraints
    t0 = time.time()
    results = model.predict(
        source=img_np,
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
                "box": box.xyxy[0].tolist()
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
