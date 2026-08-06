"""
Weapon Detection Web App — CoderAxo Internship 2026
Offer ID: CAX-OL-2026-265
Author: Khuzaima Istiaq
"""

import streamlit as st
import cv2
import numpy as np
from PIL import Image
from pathlib import Path
import tempfile
import time

# ── Page Config ───────────────────────────────────────────────
st.set_page_config(
    page_title="Weapon Detector | CoderAxo",
    page_icon="🔫",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ── Custom CSS ────────────────────────────────────────────────
st.markdown("""
<style>
    .main { background: #0d0d0d; }
    .block-container { padding-top: 1.5rem; }
    .metric-card {
        background: #1a1a2e;
        border: 1px solid #e94560;
        border-radius: 10px;
        padding: 15px;
        text-align: center;
    }
    .detection-box {
        background: #16213e;
        border-left: 4px solid #e94560;
        padding: 10px 15px;
        border-radius: 0 8px 8px 0;
        margin: 5px 0;
        color: white !important;
    }
    h1 { color: #e94560 !important; }
    .stButton > button {
        background: #e94560;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.5rem 2rem;
        font-weight: bold;
    }
    .stButton > button:hover { background: #c73652; }
</style>
""", unsafe_allow_html=True)

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

# ── Load Model ────────────────────────────────────────────────
@st.cache_resource
def load_model():
    # Apply monkey patches to support loading Linux-trained YOLOv5 models on Windows
    import pathlib
    pathlib.PosixPath = pathlib.WindowsPath
    import torch
    original_load = torch.load
    torch.load = lambda *args, **kwargs: original_load(*args, **{**kwargs, 'weights_only': False})
    
    try:
        from ultralytics import YOLO
        import yolov5
    except Exception as e:
        return None, f"import_error: {e}"
        
    try:
        weights_files = ['best (1).pt', 'best.pt', 'backend/best (1).pt', 'backend/best.pt', 'yolov8n.pt']
        weights_path = None
        for f in weights_files:
            p = Path(f)
            if p.exists():
                weights_path = str(p)
                break
                
        if weights_path:
            # Try loading as YOLOv8 first
            try:
                model = YOLO(weights_path)
                return model, f"custom (YOLOv8) from {weights_path}"
            except Exception as e:
                # Try loading as YOLOv5
                try:
                    model = YOLOv5Adapter(yolov5.load(weights_path))
                    return model, f"custom (YOLOv5) from {weights_path}"
                except Exception as ex:
                    return None, f"load_error: {ex}"
        else:
            model = YOLO('yolov8n.pt')
            return model, "pretrained"
    except Exception as e:
        return None, str(e)

# ── Constants ─────────────────────────────────────────────────
CLASS_NAMES = ['gun', 'knife', 'rifle']
COLORS = {
    'gun':   (255, 75,  75),
    'knife': (255, 165, 0),
    'rifle': (255, 0,  128),
}

# ── Header ────────────────────────────────────────────────────
st.markdown("# 🔫 Weapon Detection System")
st.markdown("**CoderAxo AI/ML Internship 2026 | Offer ID: CAX-OL-2026-265**")
st.divider()

# ── Sidebar ───────────────────────────────────────────────────
with st.sidebar:
    st.markdown("<h2 style='text-align: center; color: #e94560; background: #1a1a2e; padding: 10px; border-radius: 10px; border: 1px solid #e94560;'>CoderAxo</h2>", unsafe_allow_html=True)
    st.markdown("### ⚙️ Settings")
    conf_thresh = st.slider("Confidence Threshold", 0.1, 0.9, 0.60, 0.05)
    iou_thresh  = st.slider("IoU Threshold (NMS)", 0.1, 0.9, 0.45, 0.05)
    show_labels = st.checkbox("Show Labels", value=True)
    show_conf   = st.checkbox("Show Confidence", value=True)
    st.divider()

# Load model first to dynamically populate classes sidebar
with st.spinner("Loading model..."):
    model, model_status = load_model()

if model is None:
    st.error(f"❌ Could not load model: {model_status}")
    st.info("Train the model first by running Notebook.ipynb")
    st.stop()

with st.sidebar:
    st.markdown("### 📌 Classes")
    model_classes = list(model.names.values()) if hasattr(model, 'names') and model.names else CLASS_NAMES
    
    def get_color_for_class(cls_name):
        c = cls_name.lower()
        if 'gun' in c or 'pistol' in c or 'rifle' in c or 'weapon' in c:
            return (255, 75, 75)
        elif 'knife' in c or 'blade' in c or 'stabbing' in c:
            return (255, 165, 0)
        return (255, 0, 128)
        
    for cls in model_classes:
        color = get_color_for_class(cls)
        hex_color = '#{:02x}{:02x}{:02x}'.format(*color)
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:8px;margin:4px 0">'
            f'<div style="width:16px;height:16px;background:{hex_color};border-radius:3px"></div>'
            f'<span style="color:var(--text-color); font-weight:500; text-transform:capitalize">{cls}</span></div>',
            unsafe_allow_html=True
        )

