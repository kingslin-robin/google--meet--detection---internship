// recorder.js - Complete updated version

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let recordingStartTime;
let timerInterval;
let currentService = null;
let isAutoRecord = false;
let isIframeRecording = false;
let currentTabId = null;

// DOM elements
const timerElement = document.getElementById('timer');
const statusElement = document.getElementById('status');
const serviceBadge = document.getElementById('serviceBadge');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log("🎙️ Recorder page loaded");
    setupMessageListener();
});

function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("📨 Recorder received:", message.action);
        
        if (message.action === "startRecording") {
            currentTabId = message.tabId;
            currentService = message.service || 'gmeet';
            isAutoRecord = message.autoRecord || false;
            isIframeRecording = message.isIframe || false;
            
            // Update service badge
            updateServiceBadge(currentService);
            
            startRecording(message.tabId);
            sendResponse({ success: true });
        }
        
        if (message.action === "stopRecording") {
            stopRecording();
            sendResponse({ success: true });
        }
        
        return true;
    });
}

function updateServiceBadge(service) {
    if (service === 'gmeet') {
        serviceBadge.textContent = '📹 Google Meet';
        serviceBadge.className = 'service-badge gmeet-badge';
    } else if (service === 'teams') {
        serviceBadge.textContent = '💼 Microsoft Teams';
        serviceBadge.className = 'service-badge teams-badge';
    } else if (service === 'zoom') {
        serviceBadge.textContent = '🎥 Zoom';
        serviceBadge.className = 'service-badge zoom-badge';
    }
}

async function startRecording(tabId) {
    console.log(`🎬 Starting recording for ${currentService} tab:`, tabId, `(iframe: ${isIframeRecording})`);
    
    if (isRecording) {
        console.log("❌ Already recording - aborting");
        return;
    }

    try {
        safeSetStatus(isAutoRecord ? "🟡 Auto recording starting..." : "🟡 Starting recording...");
        
        // Get the tab to capture
        const tab = await getTab(tabId);
        if (!tab) {
            throw new Error("Target tab not found");
        }
        
        console.log("✅ Source tab validated:", tab.url);
        
        // Capture the tab stream
        const tabStream = await captureTabStream(tabId);
        console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length);
        
        // Get microphone stream
        const micStream = await getMicrophoneStream();
        console.log("✅ Microphone stream captured");
        
        // Mix audio streams
        const mixedStream = await mixAudioStreams(tabStream, micStream);
        console.log("✅ Audio streams mixed");
        
        // Create video stream with mixed audio
        const videoTracks = tabStream.getVideoTracks();
        const finalStream = new MediaStream();
        
        // Add video track from tab capture
        if (videoTracks.length > 0) {
            finalStream.addTrack(videoTracks[0]);
        }
        
        // Add mixed audio tracks
        mixedStream.getAudioTracks().forEach(track => {
            finalStream.addTrack(track);
        });
        
        // Setup media recorder
        const mimeType = getSupportedMimeType();
        console.log("🎥 Using MIME type:", mimeType);
        
        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 128000,
            videoBitsPerSecond: 2500000
        });
        
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            saveRecording();
        };
        
        mediaRecorder.start(1000); // Collect data every second
        isRecording = true;
        recordingStartTime = Date.now();
        
        // Start timer
        startTimer();
        
        // Notify content script
        notifyContentScriptRecordingStarted();
        
        safeSetStatus("🔴 Recording in progress...");
        
        // Store recording state
        await chrome.storage.local.set({ 
            isRecording: true,
            recordingService: currentService,
            isIframeRecording: isIframeRecording
        });
        
        console.log("✅ Recording started successfully");
        
    } catch (err) {
        console.error("❌ Recording start failed:", err);
        safeSetStatus("❌ Recording failed: " + err.message);
        notifyContentScriptRecordingFailed(err.message);
        cleanup();
    }
}

function getTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Tab not accessible: ${chrome.runtime.lastError.message}`));
            } else {
                resolve(tab);
            }
        });
    });
}

function captureTabStream(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabCapture.capture({
            audio: true,
            video: true,
            audioConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: tabId.toString(),
                }
            },
            videoConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: tabId.toString(),
                    minWidth: 1280,
                    minHeight: 720,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 30
                }
            }
        }, (stream) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
            } else if (!stream) {
                reject(new Error("No stream returned - check permissions"));
            } else {
                resolve(stream);
            }
        });
    });
}

function getMicrophoneStream() {
    return navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
            console.warn("⚠️ Could not get microphone:", err);
            // Return empty stream if microphone fails
            return new MediaStream();
        });
}

function mixAudioStreams(tabStream, micStream) {
    return new Promise((resolve, reject) => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            const tabSource = audioContext.createMediaStreamSource(tabStream);
            const micSource = audioContext.createMediaStreamSource(micStream);
            
            const mixer = audioContext.createGain();
            const tabGain = audioContext.createGain();
            const micGain = audioContext.createGain();
            
            // Set volumes (tab audio at 100%, mic at 100%)
            tabGain.gain.value = 1.0;
            micGain.gain.value = 1.0;
            
            tabSource.connect(tabGain);
            micSource.connect(micGain);
            
            tabGain.connect(mixer);
            micGain.connect(mixer);
            
            const destination = audioContext.createMediaStreamDestination();
            mixer.connect(destination);
            
            // Start audio context
            audioContext.resume();
            
            // Create a stream from the destination
            const mixedStream = destination.stream;
            
            // Also add original tab audio tracks as fallback
            tabStream.getAudioTracks().forEach(track => {
                mixedStream.addTrack(track.clone());
            });
            
            resolve(mixedStream);
        } catch (err) {
            console.error("❌ Audio mixing failed:", err);
            // Fallback: use just tab audio
            resolve(tabStream);
        }
    });
}

function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
    ];
    
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    
    return 'video/webm';
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (isRecording && recordingStartTime) {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            timerElement.textContent = timeString;
            
            // Update storage for popup
            chrome.storage.local.set({ recordingTime: timeString });
            
            // Update meeting page timer
            chrome.tabs.query({ active: true }, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes(currentService)) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "updateMeetTimer",
                        time: timeString
                    }).catch(() => {});
                }
            });
        }
    }, 1000);
}

function stopRecording() {
    console.log("🛑 Stopping recording...");
    
    if (mediaRecorder && isRecording) {
        safeSetStatus("🟡 Stopping recording...");
        
        mediaRecorder.onstop = () => {
            console.log("✅ Recording stopped, saving file...");
            saveRecording();
        };
        
        mediaRecorder.stop();
        isRecording = false;
        
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        
        // Clear storage
        chrome.storage.local.remove(['isRecording', 'recordingTime']);
        
        // Notify content script
        notifyContentScriptRecordingStopped();
    }
}

function saveRecording() {
    if (recordedChunks.length === 0) {
        console.error("❌ No recorded data");
        safeSetStatus("❌ No recording data to save");
        return;
    }
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${currentService}_recording_${timestamp}.webm`;
    
    chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("❌ Download failed:", chrome.runtime.lastError);
            safeSetStatus("❌ Download failed: " + chrome.runtime.lastError.message);
        } else {
            console.log("✅ Recording saved as:", filename);
            safeSetStatus("✅ Recording saved! Check your Downloads folder");
            
            // Notify completion
            chrome.runtime.sendMessage({ 
                action: "recordingCompleted",
                filename: filename
            });
            
            // Close recorder tab after delay
            setTimeout(() => {
                window.close();
            }, 2000);
        }
        
        // Clean up
        URL.revokeObjectURL(url);
        recordedChunks = [];
    });
}

function cleanup() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
            mediaRecorder.stop();
        } catch (e) {}
    }
    
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    isRecording = false;
    chrome.storage.local.remove(['isRecording', 'recordingTime']);
}

function safeSetStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
    console.log("📊 Status:", message);
    
    // Also update meeting page status
    if (currentService === 'gmeet') {
        broadcastToMeetTab(message);
    }
}

function broadcastToMeetTab(message) {
    // Send to all tabs with Google Meet
    chrome.tabs.query({ url: "*://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                action: "showMeetStatus",
                message: message,
                duration: 3000
            }).catch(() => {});
        });
    });
}

function notifyContentScriptRecordingStarted() {
    chrome.tabs.query({ active: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes(currentService)) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: currentService === 'gmeet' ? "manualRecordingStarted" : "recordingStarted"
            }).catch(() => {});
        }
    });
}

function notifyContentScriptRecordingStopped() {
    chrome.tabs.query({ active: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes(currentService)) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: currentService === 'gmeet' ? "manualRecordingStopped" : "recordingStopped"
            }).catch(() => {});
        }
    });
}

function notifyContentScriptRecordingFailed(error) {
    chrome.tabs.query({ active: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes(currentService)) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "showMeetStatus",
                message: "❌ Recording failed: " + error,
                duration: 5000
            }).catch(() => {});
        }
    });
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (isRecording) {
        cleanup();
    }
});