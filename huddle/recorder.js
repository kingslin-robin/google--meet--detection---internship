// recorder.js - Captures huddle iframe with audio

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let timerInterval = null;
let recordingStartTime = null;
let currentService = null;
let currentTabId = null;
let mediaStream = null;
let audioContext = null;
let micStream = null;

const timerElement = document.getElementById('timer');
const statusElement = document.getElementById('status');
const serviceBadge = document.getElementById('serviceBadge');

document.addEventListener('DOMContentLoaded', () => {
    console.log("🎙️ Recorder loaded");
    setupMessageListener();
    requestMicPermission();
});

async function requestMicPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        console.log("✅ Mic permission granted");
        updateStatus("✅ Microphone ready");
    } catch (err) {
        console.warn("Mic not available:", err);
        updateStatus("⚠️ Microphone denied - meeting audio only");
    }
}

function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Recorder received:", message.action);
        
        if (message.action === "startRecording") {
            currentTabId = message.tabId;
            currentService = message.service || 'gchat';
            updateServiceBadge(currentService);
            startRecording();
            sendResponse({ success: true });
        }
        
        if (message.action === "stopRecording") {
            stopRecording();
            sendResponse({ success: true });
        }
        
        if (message.action === "ping") {
            sendResponse({ success: true });
        }
        
        return true;
    });
}

function updateServiceBadge(service) {
    if (!serviceBadge) return;
    const labels = {
        gmeet: '📹 Google Meet',
        gchat: '💬 Google Chat Huddle',
        teams: '💼 Teams',
        zoom: '🎥 Zoom'
    };
    serviceBadge.textContent = labels[service] || 'Meeting';
}

async function startRecording() {
    if (isRecording) return;
    
    console.log(`Starting recording for tab: ${currentTabId}`);
    updateStatus("Starting recording...");
    
    try {
        // Activate the huddle tab
        await activateTab(currentTabId);
        await sleep(1000);
        
        // Capture the tab (this captures the iframe content!)
        updateStatus("Capturing meeting audio...");
        const tabStream = await captureTab();
        
        if (!tabStream || tabStream.getAudioTracks().length === 0) {
            throw new Error("No audio stream captured");
        }
        
        // Get microphone
        updateStatus("Connecting microphone...");
        micStream = await getMicrophone();
        
        // Create final stream
        let finalStream;
        if (micStream && micStream.getAudioTracks().length > 0) {
            updateStatus("Mixing audio sources...");
            finalStream = await mixAudio(tabStream, micStream);
        } else {
            finalStream = tabStream;
            updateStatus("Recording meeting audio only");
        }
        
        // Setup recorder
        const mimeType = getMimeType();
        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 256000,
            videoBitsPerSecond: 2500000
        });
        
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => saveRecording();
        mediaRecorder.onerror = (e) => {
            console.error("Recorder error:", e);
            updateStatus("Recording error", true);
        };
        
        mediaRecorder.start(1000);
        isRecording = true;
        recordingStartTime = Date.now();
        mediaStream = finalStream;
        
        startTimer();
        await chrome.storage.local.set({ isRecording: true });
        chrome.runtime.sendMessage({ action: "recordingStarted" });
        updateStatus("🔴 RECORDING...");
        
        console.log("Recording started successfully");
        
    } catch (err) {
        console.error("Start failed:", err);
        updateStatus(`Failed: ${err.message}`, true);
        cleanup();
        chrome.runtime.sendMessage({ action: "recorderFailed", error: err.message });
    }
}

function activateTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.update(tabId, { active: true }, (tab) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(tab);
        });
    });
}

function captureTab() {
    return new Promise((resolve, reject) => {
        chrome.tabCapture.capture({
            audio: true,
            video: true,
            audioConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    echoCancellation: true,
                    noiseSuppression: true
                }
            }
        }, (stream) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (!stream) {
                reject(new Error("No stream"));
            } else {
                stream.getAudioTracks().forEach(t => t.enabled = true);
                resolve(stream);
            }
        });
    });
}

async function getMicrophone() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 48000
            }
        });
        stream.getAudioTracks().forEach(t => t.enabled = true);
        return stream;
    } catch (err) {
        console.warn("Mic error:", err);
        return null;
    }
}

async function mixAudio(tabStream, micStream) {
    return new Promise((resolve) => {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            const tabSource = audioContext.createMediaStreamSource(tabStream);
            const micSource = audioContext.createMediaStreamSource(micStream);
            
            const tabGain = audioContext.createGain();
            const micGain = audioContext.createGain();
            tabGain.gain.value = 1.0;
            micGain.gain.value = 1.0;
            
            tabSource.connect(tabGain);
            micSource.connect(micGain);
            
            const mixer = audioContext.createGain();
            tabGain.connect(mixer);
            micGain.connect(mixer);
            
            const destination = audioContext.createMediaStreamDestination();
            mixer.connect(destination);
            
            const final = new MediaStream();
            
            if (tabStream.getVideoTracks().length > 0) {
                final.addTrack(tabStream.getVideoTracks()[0]);
            }
            
            destination.stream.getAudioTracks().forEach(t => final.addTrack(t));
            
            audioContext.resume();
            resolve(final);
        } catch (err) {
            console.error("Mix failed:", err);
            const fallback = new MediaStream();
            if (tabStream.getVideoTracks().length > 0) fallback.addTrack(tabStream.getVideoTracks()[0]);
            if (tabStream.getAudioTracks().length > 0) fallback.addTrack(tabStream.getAudioTracks()[0]);
            if (micStream && micStream.getAudioTracks().length > 0) fallback.addTrack(micStream.getAudioTracks()[0]);
            resolve(fallback);
        }
    });
}

function getMimeType() {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (isRecording && recordingStartTime) {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            const timeString = `${mins}:${secs}`;
            
            if (timerElement) timerElement.textContent = timeString;
            chrome.storage.local.set({ recordingTime: timeString });
            
            if (currentTabId) {
                chrome.tabs.sendMessage(currentTabId, {
                    action: "updateMeetTimer",
                    time: timeString
                }).catch(() => {});
            }
        }
    }, 1000);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        updateStatus("Stopping...");
        mediaRecorder.stop();
        isRecording = false;
        
        if (timerInterval) clearInterval(timerInterval);
        
        chrome.runtime.sendMessage({ action: "recordingStopped" });
        if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, { action: "manualRecordingStopped" }).catch(() => {});
        }
        chrome.storage.local.remove(['isRecording', 'recordingTime']);
    }
}

function saveRecording() {
    if (recordedChunks.length === 0) {
        updateStatus("No data to save", true);
        return;
    }
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `huddle_recording_${timestamp}.webm`;
    
    console.log(`Saving ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    
    chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            updateStatus("Download failed", true);
        } else {
            updateStatus(`✅ Saved: ${filename}`);
            chrome.runtime.sendMessage({ action: "recordingCompleted", filename: filename });
            setTimeout(() => window.close(), 2000);
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        recordedChunks = [];
    });
}

function cleanup() {
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    if (timerInterval) clearInterval(timerInterval);
    isRecording = false;
}

function updateStatus(msg, isError = false) {
    if (statusElement) {
        statusElement.textContent = msg;
        statusElement.style.color = isError ? '#ff8888' : '#e8f5e8';
    }
    console.log("Status:", msg);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener('beforeunload', () => {
    if (isRecording) cleanup();
});

console.log("✅ Recorder script ready");