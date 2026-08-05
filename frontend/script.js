document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
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

    // Update confidence threshold display
    confThresh.addEventListener('input', (e) => {
        confVal.textContent = Math.round(e.target.value * 100) + '%';
    });

    // Handle drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file.');
            return;
        }
        currentFile = file;
        predictBtn.disabled = false;
        
        // Preview original image
        const reader = new FileReader();
        reader.onload = (e) => {
            outputImage.src = e.target.result;
            outputImage.classList.remove('hidden');
            placeholder.classList.add('hidden');
            
            // Reset metrics
            detCount.textContent = '0';
            infTime.textContent = '0ms';
            detList.innerHTML = '';
        };
        reader.readAsDataURL(file);
    }

    predictBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        // Show loading state
        predictBtn.disabled = true;
        loading.classList.remove('hidden');
        outputImage.style.opacity = '0.5';

        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('conf_thresh', confThresh.value);

        try {
            // Note: Since this will be deployed on Vercel with a rewrite,
            // we can just call /api/predict and Vercel will proxy it to Railway
            const response = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Prediction failed');

            const data = await response.json();

            if (data.error) throw new Error(data.error);

            // Update UI with results
            outputImage.src = data.annotated_image;
            detCount.textContent = data.total_detections;
            infTime.textContent = data.inference_time_ms + 'ms';

            // Render detection list
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
            console.error('Error:', error);
            alert('Error during prediction: ' + error.message);
        } finally {
            predictBtn.disabled = false;
            loading.classList.add('hidden');
            outputImage.style.opacity = '1';
        }
    });
});