if "pretrained" in model_status:
    st.warning("⚠️ Custom trained model not found. Using pretrained YOLOv8n (COCO). "
               "Train the model first for weapon-specific detection.")
else:
    st.success(f"✅ Custom weapon detection model loaded! ({model_status})")

# ── Main Tabs ─────────────────────────────────────────────────
tab1, tab2, tab3 = st.tabs(["📷 Image Detection", "🎥 Video Detection", "📊 Model Info"])

# ── TAB 1: Image ──────────────────────────────────────────────
with tab1:
    col1, col2 = st.columns(2)

    with col1:
        st.markdown("### Upload Image")
        uploaded = st.file_uploader(
            "Upload a CCTV/security camera image",
            type=['jpg', 'jpeg', 'png', 'bmp', 'webp']
        )
        if uploaded:
            img = Image.open(uploaded).convert('RGB')
            st.image(img, caption="Original Image", use_container_width=True)

    with col2:
        st.markdown("### Detection Output")
        if uploaded:
            with st.spinner("🔍 Detecting weapons..."):
                t0 = time.time()
                img_np = np.array(img)
                results = model.predict(
                    source=img_np,
                    conf=conf_thresh,
                    iou=iou_thresh,
                    verbose=False
                )
                elapsed = time.time() - t0
                result = results[0]

            # Draw detections
            annotated = result.plot(
                labels=show_labels,
                conf=show_conf,
                line_width=2
            )
            annotated_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
            st.image(annotated_rgb, caption="Detection Result", use_container_width=True)

            # Metrics row
            n_det = len(result.boxes) if result.boxes else 0
            c1, c2, c3 = st.columns(3)
            c1.metric("🎯 Detections", n_det)
            c2.metric("⏱️ Inference", f"{elapsed*1000:.0f}ms")
            c3.metric("📐 Image Size", f"{img.width}×{img.height}")

            # Detection list
            if result.boxes and len(result.boxes) > 0:
                st.markdown("#### Detected Objects")
                for box in result.boxes:
                    cls_id   = int(box.cls)
                    cls_name = model.names[cls_id] if hasattr(model, 'names') and cls_id in model.names else f"class_{cls_id}"
                    conf_val = float(box.conf[0])
                    xyxy_list = box.xyxy[0].tolist() if hasattr(box.xyxy[0], 'tolist') else box.xyxy[0]
                    xyxy     = [round(v, 1) for v in xyxy_list]
                    st.markdown(
                        f'<div class="detection-box">'
                        f'<strong>🔴 {cls_name.upper()}</strong> — '
                        f'Confidence: <strong>{conf_val:.1%}</strong> | '
                        f'Box: {xyxy}'
                        f'</div>',
                        unsafe_allow_html=True
                    )
            else:
                st.info("✅ No weapons detected in this image.")
        else:
            st.info("👆 Upload an image to start detection")

