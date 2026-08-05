document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const tabUpload = document.getElementById('tabUpload');
    const tabWebcam = document.getElementById('tabWebcam');
    const uploadSection = document.getElementById('uploadSection');
    const webcamSection = document.getElementById('webcamSection');
    
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
    const webcamVideo = document.getElementById('webcamVideo');
    const webcamPlaceholder = document.getElementById('webcamPlaceholder');
    const toggleWebcamBtn = document.getElementById('toggleWebcamBtn');
    const captureCanvas = document.getElementById('captureCanvas');
    
    const predictBtn = document.getElementById('predictBtn');
    const outputImage = document.getElementById('outputImage');
    const loading = document.getElementById('loading');
    const placeholder = document.getElementById('placeholder');
    const confThresh = document.getElementById('confThresh');
    const confVal = document.getElementById('confVal');
    const detCount = document.getElementById('detCount');
    const infTime = document.getElementById('infTime');
    const detList = document.getElementById('detList');

    let currentFile = null;
    let webcamStream = null;
    let isWebcamActive = false;
    let webcamInterval = null;

    // --- TAB SWITCHING ---
    tabUpload.addEventListener('click', () => {
        tabUpload.classList.add('active');
        tabWebcam.classList.remove('active');
        uploadSection.classList.remove('hidden');
        webcamSection.classList.add('hidden');
        stopWebcam();
        predictBtn.style.display = 'block';
    });

    tabWebcam.addEventListener('click', () => {
        tabWebcam.classList.add('active');
        tabUpload.classList.remove('active');
        webcamSection.classList.remove('hidden');
        uploadSection.classList.add('hidden');
        predictBtn.style.display = 'none'; // Predict happens automatically in webcam mode
    });

    // --- SETTINGS ---
    confThresh.addEventListener('input', (e) => {
        confVal.textContent = Math.round(e.target.value * 100) + '%';
    });

    // --- IMAGE UPLOAD LOGIC ---
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) { alert('Please upload an image file.'); return; }
        currentFile = file;
        predictBtn.disabled = false;
        const reader = new FileReader();
        reader.onload = (e) => {
            outputImage.src = e.target.result;
            outputImage.classList.remove('hidden');
            placeholder.classList.add('hidden');
            resetMetrics();
        };
        reader.readAsDataURL(file);
    }

    predictBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        predictBtn.disabled = true;
        await detect(currentFile, true);
        predictBtn.disabled = false;
    });

    // --- WEBCAM LOGIC ---
    toggleWebcamBtn.addEventListener('click', async () => {
        if (isWebcamActive) {
            stopWebcam();
        } else {
            await startWebcam();
        }
    });

    async function startWebcam() {
        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            webcamVideo.srcObject = webcamStream;
            webcamVideo.classList.remove('hidden');
            webcamPlaceholder.classList.add('hidden');
            toggleWebcamBtn.textContent = 'Stop Webcam';
            toggleWebcamBtn.style.background = 'var(--accent-hover)';
            isWebcamActive = true;
            placeholder.classList.add('hidden');
            outputImage.classList.remove('hidden');
            
            // Start capture loop (1 frame every 1000ms to avoid overwhelming the stateless API)
            webcamInterval = setInterval(captureAndDetect, 1000);
        } catch (err) {
            alert('Could not access webcam: ' + err.message);
        }
    }

    function stopWebcam() {
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
        }
        webcamVideo.srcObject = null;
        webcamVideo.classList.add('hidden');
        webcamPlaceholder.classList.remove('hidden');
        toggleWebcamBtn.textContent = 'Start Webcam';
        toggleWebcamBtn.style.background = 'var(--accent)';
        isWebcamActive = false;
        clearInterval(webcamInterval);
    }

    async function captureAndDetect() {
        if (!isWebcamActive || webcamVideo.readyState !== 4) return;
        
        // Draw video frame to canvas
        captureCanvas.width = webcamVideo.videoWidth;
        captureCanvas.height = webcamVideo.videoHeight;
        const ctx = captureCanvas.getContext('2d');
        ctx.drawImage(webcamVideo, 0, 0, captureCanvas.width, captureCanvas.height);
        
        // Convert to blob and send to API
        captureCanvas.toBlob(async (blob) => {
            if (blob) await detect(blob, false);
        }, 'image/jpeg', 0.8);
    }

    // --- CORE API LOGIC ---
    async function detect(fileBlob, showLoading) {
        if (showLoading) {
            loading.classList.remove('hidden');
            outputImage.style.opacity = '0.5';
        }

        const formData = new FormData();
        formData.append('file', fileBlob, 'frame.jpg');
        formData.append('conf_thresh', confThresh.value);

        try {
            const response = await fetch('/api/predict', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Prediction failed');
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            outputImage.src = data.annotated_image;
            detCount.textContent = data.total_detections;
            infTime.textContent = data.inference_time_ms + 'ms';

            detList.innerHTML = '';
            if (data.detections && data.detections.length > 0) {
                data.detections.forEach(det => {
                    const box = document.createElement('div');
                    box.className = 'detection-box';
                    box.innerHTML = `
                        <div class="det-header">
                            <span class="det-class">🔴 ${det.class}</span>
                            <span>${Math.round(det.confidence * 100)}%</span>
                        </div>
                        <div class="det-box">Box: [${det.box.join(', ')}]</div>
                    `;
                    detList.appendChild(box);
                });
            } else {
                detList.innerHTML = '<div class="detection-box" style="text-align:center; color: var(--text-muted);">✅ No weapons detected</div>';
            }
        } catch (error) {
            console.error('API Error:', error);
            if (showLoading) alert('Error: ' + error.message);
        } finally {
            if (showLoading) {
                loading.classList.add('hidden');
                outputImage.style.opacity = '1';
            }
        }
    }

    function resetMetrics() {
        detCount.textContent = '0';
        infTime.textContent = '0ms';
        detList.innerHTML = '';
    }
});
