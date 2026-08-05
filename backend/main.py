from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2
import numpy as np
import base64
import os
import time

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
async def predict(file: UploadFile = File(...), conf_thresh: float = Form(0.60)):
    if not model:
        return {"error": "Model not loaded"}
    
    # Read image
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        return {"error": "Invalid image file"}

    # Run inference
    t0 = time.time()
    results = model.predict(source=img, conf=conf_thresh, verbose=False)
    elapsed = time.time() - t0
    
    result = results[0]
    
    # Draw annotations
    annotated = result.plot(line_width=2)
    
    # Convert to base64
    _, buffer = cv2.imencode('.jpg', annotated)
    img_base64 = base64.b64encode(buffer).decode('utf-8')
    
    # Parse detections
    detections = []
    if result.boxes:
        for box in result.boxes:
            cls_id = int(box.cls)
            conf_val = float(box.conf)
            xyxy = [round(v, 1) for v in box.xyxy[0].tolist()]
            name = model.names[cls_id] if hasattr(model, 'names') and cls_id in model.names else str(cls_id)
            detections.append({
                "class": name,
                "confidence": conf_val,
                "box": xyxy
            })
            
    return {
        "detections": detections,
        "inference_time_ms": round(elapsed * 1000),
        "annotated_image": f"data:image/jpeg;base64,{img_base64}",
        "total_detections": len(detections)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