# ── TAB 2: Video ──────────────────────────────────────────────
with tab2:
    st.markdown("### Video / Webcam Detection")
    vid_source = st.radio("Source", ["Upload Video", "Webcam (if available)"],
                          horizontal=True)

    if vid_source == "Upload Video":
        vid_file = st.file_uploader("Upload video", type=['mp4', 'avi', 'mov', 'mkv'])
        if vid_file:
            tfile = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
            tfile.write(vid_file.read())
            tfile.flush()

            st.markdown("#### Processing Video...")
            stframe   = st.empty()
            stat_col1, stat_col2 = st.columns(2)
            frame_count_box = stat_col1.empty()
            det_count_box   = stat_col2.empty()

            cap = cv2.VideoCapture(tfile.name)
            frame_idx   = 0
            total_dets  = 0
            max_frames  = 300  # limit for demo

            stop_btn = st.button("⏹ Stop Processing")

            while cap.isOpened() and frame_idx < max_frames and not stop_btn:
                ret, frame = cap.read()
                if not ret: break

                if frame_idx % 3 == 0:  # process every 3rd frame for speed
                    results = model.predict(
                        source=frame,
                        conf=conf_thresh,
                        iou=iou_thresh,
                        verbose=False
                    )
                    result   = results[0]
                    annotated = result.plot(labels=show_labels, conf=show_conf)
                    n_det    = len(result.boxes) if result.boxes else 0
                    total_dets += n_det

                    rgb_frame = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
                    stframe.image(rgb_frame, channels="RGB", width=650)

                frame_count_box.metric("Frame", frame_idx)
                det_count_box.metric("Total Detections", total_dets)
                frame_idx += 1

            cap.release()
            st.success(f"✅ Done! Processed {frame_idx} frames | Total detections: {total_dets}")
    else:
        st.markdown("#### Live Webcam Feed")
        run_webcam = st.checkbox("🎥 Start Webcam")
        
        if run_webcam:
            stframe = st.empty()
            stat_col1, stat_col2 = st.columns(2)
            frame_count_box = stat_col1.empty()
            det_count_box   = stat_col2.empty()
            
            # 0 is usually the built-in laptop webcam
            cap = cv2.VideoCapture(0)
            frame_idx = 0
            total_dets = 0
            
            while run_webcam:
                ret, frame = cap.read()
                if not ret:
                    st.error("Failed to access the webcam.")
                    break
                    
                if frame_idx % 2 == 0:  # process every 2nd frame for speed
                    results = model.predict(
                        source=frame,
                        conf=conf_thresh,
                        iou=iou_thresh,
                        verbose=False
                    )
                    result = results[0]
                    annotated = result.plot(labels=show_labels, conf=show_conf)
                    n_det = len(result.boxes) if result.boxes else 0
                    total_dets += n_det
                    
                    rgb_frame = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
                    stframe.image(rgb_frame, channels="RGB", width=650)
                    
                frame_count_box.metric("Frame", frame_idx)
                det_count_box.metric("Total Detections", total_dets)
                frame_idx += 1
                
            cap.release()

# ── TAB 3: Model Info ─────────────────────────────────────────
with tab3:
    st.markdown("### 📊 Model Information")
    # Dynamically resolve architecture and framework names
    arch_name = "YOLOv5" if "YOLOv5" in model_status else "YOLOv8"
    framework_name = "Ultralytics YOLOv5" if "YOLOv5" in model_status else "Ultralytics YOLOv8"
    params_count = "~7.0M (YOLOv5s)" if "YOLOv5" in model_status else "~3.2M (YOLOv8n)"
    
    info = {
        "Model Architecture": arch_name,
        "Classes":            ", ".join(model_classes),
        "Input Size":         "640×640",
        "Parameters":         params_count,
        "Framework":          framework_name,
        "Offer ID":           "CAX-OL-2026-265",
        "Project":            "Weapon Detection in CCTV Footage",
    }
    for k, v in info.items():
        col1, col2 = st.columns([1, 2])
        col1.markdown(f"**{k}**")
        col2.markdown(v)

    st.divider()
    st.markdown("### 📋 Submission Checklist")
    items = [
        ("Jupyter Notebook (.ipynb)", True),
        ("Project Report (PDF)",      True),
        ("Output Images (6-10)",      True),
        ("Demo Video (5-10 min)",     False),
        ("Source Code + requirements.txt", True),
        ("Dataset / Download Link",   True),
        ("README.md",                 True),
    ]
    for item, done in items:
        icon = "✅" if done else "⬜"
        st.markdown(f"{icon} {item}")

# ── Footer ────────────────────────────────────────────────────
st.divider()
st.markdown(
    "<p style='text-align:center;color:#666;font-size:12px'>"
    "Weapon Detection System | CoderAxo AI/ML Internship 2026 | "
    "Khuzaima Istiaq | CAX-OL-2026-265"
    "</p>",
    unsafe_allow_html=True
)
