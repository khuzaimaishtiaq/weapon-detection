document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    // Tab Selectors
    const tabImage = document.getElementById('tabImage');
    const tabVideo = document.getElementById('tabVideo');
    const tabWebcam = document.getElementById('tabWebcam');

    // Section Content Blocks
    const uploadSection = document.getElementById('uploadSection');
    const videoSection = document.getElementById('videoSection');
    const webcamSection = document.getElementById('webcamSection');

    // Modals
    const viewHistoryBtn = document.getElementById('viewHistoryBtn');
    const historyModal = document.getElementById('historyModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const historyTableBody = document.getElementById('historyTableBody');

    // Input zones
    const dropZoneImage = document.getElementById('dropZoneImage');
    const imageFileInput = document.getElementById('imageFileInput');
    const dropZoneVideo = document.getElementById('dropZoneVideo');
    const videoFileInput = document.getElementById('videoFileInput');

    // Video Control Buttons
    const playVideoBtn = document.getElementById('playVideoBtn');
    const toggleVideoDetectBtn = document.getElementById('toggleVideoDetectBtn');
    const toggleWebcamBtn = document.getElementById('toggleWebcamBtn');

    // Processing Elements
    const captureCanvas = document.getElementById('captureCanvas');
    const previewWrapper = document.getElementById('previewWrapper');
    const outputImage = document.getElementById('outputImage');
    const activeVideo = document.getElementById('activeVideo');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const placeholder = document.getElementById('placeholder');
    const loading = document.getElementById('loading');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    // Telemetry and Logs
    const confThresh = document.getElementById('confThresh');
    const confVal = document.getElementById('confVal');
    const detCount = document.getElementById('detCount');
    const infTime = document.getElementById('infTime');
    const detList = document.getElementById('detList');
    const historyListCompact = document.getElementById('historyListCompact');

    // Export Buttons
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const predictBtn = document.getElementById('predictBtn');

    // --- STATE VARIABLES ---
    let currentImageFile = null;
    let currentVideoFile = null;
    let webcamStream = null;
    let isWebcamActive = false;
    let isVideoAnalysisActive = false;
    let isSending = false;
    let lastAlertTime = 0;
    let lastHistoryRefreshTime = 0;
    let currentMode = 'image'; // 'image', 'video', 'webcam'
    let scaleX = 1.0;
    let scaleY = 1.0;
    
    // --- HELPER FUNCTIONS ---
    // Resolve Local Port Mismatch (CORS Bypasser)
    const getApiUrl = (endpoint) => {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
        const backendPort = '8000';
        if (isLocal && window.location.port !== backendPort) {
            return `http://localhost:${backendPort}${endpoint}`;
        }
        return endpoint;
    };

    // Text to Speech voice warning
    function playVoiceAlert() {
        const now = Date.now();
        if (now - lastAlertTime < 4000) return; // Debounce audio alert
        lastAlertTime = now;

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // Interrupt any ongoing speech
            const msg = new SpeechSynthesisUtterance("Warning, weapon detected.");
            msg.rate = 1.1; 
            msg.pitch = 0.85; // Serious deep threat voice
            msg.volume = 1.0;
            window.speechSynthesis.speak(msg);
        }
    }

    // Set UI Status indicator
    function setSystemStatus(status, text) {
        statusDot.className = 'status-dot';
        if (status === 'ready') {
            statusDot.style.background = 'var(--success)';
            statusDot.style.boxShadow = '0 0 8px var(--success)';
        } else if (status === 'processing') {
            statusDot.style.background = 'var(--accent)';
            statusDot.style.boxShadow = '0 0 8px var(--accent)';
        } else if (status === 'alert') {
            statusDot.style.background = 'var(--danger)';
            statusDot.style.boxShadow = '0 0 8px var(--danger)';
        }
        statusText.textContent = text;
    }

    // Rescale Canvas to maintain resolution matching
    function matchCanvasToResolution(sourceType) {
        if (sourceType === 'image') {
            overlayCanvas.width = outputImage.naturalWidth || 640;
            overlayCanvas.height = outputImage.naturalHeight || 480;
        } else {
            overlayCanvas.width = activeVideo.videoWidth || 640;
            overlayCanvas.height = activeVideo.videoHeight || 480;
        }
    }

    // --- TAB CONTROLLER ---
    function resetConsole() {
        // Stop any active capture loops
        stopWebcam();
        stopVideoAnalysis();
        
        // Hide display elements
        outputImage.classList.add('hidden');
        activeVideo.classList.add('hidden');
        placeholder.classList.remove('hidden');
        
        // Clear canvas drawings
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        
        // Reset metrics
        detCount.textContent = '0';
        infTime.textContent = '0ms';
        detList.innerHTML = '<div class="empty-log">No anomalies detected.</div>';
        
        // Reset states
        currentImageFile = null;
        currentVideoFile = null;
        isSending = false;
        
        setSystemStatus('ready', 'System Ready');
    }

    tabImage.addEventListener('click', () => {
        if (currentMode === 'image') return;
        currentMode = 'image';
        tabImage.classList.add('active');
        tabVideo.classList.remove('active');
        tabWebcam.classList.remove('active');
        uploadSection.classList.remove('hidden');
        videoSection.classList.add('hidden');
        webcamSection.classList.add('hidden');
        predictBtn.style.display = 'block';
        resetConsole();
    });

    tabVideo.addEventListener('click', () => {
        if (currentMode === 'video') return;
        currentMode = 'video';
        tabVideo.classList.add('active');
        tabImage.classList.remove('active');
        tabWebcam.classList.remove('active');
        videoSection.classList.remove('hidden');
        uploadSection.classList.add('hidden');
        webcamSection.classList.add('hidden');
        predictBtn.style.display = 'none';
        resetConsole();
    });

    tabWebcam.addEventListener('click', () => {
        if (currentMode === 'webcam') return;
        currentMode = 'webcam';
        tabWebcam.classList.add('active');
        tabImage.classList.remove('active');
        tabVideo.classList.remove('active');
        webcamSection.classList.remove('hidden');
        uploadSection.classList.add('hidden');
        videoSection.classList.add('hidden');
        predictBtn.style.display = 'none';
        resetConsole();
    });

    // --- PARAMETER CONTROL ---
    confThresh.addEventListener('input', (e) => {
        confVal.textContent = Math.round(e.target.value * 100) + '%';
    });

    // --- DRAWING LOGIC (VECTOR OVERLAY CANVAS) ---
    function drawDetections(detections, isMirrored = false) {
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        
        if (!detections || detections.length === 0) return;
        
        const width = overlayCanvas.width;
        
        detections.forEach(det => {
            let [x1, y1, x2, y2] = det.box;
            
            // Scale bounding box coordinates from downscaled space back to active screen resolution space
            x1 = x1 * scaleX;
            y1 = y1 * scaleY;
            x2 = x2 * scaleX;
            y2 = y2 * scaleY;
            
            // Mirror coordinate transformation if horizontal scale flipped
            if (isMirrored) {
                const tempX1 = width - x2;
                const tempX2 = width - x1;
                x1 = tempX1;
                x2 = tempX2;
            }
            
            // Assign class colors
            let color = '#cf4f4f'; // red for gun
            if (det.class === 'knife') color = '#dda12e'; // brass for knife
            else if (det.class === 'rifle') color = '#ec4899'; // magenta/pink for rifle
            
            // Bounding box draw
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(2.5, Math.floor(width / 250));
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            
            // Label tag drawing
            ctx.fillStyle = color;
            const fontSize = Math.max(12, Math.floor(width / 45));
            ctx.font = `bold ${fontSize}px sans-serif`;
            const text = `${det.class.toUpperCase()} ${Math.round(det.confidence * 100)}%`;
            const textWidth = ctx.measureText(text).width;
            
            // Draw background fill for readability
            ctx.fillRect(x1 - 1, y1 - fontSize - 5, textWidth + 10, fontSize + 6);
            
            // Text write
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, x1 + 4, y1 - 4);
        });
    }

    // --- IMAGE LOADING AND UPLOAD ---
    dropZoneImage.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneImage.classList.add('dragover'); });
    dropZoneImage.addEventListener('dragleave', () => dropZoneImage.classList.remove('dragover'));
    dropZoneImage.addEventListener('drop', (e) => {
        e.preventDefault(); dropZoneImage.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
    });
    dropZoneImage.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleImageFile(e.target.files[0]);
    });

    function handleImageFile(file) {
        if (!file.type.startsWith('image/')) { alert('Unsupported file type. Please upload an image.'); return; }
        currentImageFile = file;
        predictBtn.disabled = false;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            outputImage.src = e.target.result;
            outputImage.classList.remove('hidden');
            activeVideo.classList.add('hidden');
            placeholder.classList.add('hidden');
            
            // Wait for image load to configure canvas size
            outputImage.onload = () => {
                matchCanvasToResolution('image');
                // Draw clear overlay
                const ctx = overlayCanvas.getContext('2d');
                ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            };
            
            detCount.textContent = '0';
            infTime.textContent = '0ms';
            detList.innerHTML = '<div class="empty-log">Awaiting analysis execution...</div>';
            setSystemStatus('ready', 'Static Image Loaded');
        };
        reader.readAsDataURL(file);
    }

    predictBtn.addEventListener('click', async () => {
        if (!currentImageFile) return;
        predictBtn.disabled = true;
        setSystemStatus('processing', 'Analyzing image...');
        loading.classList.remove('hidden');
        
        // Reset scale factors for static image (no downscaling)
        scaleX = 1.0;
        scaleY = 1.0;
        
        const formData = new FormData();
        formData.append('file', currentImageFile);
        formData.append('conf_thresh', confThresh.value);
        formData.append('return_image', 'false'); // Render client-side instead!
        
        try {
            const response = await fetch(getApiUrl('/api/predict'), { method: 'POST', body: formData });
            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);
            
            matchCanvasToResolution('image');
            drawDetections(data.detections, false);
            
            detCount.textContent = data.total_detections;
            infTime.textContent = data.inference_time_ms + 'ms';
            
            detList.innerHTML = '';
            if (data.total_detections > 0) {
                setSystemStatus('alert', `WEAPON DETECTED (${data.total_detections})`);
                playVoiceAlert();
                refreshThreatHistory();
                
                data.detections.forEach(det => {
                    const el = document.createElement('div');
                    el.className = 'detection-box';
                    el.innerHTML = `
                        <div class="det-header">
                            <span class="det-class">${det.class}</span>
                            <span>${Math.round(det.confidence * 100)}%</span>
                        </div>
                        <div class="det-box">Box Coordinates: [${det.box.map(Math.round).join(', ')}]</div>
                    `;
                    detList.appendChild(el);
                });
            } else {
                setSystemStatus('ready', 'Analysis Complete: Clear');
                detList.innerHTML = '<div class="empty-log">No anomalies detected.</div>';
            }
        } catch (err) {
            console.error(err);
            alert('Prediction error: ' + err.message);
            setSystemStatus('ready', 'Analysis Failed');
        } finally {
            loading.classList.add('hidden');
            predictBtn.disabled = false;
        }
    });

    // --- VIDEO LOADING AND PLAYBACK ---
    dropZoneVideo.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneVideo.classList.add('dragover'); });
    dropZoneVideo.addEventListener('dragleave', () => dropZoneVideo.classList.remove('dragover'));
    dropZoneVideo.addEventListener('drop', (e) => {
        e.preventDefault(); dropZoneVideo.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
    });
    dropZoneVideo.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleVideoFile(e.target.files[0]);
    });

    function handleVideoFile(file) {
        if (!file.type.startsWith('video/')) { alert('Unsupported file type. Please upload a video.'); return; }
        currentVideoFile = file;
        
        activeVideo.src = URL.createObjectURL(file);
        activeVideo.classList.remove('hidden');
        outputImage.classList.add('hidden');
        placeholder.classList.add('hidden');
        activeVideo.classList.remove('mirrored');
        
        activeVideo.onloadedmetadata = () => {
            matchCanvasToResolution('video');
            const ctx = overlayCanvas.getContext('2d');
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        };
        
        playVideoBtn.disabled = false;
        toggleVideoDetectBtn.disabled = false;
        playVideoBtn.textContent = 'Play Video';
        
        detCount.textContent = '0';
        infTime.textContent = '0ms';
        detList.innerHTML = '<div class="empty-log">Awaiting video playback/analysis...</div>';
        setSystemStatus('ready', 'Video Loaded Successfully');
    }

    playVideoBtn.addEventListener('click', () => {
        if (activeVideo.paused) {
            activeVideo.play();
            playVideoBtn.textContent = 'Pause';
        } else {
            activeVideo.pause();
            playVideoBtn.textContent = 'Play Video';
        }
    });

    activeVideo.addEventListener('play', () => {
        playVideoBtn.textContent = 'Pause';
        if (isVideoAnalysisActive) {
            requestAnimationFrame(videoFrameProcessingLoop);
        }
    });

    activeVideo.addEventListener('pause', () => {
        playVideoBtn.textContent = 'Play Video';
    });

    activeVideo.addEventListener('ended', () => {
        playVideoBtn.textContent = 'Play Video';
        stopVideoAnalysis();
    });

    toggleVideoDetectBtn.addEventListener('click', () => {
        if (isVideoAnalysisActive) {
            stopVideoAnalysis();
        } else {
            startVideoAnalysis();
        }
    });

    function startVideoAnalysis() {
        if (!currentVideoFile) return;
        isVideoAnalysisActive = true;
        toggleVideoDetectBtn.textContent = 'Stop Analysis';
        toggleVideoDetectBtn.style.background = 'var(--danger)';
        toggleVideoDetectBtn.style.borderColor = 'var(--danger)';
        
        if (activeVideo.paused) {
            activeVideo.play();
        }
        setSystemStatus('processing', 'Analyzing Video Stream...');
        requestAnimationFrame(videoFrameProcessingLoop);
    }

    function stopVideoAnalysis() {
        isVideoAnalysisActive = false;
        toggleVideoDetectBtn.textContent = 'Analyze Video';
        toggleVideoDetectBtn.style.background = 'var(--accent)';
        toggleVideoDetectBtn.style.borderColor = 'var(--accent-hover)';
        setSystemStatus('ready', 'Video Analysis Stopped');
        
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    // --- VIDEO ANALYSIS FRAME PROCESSING LOOP (STRICT CONCURRENCY LOCK) ---
    async function videoFrameProcessingLoop() {
        if (!isVideoAnalysisActive || activeVideo.paused || activeVideo.ended) return;
        
        if (isSending) {
            requestAnimationFrame(videoFrameProcessingLoop);
            return;
        }

        if (activeVideo.readyState !== 4) {
            requestAnimationFrame(videoFrameProcessingLoop);
            return;
        }

        isSending = true;

        const vw = activeVideo.videoWidth;
        const vh = activeVideo.videoHeight;
        
        // Client-side downscaling to max 640px to minimize network latency
        const maxDim = 640;
        let targetW = vw;
        let targetH = vh;
        if (vw > maxDim || vh > maxDim) {
            if (vw > vh) {
                targetW = maxDim;
                targetH = Math.round((vh * maxDim) / vw);
            } else {
                targetH = maxDim;
                targetW = Math.round((vw * maxDim) / vh);
            }
        }

        scaleX = vw / targetW;
        scaleY = vh / targetH;

        captureCanvas.width = targetW;
        captureCanvas.height = targetH;
        const ctx = captureCanvas.getContext('2d');
        ctx.drawImage(activeVideo, 0, 0, targetW, targetH);

        captureCanvas.toBlob(async (blob) => {
            if (blob) {
                try {
                    await predictFrameStream(blob, false);
                } catch (err) {
                    console.error(err);
                } finally {
                    isSending = false;
                    if (isVideoAnalysisActive) {
                        requestAnimationFrame(videoFrameProcessingLoop);
                    }
                }
            } else {
                isSending = false;
                if (isVideoAnalysisActive) {
                    requestAnimationFrame(videoFrameProcessingLoop);
                }
            }
        }, 'image/jpeg', 0.7);
    }

    // --- WEBCAM STREAM CONTROLS ---
    toggleWebcamBtn.addEventListener('click', async () => {
        if (isWebcamActive) {
            stopWebcam();
        } else {
            await startWebcam();
        }
    });

    async function startWebcam() {
        resetConsole();
        setSystemStatus('processing', 'Starting Camera...');
        loading.classList.remove('hidden');

        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 },
                    facingMode: 'environment' 
                } 
            });
            activeVideo.srcObject = webcamStream;
            activeVideo.classList.remove('hidden');
            placeholder.classList.add('hidden');
            activeVideo.classList.add('mirrored'); // Mirror display

            activeVideo.onloadedmetadata = () => {
                matchCanvasToResolution('video');
                const ctx = overlayCanvas.getContext('2d');
                ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                isWebcamActive = true;
                toggleWebcamBtn.textContent = 'Stop Webcam';
                toggleWebcamBtn.style.background = 'var(--danger)';
                toggleWebcamBtn.style.borderColor = 'var(--danger)';
                
                setSystemStatus('ready', 'Webcam Stream Connected (Mirrored)');
                // Trigger live capture loop
                requestAnimationFrame(webcamFrameProcessingLoop);
            };
        } catch (err) {
            console.error(err);
            alert('Webcam permission denied or camera offline: ' + err.message);
            setSystemStatus('ready', 'Camera connection failed');
        } finally {
            loading.classList.add('hidden');
        }
    }

    function stopWebcam() {
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
        }
        activeVideo.srcObject = null;
        activeVideo.classList.add('hidden');
        activeVideo.classList.remove('mirrored');
        
        isWebcamActive = false;
        toggleWebcamBtn.textContent = 'Initialize Stream';
        toggleWebcamBtn.style.background = 'var(--accent)';
        toggleWebcamBtn.style.borderColor = 'var(--accent-hover)';
        
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        
        setSystemStatus('ready', 'Webcam Off');
    }

    // --- WEBCAM FRAME PROCESSING LOOP (STRICT CONCURRENCY LOCK) ---
    async function webcamFrameProcessingLoop() {
        if (!isWebcamActive) return;

        if (isSending) {
            requestAnimationFrame(webcamFrameProcessingLoop);
            return;
        }

        if (activeVideo.readyState !== 4) {
            requestAnimationFrame(webcamFrameProcessingLoop);
            return;
        }

        isSending = true;

        const vw = activeVideo.videoWidth;
        const vh = activeVideo.videoHeight;
        
        // Client-side downscaling to max 640px to minimize network latency
        const maxDim = 640;
        let targetW = vw;
        let targetH = vh;
        if (vw > maxDim || vh > maxDim) {
            if (vw > vh) {
                targetW = maxDim;
                targetH = Math.round((vh * maxDim) / vw);
            } else {
                targetH = maxDim;
                targetW = Math.round((vw * maxDim) / vh);
            }
        }

        scaleX = vw / targetW;
        scaleY = vh / targetH;

        captureCanvas.width = targetW;
        captureCanvas.height = targetH;
        const ctx = captureCanvas.getContext('2d');
        
        // Draw the raw webcam frame (non-mirrored) to send to the backend
        ctx.drawImage(activeVideo, 0, 0, targetW, targetH);

        captureCanvas.toBlob(async (blob) => {
            if (blob) {
                try {
                    await predictFrameStream(blob, true); // true = mirrored coordinates
                } catch (err) {
                    console.error(err);
                } finally {
                    isSending = false;
                    if (isWebcamActive) {
                        requestAnimationFrame(webcamFrameProcessingLoop);
                    }
                }
            } else {
                isSending = false;
                if (isWebcamActive) {
                    requestAnimationFrame(webcamFrameProcessingLoop);
                }
            }
        }, 'image/jpeg', 0.7);
    }

    // --- FRAME PREDICTION PIPELINE ---
    async function predictFrameStream(fileBlob, isMirrored) {
        const formData = new FormData();
        formData.append('file', fileBlob, 'frame.jpg');
        formData.append('conf_thresh', confThresh.value);
        formData.append('return_image', 'false'); // Return JSON boxes only to save bandwidth

        try {
            const response = await fetch(getApiUrl('/api/predict'), { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Frame prediction failed');
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);

            // Re-sync overlay bounds
            matchCanvasToResolution('video');
            drawDetections(data.detections, isMirrored);

            // Update Telemetry metrics
            detCount.textContent = data.total_detections;
            infTime.textContent = data.inference_time_ms + 'ms';

            // Update local frame detection listing
            detList.innerHTML = '';
            if (data.total_detections > 0) {
                setSystemStatus('alert', `THREAT ACTIVE: WEAPON DETECTED (${data.total_detections})`);
                playVoiceAlert();
                
                // Throttle history refresh to prevent browser network queue saturation
                const now = Date.now();
                if (now - lastHistoryRefreshTime > 2000) {
                    refreshThreatHistory();
                    lastHistoryRefreshTime = now;
                }

                data.detections.forEach(det => {
                    const el = document.createElement('div');
                    el.className = 'detection-box';
                    el.innerHTML = `
                        <div class="det-header">
                            <span class="det-class">${det.class}</span>
                            <span>${Math.round(det.confidence * 100)}%</span>
                        </div>
                        <div class="det-box">Coordinates: [${det.box.map(Math.round).join(', ')}]</div>
                    `;
                    detList.appendChild(el);
                });
            } else {
                setSystemStatus('processing', isWebcamActive ? 'Live Stream Active' : 'Analyzing Video Stream...');
                detList.innerHTML = '<div class="empty-log">No anomalies detected.</div>';
            }
        } catch (error) {
            console.error('Inference pipeline error:', error);
        }
    }

    // --- THREAT HISTORY LOGS SIDEBAR REFRESH ---
    async function refreshThreatHistory() {
        try {
            // Fetch last 15 elements to keep it clean and neat
            const response = await fetch(getApiUrl('/api/history?limit=15'));
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);

            historyListCompact.innerHTML = '';
            if (data.history && data.history.length > 0) {
                data.history.forEach(row => {
                    const item = document.createElement('div');
                    item.className = 'history-item-compact';
                    
                    const timeObj = new Date(row.timestamp);
                    const timeString = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const dateString = timeObj.toLocaleDateString([], { month: 'short', day: '2-digit' });

                    item.innerHTML = `
                        <div class="history-item-details">
                            <span class="history-item-class">${row.weapon_classes}</span>
                            <span class="history-item-time">${dateString} ${timeString} (${row.num_detections} det)</span>
                        </div>
                        <span class="history-item-conf">${Math.round(row.highest_confidence * 100)}%</span>
                    `;
                    historyListCompact.appendChild(item);
                });
            } else {
                historyListCompact.innerHTML = '<div class="empty-log">No threats logged yet.</div>';
            }
        } catch (err) {
            console.error('Error refreshing history panel:', err);
            historyListCompact.innerHTML = '<div class="empty-log" style="color:var(--danger)">Logs offline</div>';
        }
    }

    // --- CSV AND PDF EXPORTS LOGIC ---
    // Helper to escape values for CSV RFC4180 compatibility
    function escapeCSVValue(val) {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (/[",\n\r]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    exportCsvBtn.addEventListener('click', async () => {
        try {
            setSystemStatus('processing', 'Generating CSV Report...');
            const response = await fetch(getApiUrl('/api/history?limit=0')); // Fetch complete history
            const data = await response.json();

            if (data.error) throw new Error(data.error);
            if (!data.history || data.history.length === 0) {
                alert('No threat logs in database to export.');
                return;
            }

            const headers = ['Record ID', 'ISO Timestamp', 'Human Date', 'Detections Count', 'Detected Weapons', 'Max Confidence'];
            const rows = [headers.join(',')];

            data.history.forEach(row => {
                const dateObj = new Date(row.timestamp);
                const csvRow = [
                    row.id,
                    row.timestamp,
                    dateObj.toLocaleString(),
                    row.num_detections,
                    escapeCSVValue(row.weapon_classes),
                    row.highest_confidence
                ];
                rows.push(csvRow.join(','));
            });

            const csvString = rows.join('\n');
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `threat_audit_report_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setSystemStatus('ready', 'CSV Report Exported');
        } catch (err) {
            console.error(err);
            alert('CSV export error: ' + err.message);
        }
    });

    exportPdfBtn.addEventListener('click', async () => {
        try {
            setSystemStatus('processing', 'Compiling PDF Report...');
            const response = await fetch(getApiUrl('/api/history?limit=0')); // Fetch complete history
            const data = await response.json();

            if (data.error) throw new Error(data.error);
            if (!data.history || data.history.length === 0) {
                alert('No threat logs in database to export.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            // Set styling palette
            const colorRed = [207, 79, 79];       // #cf4f4f Danger
            const colorDark = [29, 34, 32];       // #1d2220 Panel base
            const colorMuted = [139, 153, 147];   // #8b9993 Text secondary

            // 1. Draw header layout
            doc.setFillColor(...colorDark);
            doc.rect(0, 0, 210, 40, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(22);
            doc.setTextColor(232, 237, 234); // light text
            doc.text('THREAT DETECTION CONSOLE', 15, 20);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(196, 140, 37); // brass accent
            doc.text('TACTICAL INCIDENT AUDIT REPORT', 15, 27);

            doc.setTextColor(...colorMuted);
            doc.setFontSize(9);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 155, 18);
            doc.text('Audited by CoderAxo Core Engine', 155, 24);
            doc.text('Database Engine: SQLite3', 155, 30);

            // 2. Generate tabular details
            const tableHeaders = [['Record ID', 'Date & Time', 'Threats Count', 'Detected Target Classes', 'Max Conf.']];
            const tableRows = [];

            data.history.forEach(row => {
                tableRows.push([
                    `#${row.id}`,
                    new Date(row.timestamp).toLocaleString(),
                    row.num_detections,
                    row.weapon_classes,
                    `${Math.round(row.highest_confidence * 100)}%`
                ]);
            });

            // 3. Render AutoTable
            doc.autoTable({
                startY: 50,
                head: tableHeaders,
                body: tableRows,
                theme: 'striped',
                headStyles: { 
                    fillColor: colorDark,
                    textColor: [232, 237, 234],
                    fontStyle: 'bold',
                    fontSize: 10,
                    lineWidth: 0.2,
                    strokeColor: [52, 61, 57]
                },
                alternateRowStyles: { 
                    fillColor: [247, 248, 248] 
                },
                styles: { 
                    font: 'helvetica', 
                    fontSize: 9,
                    cellPadding: 3,
                    textColor: [41, 48, 45]
                },
                columnStyles: {
                    0: { cellWidth: 20 },
                    1: { cellWidth: 50 },
                    2: { cellWidth: 30, halign: 'center' },
                    3: { cellWidth: 65, fontStyle: 'bold', textColor: colorRed },
                    4: { cellWidth: 25, halign: 'right', fontStyle: 'bold' }
                },
                margin: { left: 15, right: 15 }
            });

            // Save PDF
            doc.save(`threat_incident_report_${Date.now()}.pdf`);
            setSystemStatus('ready', 'PDF Report Compiled');
        } catch (err) {
            console.error(err);
            alert('PDF compilation failed: ' + err.message);
        }
    });

    // --- DB HISTORY FULL TABLE MODAL LOGIC ---
    viewHistoryBtn.addEventListener('click', async () => {
        historyModal.classList.remove('hidden');
        historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading logs...</td></tr>';
        
        try {
            const response = await fetch(getApiUrl('/api/history?limit=100'));
            const data = await response.json();
            
            if (data.history && data.history.length > 0) {
                historyTableBody.innerHTML = '';
                data.history.forEach(row => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>#${row.id}</td>
                        <td>${new Date(row.timestamp).toLocaleString()}</td>
                        <td style="text-align:center; font-weight:bold;">${row.num_detections}</td>
                        <td style="color: var(--danger); font-weight:600; text-transform:uppercase;">${row.weapon_classes}</td>
                        <td style="font-weight:bold;">${Math.round(row.highest_confidence * 100)}%</td>
                    `;
                    historyTableBody.appendChild(tr);
                });
            } else {
                historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No detection history found.</td></tr>';
            }
        } catch (error) {
            historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--danger);">Failed to load history.</td></tr>';
            console.error('Error fetching history:', error);
        }
    });

    closeModalBtn.addEventListener('click', () => {
        historyModal.classList.add('hidden');
        refreshThreatHistory();
    });

    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            historyModal.classList.add('hidden');
            refreshThreatHistory();
        }
    });

    // --- INITIALIZATION ON LOAD & HEALTH CHECK ---
    async function checkBackendHealth() {
        setSystemStatus('processing', 'Connecting to Backend...');
        try {
            const response = await fetch(getApiUrl('/api/health'));
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.warn('Backend offline or not returning JSON');
                setSystemStatus('alert', 'Backend Offline');
                return false;
            }
            const data = await response.json();
            if (data.model_loaded) {
                setSystemStatus('ready', 'System Online');
                return data.status === 'ok';
            } else {
                setSystemStatus('alert', 'Model Load Failed on Server');
                return false;
            }
        } catch (error) {
            console.warn('Health check failed:', error.message);
            setSystemStatus('alert', 'Backend Server Offline');
            return false;
        }
    }

    refreshThreatHistory();
    checkBackendHealth();
});
