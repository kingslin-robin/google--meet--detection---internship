// recorder.js - Fixed version with proper microphone audio mixing

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let recordingStartTime;
let timerInterval;
let currentService = null;
let isAutoRecord = false;
let isIframeRecording = false;
let currentTabId = null;
let mediaStream = null;
let audioContext = null;
let microphoneStream = null;
let tabStream = null;

const timerElement = document.getElementById('timer');
const statusElement = document.getElementById('status');
const serviceBadge = document.getElementById('serviceBadge');

document.addEventListener('DOMContentLoaded', () => {
    console.log("🎙️ Recorder page loaded");
    setupMessageListener();
    
    // Request microphone permission immediately when recorder loads
    requestMicrophonePermission();
});

async function requestMicrophonePermission() {
    try {
        console.log("🎤 Requesting microphone permission...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop the stream, we just need permission
        stream.getTracks().forEach(track => track.stop());
        console.log("✅ Microphone permission granted");
        safeSetStatus("✅ Microphone access granted");
    } catch (err) {
        console.warn("⚠️ Microphone permission denied or error:", err);
        safeSetStatus("⚠️ Microphone access denied - recording will have no mic audio");
    }
}

function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("📨 Recorder received:", message.action);
        
        if (message.action === "startRecording") {
            currentTabId = message.tabId;
            currentService = message.service || 'gmeet';
            isAutoRecord = message.autoRecord || false;
            isIframeRecording = message.isIframe || false;
            
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
    if (service === 'gmeet') {
        serviceBadge.textContent = '📹 Google Meet';
        serviceBadge.className = 'service-badge gmeet-badge';
    } else if (service === 'gchat') {
        serviceBadge.textContent = '💬 Google Chat Huddle';
        serviceBadge.className = 'service-badge gchat-badge';
    } else if (service === 'teams') {
        serviceBadge.textContent = '💼 Microsoft Teams';
        serviceBadge.className = 'service-badge teams-badge';
    } else if (service === 'zoom') {
        serviceBadge.textContent = '🎥 Zoom';
        serviceBadge.className = 'service-badge zoom-badge';
    }
}

async function startRecording() {
    console.log(`🎬 Starting recording for ${currentService}, tab: ${currentTabId}`);
    
    if (isRecording) {
        console.log("❌ Already recording - aborting");
        return;
    }

    try {
        safeSetStatus(isAutoRecord ? "🟡 Auto recording starting..." : "🟡 Starting recording...");
        
        // Activate the target tab
        await activateTab(currentTabId);
        await sleep(1000);
        
        // Capture tab audio and video
        console.log("🎥 Capturing tab stream...");
        tabStream = await captureCurrentTab();
        console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length);
        console.log("✅ Tab stream captured. Video tracks:", tabStream.getVideoTracks().length);
        
        if (tabStream.getAudioTracks().length === 0) {
            console.warn("⚠️ No audio track captured from tab!");
            safeSetStatus("⚠️ Warning: No audio detected from the meeting");
        }
        
        // Capture microphone
        console.log("🎤 Capturing microphone...");
        microphoneStream = await getMicrophoneStream();
        console.log("✅ Microphone stream captured. Audio tracks:", microphoneStream.getAudioTracks().length);
        
        let finalStream;
        
        // Create final stream with both audio sources
        if (microphoneStream && microphoneStream.getAudioTracks().length > 0) {
            if (tabStream.getAudioTracks().length > 0) {
                // Both tab audio and microphone available - mix them
                console.log("🎚️ Mixing tab audio with microphone...");
                finalStream = await mixAudioStreamsAdvanced(tabStream, microphoneStream);
                console.log("✅ Audio streams mixed successfully");
            } else {
                // Only microphone available
                console.log("🎤 Using microphone audio only");
                finalStream = new MediaStream();
                if (tabStream.getVideoTracks().length > 0) {
                    finalStream.addTrack(tabStream.getVideoTracks()[0]);
                }
                microphoneStream.getAudioTracks().forEach(track => {
                    finalStream.addTrack(track);
                });
            }
        } else {
            // Only tab audio available
            console.log("🔊 Using tab audio only (no microphone)");
            finalStream = tabStream;
            safeSetStatus("🔊 Recording without microphone - enable mic in Chrome settings");
        }
        
        // Verify final stream has audio
        if (finalStream.getAudioTracks().length === 0) {
            console.warn("⚠️ Final stream has NO audio tracks!");
            safeSetStatus("⚠️ Warning: No audio will be recorded!");
        } else {
            console.log("✅ Final stream has", finalStream.getAudioTracks().length, "audio tracks");
            // Enable audio track
            finalStream.getAudioTracks().forEach(track => {
                track.enabled = true;
                console.log("🎵 Audio track enabled:", track.label);
            });
        }
        
        // Get supported MIME type
        const mimeType = getSupportedMimeType();
        console.log("🎥 Using MIME type:", mimeType);
        
        // Create media recorder with high quality settings
        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 256000,  // Higher quality audio
            videoBitsPerSecond: 2500000   // 2.5 Mbps video
        });
        
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
                console.log(`📊 Data chunk received: ${(event.data.size / 1024).toFixed(2)} KB`);
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log("🛑 MediaRecorder stopped, saving recording...");
            saveRecording();
        };
        
        mediaRecorder.onerror = (event) => {
            console.error("❌ MediaRecorder error:", event);
            safeSetStatus("❌ Recording error occurred");
        };
        
        mediaRecorder.onwarning = (event) => {
            console.warn("⚠️ MediaRecorder warning:", event);
        };
        
        // Start recording
        mediaRecorder.start(1000); // Collect data every second
        isRecording = true;
        recordingStartTime = Date.now();
        mediaStream = finalStream;
        
        // Start timer
        startTimer();
        notifyContentScriptRecordingStarted();
        
        safeSetStatus("🔴 Recording in progress... (mic: " + (microphoneStream && microphoneStream.getAudioTracks().length > 0 ? "ON" : "OFF") + ")");
        
        // Store recording state
        await chrome.storage.local.set({ 
            isRecording: true,
            recordingService: currentService,
            isIframeRecording: isIframeRecording,
            recordingStartTime: recordingStartTime
        });
        
        console.log("✅ Recording started successfully");
        chrome.runtime.sendMessage({ action: "recordingStarted" });
        
    } catch (err) {
        console.error("❌ Recording start failed:", err);
        safeSetStatus("❌ Recording failed: " + err.message);
        notifyContentScriptRecordingFailed(err.message);
        cleanup();
        chrome.runtime.sendMessage({ 
            action: "recorderFailed", 
            error: err.message 
        });
    }
}

function activateTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.update(tabId, { active: true }, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Failed to activate tab: ${chrome.runtime.lastError.message}`));
            } else {
                console.log(`✅ Tab ${tabId} activated`);
                resolve(tab);
            }
        });
    });
}

function captureCurrentTab() {
    return new Promise((resolve, reject) => {
        const captureOptions = {
            audio: true,
            video: true,
            audioConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            },
            videoConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    minWidth: 640,
                    minHeight: 360,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 30
                }
            }
        };
        
        console.log("🎥 Requesting tab capture...");
        
        chrome.tabCapture.capture(captureOptions, (stream) => {
            if (chrome.runtime.lastError) {
                console.error("❌ Tab capture error:", chrome.runtime.lastError);
                reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
            } else if (!stream) {
                reject(new Error("No stream returned from tabCapture"));
            } else {
                console.log("✅ Tab capture successful");
                // Ensure audio tracks are enabled
                stream.getAudioTracks().forEach(track => {
                    track.enabled = true;
                    console.log("🎵 Tab audio track:", track.label, "enabled:", track.enabled);
                });
                resolve(stream);
            }
        });
    });
}

async function getMicrophoneStream() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 2
            } 
        });
        
        // Ensure microphone audio tracks are enabled
        stream.getAudioTracks().forEach(track => {
            track.enabled = true;
            console.log("🎤 Microphone track:", track.label, "enabled:", track.enabled);
        });
        
        return stream;
    } catch (err) {
        console.warn("⚠️ Could not get microphone:", err);
        if (err.name === 'NotAllowedError') {
            safeSetStatus("⚠️ Microphone permission denied. Please allow microphone access.");
        } else if (err.name === 'NotFoundError') {
            safeSetStatus("⚠️ No microphone found on your system.");
        }
        // Return empty stream if microphone fails
        return new MediaStream();
    }
}

async function mixAudioStreamsAdvanced(tabStream, micStream) {
    return new Promise((resolve, reject) => {
        try {
            // Create audio context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create sources
            const tabSource = audioContext.createMediaStreamSource(tabStream);
            const micSource = audioContext.createMediaStreamSource(micStream);
            
            // Create gain nodes for volume control
            const tabGain = audioContext.createGain();
            const micGain = audioContext.createGain();
            
            // Set volumes (adjust these values as needed)
            tabGain.gain.value = 1.0;  // Full tab audio volume
            micGain.gain.value = 1.0;   // Full microphone volume
            
            // Create mixer node
            const mixer = audioContext.createGain();
            
            // Connect sources to gains
            tabSource.connect(tabGain);
            micSource.connect(micGain);
            
            // Connect gains to mixer
            tabGain.connect(mixer);
            micGain.connect(mixer);
            
            // Create destination for mixed audio
            const destination = audioContext.createMediaStreamDestination();
            mixer.connect(destination);
            
            // Create final stream
            const finalStream = new MediaStream();
            
            // Add video track from tab
            if (tabStream.getVideoTracks().length > 0) {
                const videoTrack = tabStream.getVideoTracks()[0];
                videoTrack.enabled = true;
                finalStream.addTrack(videoTrack);
                console.log("🎥 Video track added to final stream");
            }
            
            // Add mixed audio tracks
            destination.stream.getAudioTracks().forEach(track => {
                track.enabled = true;
                finalStream.addTrack(track);
                console.log("🎵 Mixed audio track added to final stream");
            });
            
            // Start audio context
            audioContext.resume().then(() => {
                console.log("🎚️ Audio context resumed, mixing active");
                console.log("🔊 Tab volume:", tabGain.gain.value);
                console.log("🎤 Mic volume:", micGain.gain.value);
            });
            
            resolve(finalStream);
        } catch (err) {
            console.error("❌ Audio mixing failed:", err);
            // Fallback: create stream with tab audio + mic as separate tracks
            const fallbackStream = new MediaStream();
            
            // Add video from tab
            if (tabStream.getVideoTracks().length > 0) {
                fallbackStream.addTrack(tabStream.getVideoTracks()[0]);
            }
            
            // Add tab audio
            if (tabStream.getAudioTracks().length > 0) {
                fallbackStream.addTrack(tabStream.getAudioTracks()[0]);
            }
            
            // Add mic audio
            if (micStream.getAudioTracks().length > 0) {
                fallbackStream.addTrack(micStream.getAudioTracks()[0]);
            }
            
            resolve(fallbackStream);
        }
    });
}

function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
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
    console.log("🛑 Stopping recording...");
    
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        safeSetStatus("🟡 Stopping recording...");
        
        try {
            mediaRecorder.stop();
        } catch (err) {
            console.error("❌ Error stopping recorder:", err);
        }
        
        isRecording = false;
        
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        
        chrome.storage.local.remove(['isRecording', 'recordingTime']);
        notifyContentScriptRecordingStopped();
        chrome.runtime.sendMessage({ action: "recordingStopped" });
        
        // Clean up audio context
        if (audioContext) {
            audioContext.close().catch(console.error);
            audioContext = null;
        }
    }
}

function saveRecording() {
    if (recordedChunks.length === 0) {
        console.error("❌ No recorded data");
        safeSetStatus("❌ No recording data to save");
        return;
    }
    
    console.log(`💾 Saving recording with ${recordedChunks.length} chunks`);
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${currentService}_recording_${timestamp}.webm`;
    
    console.log(`📁 Saving file: ${filename}, size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    
    chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true  // Let user choose save location
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("❌ Download failed:", chrome.runtime.lastError);
            safeSetStatus("❌ Download failed: " + chrome.runtime.lastError.message);
        } else {
            console.log("✅ Recording saved as:", filename);
            safeSetStatus("✅ Recording saved! Check your Downloads folder");
            
            chrome.runtime.sendMessage({ 
                action: "recordingCompleted",
                filename: filename
            });
            
            setTimeout(() => {
                window.close();
            }, 2000);
        }
        
        URL.revokeObjectURL(url);
        recordedChunks = [];
    });
}

function cleanup() {
    // Stop all tracks in the media stream
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
        });
        mediaStream = null;
    }
    
    // Stop tab stream
    if (tabStream) {
        tabStream.getTracks().forEach(track => track.stop());
        tabStream = null;
    }
    
    // Stop microphone stream
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }
    
    // Close audio context
    if (audioContext) {
        audioContext.close().catch(console.error);
        audioContext = null;
    }
    
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeSetStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
    console.log("📊 Status:", message);
    
    if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
            action: "showMeetStatus",
            message: message,
            duration: 3000
        }).catch(() => {});
    }
}

function notifyContentScriptRecordingStarted() {
    if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
            action: "manualRecordingStarted"
        }).catch(() => {});
    }
}

function notifyContentScriptRecordingStopped() {
    if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
            action: "manualRecordingStopped"
        }).catch(() => {});
    }
}

function notifyContentScriptRecordingFailed(error) {
    if (currentTabId) {
        chrome.tabs.sendMessage(currentTabId, {
            action: "showMeetStatus",
            message: "❌ Recording failed: " + error,
            duration: 5000
        }).catch(() => {});
    }
}

window.addEventListener('beforeunload', () => {
    if (isRecording) {
        cleanup();
    }
});