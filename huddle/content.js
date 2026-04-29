// content.js - Fixed Meeting Recorder with Auto-Download on Leave (Updated for MV3)
(function() {
    'use strict';

    const currentUrl = window.location.href;
    const isInIframe = window !== window.top;
    
    // Check if we're in the Huddle iframe or parent page
    const isHuddleIframe = currentUrl.includes('meet.google.com/_/frame') || 
                          (currentUrl.includes('meet.google.com') && isInIframe);
    
    console.log("🔍 Content script location:", {
        url: currentUrl,
        isIframe: isInIframe,
        isHuddleIframe: isHuddleIframe
    });
    
    // ============================================================
    // WE ARE IN THE HUDDLE IFRAME - RUN THE RECORDER DIRECTLY
    // ============================================================
    if (isHuddleIframe) {
        console.log("🎯 INSIDE HUDDLE IFRAME - Starting recorder directly");
        initDirectHuddleRecorder();
    }
    // ============================================================
    // WE ARE IN PARENT PAGE - JUST MONITOR FOR IFRAME
    // ============================================================
    else if (currentUrl.includes('chat.google.com') || currentUrl.includes('mail.google.com')) {
        console.log("📧 Google Chat parent page - monitoring for huddle iframe");
        monitorForHuddleIframe();
    }
    // ============================================================
    // STANDALONE GOOGLE MEET
    // ============================================================
    else if (currentUrl.includes('meet.google.com')) {
        console.log("📹 Standalone Google Meet - Starting recorder");
        initDirectMeetRecorder();
    }

    // ============================================================
    // RELIABLE DOWNLOAD FUNCTION - Works with MV3 service workers
    // ============================================================
    async function downloadRecordingReliably(recordedChunks, customFilename = null) {
        if (!recordedChunks || recordedChunks.length === 0) {
            console.error("❌ No recorded chunks to download");
            return false;
        }
        
        // Calculate file size for logging
        const totalSize = recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0);
        const fileSizeMB = (totalSize / 1024 / 1024).toFixed(2);
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = customFilename || `huddle_recording_${timestamp}.webm`;
        
        console.log(`💾 Preparing download: ${filename} (${fileSizeMB} MB)`);
        console.log(`📊 Chunks: ${recordedChunks.length}, Total size: ${totalSize} bytes`);
        
        // Create blob from recorded chunks
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        
        // Convert blob to array buffer for sending to background
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Send to background for download
        try {
            // Method 1: Send blob data to background
            const response = await chrome.runtime.sendMessage({
                action: "downloadBlob",
                data: Array.from(uint8Array), // Convert to regular array for messaging
                mimeType: 'video/webm',
                filename: filename
            });
            
            if (response && response.success) {
                console.log(`✅ Download started via background: ${filename}`);
            } else {
                console.warn("Background download failed, using fallback");
                // Fallback to anchor tag download
                useAnchorDownload(blob, filename);
            }
        } catch (err) {
            console.warn("Could not send to background, using fallback:", err);
            // Fallback to anchor tag download
            useAnchorDownload(blob, filename);
        }
        
        // Also notify background for popup UI updates
        try {
            chrome.runtime.sendMessage({ 
                action: "recordingCompleted", 
                filename: filename,
                size: fileSizeMB 
            });
        } catch(e) {
            console.log("Background notification skipped (non-critical)");
        }
        
        return true;
    }
    
    // Anchor tag download fallback (works in content scripts)
    function useAnchorDownload(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.position = 'fixed';
        a.style.top = '-100px';
        a.style.left = '-100px';
        document.body.appendChild(a);
        
        setTimeout(() => {
            a.click();
            console.log(`✅ Anchor download triggered: ${filename}`);
            
            setTimeout(() => {
                if (a.parentNode) document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 1000);
        }, 100);
    }

    // ============================================================
    // DIRECT HUDDLE RECORDER - With Auto-Download on Leave
    // ============================================================
    function initDirectHuddleRecorder() {
        console.log("🔴 INITIALIZING DIRECT HUDDLE RECORDER");
        
        let mediaRecorder = null;
        let recordedChunks = [];
        let isRecording = false;
        let timerInterval = null;
        let statusDiv = null;
        let audioContext = null;
        let micGainNode = null;
        let muteCheckInterval = null;
        let currentService = 'gchat';
        let screenStreamRef = null;
        let hasAutoSaved = false;  // Prevent multiple saves
        let pageHideHandler = null;
        let visibilityHandler = null;
        
        // Create status indicator
        function showStatus(msg, isError = false, duration = 0) {
            // Remove existing status div if it exists but might be detached
            if (statusDiv && !document.body.contains(statusDiv)) {
                statusDiv = null;
            }
            
            if (!statusDiv) {
                statusDiv = document.createElement('div');
                statusDiv.id = 'huddle-recorder-status';
                statusDiv.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: #1a1a2e;
                    color: #fff;
                    padding: 12px 18px;
                    border-radius: 12px;
                    font-family: 'Google Sans', monospace;
                    font-size: 14px;
                    font-weight: bold;
                    z-index: 9999999 !important;
                    border-left: 4px solid ${isError ? '#ff4444' : '#4CAF50'};
                    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
                    backdrop-filter: blur(8px);
                    pointer-events: none;
                    max-width: 350px;
                    white-space: pre-line;
                `;
                try {
                    document.body.appendChild(statusDiv);
                } catch(e) {
                    console.warn("Could not add status div:", e);
                    return;
                }
            }
            statusDiv.textContent = msg;
            statusDiv.style.borderLeftColor = isError ? '#ff4444' : '#4CAF50';
            
            if (duration > 0 && !msg.includes('RECORDING')) {
                setTimeout(() => {
                    if (statusDiv && statusDiv.parentNode && !isRecording) {
                        statusDiv.remove();
                        statusDiv = null;
                    }
                }, duration);
            }
        }
        
        // CRITICAL: Force save immediately when leaving
        async function forceSaveAndStop(reason) {
            if (!isRecording) {
                console.log("Not recording, skipping save");
                return false;
            }
            if (hasAutoSaved) {
                console.log("Already auto-saved, skipping duplicate");
                return false;
            }
            
            console.log(`🛑 ${reason} - IMMEDIATELY saving recording to Downloads...`);
            hasAutoSaved = true;
            
            // Show status before save (if DOM still accessible)
            try {
                showStatus(`🎬 ${reason} - Saving recording to Downloads...`, false);
            } catch(e) {
                console.log("Could not update status (page may be unloading)");
            }
            
            // Stop timer
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            
            // Stop mute monitoring
            if (muteCheckInterval) {
                clearInterval(muteCheckInterval);
                muteCheckInterval = null;
            }
            
            // IMMEDIATELY save the recording - CRITICAL
            const chunksToSave = [...recordedChunks];
            
            if (chunksToSave.length > 0) {
                // Save immediately using the reliable function
                await downloadRecordingReliably(chunksToSave);
                console.log(`✅ Recording saved with ${chunksToSave.length} chunks`);
            } else {
                console.warn("⚠️ No chunks to save - recording may be empty");
                try {
                    showStatus("⚠️ No recording data to save", true, 3000);
                } catch(e) {}
            }
            
            // Stop media recorder if still active
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try {
                    mediaRecorder.onstop = null; // Prevent duplicate save
                    mediaRecorder.stop();
                } catch(e) {
                    console.error("Error stopping mediaRecorder:", e);
                }
            }
            
            // Clean up streams
            if (screenStreamRef) {
                try {
                    screenStreamRef.getTracks().forEach(t => t.stop());
                } catch(e) {}
                screenStreamRef = null;
            }
            
            // Close audio context
            if (audioContext) {
                try {
                    await audioContext.close();
                } catch(e) {}
                audioContext = null;
            }
            
            isRecording = false;
            
            // Notify background
            try {
                chrome.runtime.sendMessage({ action: "recordingStopped" });
                chrome.storage.local.remove(['isRecording', 'recordingTime']);
            } catch(e) {}
            
            return true;
        }
        
        // Stop recording (manual)
        function stopRecording() {
            if (!isRecording) {
                console.log("No active recording to stop");
                return false;
            }
            return forceSaveAndStop("Recording stopped manually");
        }
        
        // Start timer display
        function startTimer() {
            let seconds = 0;
            if (timerInterval) clearInterval(timerInterval);
            
            timerInterval = setInterval(() => {
                if (!isRecording) return;
                seconds++;
                const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
                const secs = String(seconds % 60).padStart(2, '0');
                const timeStr = `${mins}:${secs}`;
                try {
                    showStatus(`🔴 RECORDING HUDDLE... ${timeStr}`);
                    chrome.storage.local.set({ recordingTime: timeStr });
                } catch(e) {}
            }, 1000);
        }
        
        // CRITICAL: Multiple methods to detect when user leaves the call
        
        // Method 1: Listen for leave button click (most reliable for user-initiated leave)
        function setupLeaveButtonDetection() {
            console.log("🔍 Setting up Leave Call button detection");
            
            // Direct click listener on document
            document.addEventListener('click', (e) => {
                if (!isRecording || hasAutoSaved) return;
                
                // Check if clicked element is leave button or contains it
                const leaveButton = e.target.closest(
                    'button[jsname="CQylAd"], ' +
                    '[aria-label="Leave call"], ' +
                    '[aria-label="Exit call"], ' +
                    'button[aria-label*="leave" i], ' +
                    '[data-tooltip="Leave call"], ' +
                    'button[jsname="CuS0Bf"]'
                );
                
                if (leaveButton) {
                    console.log("🚪 Leave call button clicked - will auto-save recording IMMEDIATELY");
                    
                    // Prevent default to give us time to save
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Save IMMEDIATELY
                    forceSaveAndStop("Left the call").then(() => {
                        // After save, allow the leave to proceed
                        setTimeout(() => {
                            try {
                                // Remove event listeners temporarily to avoid loop
                                leaveButton.removeEventListener('click', () => {});
                                leaveButton.click();
                            } catch(e) {
                                console.log("Could not re-trigger click");
                            }
                        }, 100);
                    });
                }
            }, true); // Use capture phase to catch it early
            
            // Also watch for DOM changes to detect when leave button is removed
            const observer = new MutationObserver((mutations) => {
                if (!isRecording || hasAutoSaved) return;
                
                for (const mutation of mutations) {
                    // Check if any leave button was removed (clicked and removed from DOM)
                    if (mutation.removedNodes.length) {
                        for (const node of mutation.removedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const isLeaveButton = node.matches && (
                                    node.matches('button[jsname="CQylAd"]') ||
                                    node.matches('[aria-label="Leave call"]') ||
                                    node.matches('[aria-label="Exit call"]')
                                );
                                if (isLeaveButton) {
                                    console.log("🚪 Leave button removed from DOM - saving recording");
                                    forceSaveAndStop("Left the call");
                                }
                            }
                        }
                    }
                    
                    // Check if any video elements were removed (call ended)
                    if (mutation.removedNodes.length) {
                        for (const node of mutation.removedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) {
                                const videos = node.querySelectorAll('video');
                                if (videos.length > 0) {
                                    console.log("🎥 Video elements removed - call likely ended");
                                    forceSaveAndStop("Call ended");
                                }
                            }
                        }
                    }
                }
            });
            
            observer.observe(document.body, { 
                childList: true, 
                subtree: true,
                attributes: true,
                attributeFilter: ['disabled', 'class', 'aria-label']
            });
            
            window.__leaveDetectionCleanup = () => {
                observer.disconnect();
            };
        }
        
        // Method 2: Page visibility change (tab switching or closing)
        function setupVisibilityDetection() {
            visibilityHandler = () => {
                if (!isRecording || hasAutoSaved) return;
                
                if (document.hidden) {
                    console.log("👁️ Page became hidden - might be leaving call");
                    // Don't save immediately on hide, just log
                }
            };
            document.addEventListener('visibilitychange', visibilityHandler);
        }
        
        // Method 3: Page/tab closing (beforeunload)
        function setupBeforeUnloadHandler() {
            const beforeUnloadHandler = (e) => {
                if (isRecording && !hasAutoSaved && recordedChunks.length > 0) {
                    console.log("🚪 Page/tab closing - FORCE saving recording");
                    
                    // For beforeunload, save synchronously using anchor tag
                    const blob = new Blob(recordedChunks, { type: 'video/webm' });
                    const blobUrl = URL.createObjectURL(blob);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const filename = `huddle_recording_${timestamp}.webm`;
                    
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    a.click();
                    
                    console.log("✅ Triggered download on page close");
                    
                    setTimeout(() => {
                        URL.revokeObjectURL(blobUrl);
                    }, 100);
                }
            };
            window.addEventListener('beforeunload', beforeUnloadHandler);
            return beforeUnloadHandler;
        }
        
        // Check if still in meeting
        function isInMeeting() {
            const selectors = [
                'button[jsname="CQylAd"]',
                '[aria-label="Leave call"]',
                '[aria-label="Exit call"]',
                'button[aria-label*="leave" i]',
                'button[aria-label*="Leave" i]',
                '[data-tooltip="Leave call"]',
                '[aria-label="Hang up"]',
                'button[jsname="CuS0Bf"]',
                '[aria-label*="huddle" i]',
                '.huddle-window',
                '[data-huddle-id]',
                'video[autoplay]'
            ];
            
            for (const selector of selectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                        if (el && el.offsetParent !== null) {
                            return true;
                        }
                    }
                } catch (e) {}
            }
            
            try {
                const videos = document.querySelectorAll('video');
                for (const video of videos) {
                    if (video.offsetParent !== null && video.videoWidth > 0) {
                        return true;
                    }
                }
            } catch(e) {}
            
            return false;
        }
        
        // Detect if microphone is muted
        function isMicMuted() {
            const muteBtn = document.querySelector(
                'button[jsname="hw0c9"], button[aria-label*="microphone" i], button[aria-label*="Microphone" i]'
            );
            if (muteBtn) {
                const ariaLabel = muteBtn.getAttribute('aria-label') || '';
                return ariaLabel.includes('Turn on') || ariaLabel.includes('Unmute') || ariaLabel.includes('mic off');
            }
            return false;
        }
        
        // Start recording
        async function startRecording(isAuto = false) {
            if (isRecording) {
                showStatus('Already recording!', true, 2000);
                return false;
            }
            
            if (!isInMeeting()) {
                showStatus('❌ Not in a huddle! Join first', true, 3000);
                return false;
            }
            
            // Reset auto-save flag
            hasAutoSaved = false;
            
            showStatus('🎤 Opening picker - CHECK "Share audio"', false, 3000);
            
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { 
                        cursor: 'always', 
                        displaySurface: 'browser',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    },
                    audio: { 
                        echoCancellation: false, 
                        noiseSuppression: false, 
                        sampleRate: 48000,
                        channelCount: 2
                    },
                    systemAudio: 'include',
                    preferCurrentTab: true
                });
                
                screenStreamRef = screenStream;
                
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const destination = audioContext.createMediaStreamDestination();
                
                const tabAudioTracks = screenStream.getAudioTracks();
                let finalStream = screenStream;
                
                if (tabAudioTracks.length > 0) {
                    const tabAudio = audioContext.createMediaStreamSource(
                        new MediaStream(tabAudioTracks)
                    );
                    tabAudio.connect(destination);
                    
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({
                            audio: { 
                                echoCancellation: true, 
                                noiseSuppression: true,
                                sampleRate: 48000
                            },
                            video: false
                        });
                        
                        const micSource = audioContext.createMediaStreamSource(micStream);
                        micGainNode = audioContext.createGain();
                        micGainNode.gain.value = 0;
                        
                        micSource.connect(micGainNode);
                        micGainNode.connect(destination);
                        
                        finalStream = new MediaStream([
                            screenStream.getVideoTracks()[0],
                            ...destination.stream.getAudioTracks()
                        ]);
                        
                        muteCheckInterval = setInterval(() => {
                            if (!isRecording || !micGainNode) return;
                            const muted = isMicMuted();
                            micGainNode.gain.value = muted ? 0 : 1.0;
                        }, 300);
                        
                        console.log("✅ Microphone added with mute detection");
                        
                    } catch (micError) {
                        console.warn("Microphone not available:", micError);
                        showStatus("🎤 Meeting audio only (mic unavailable)", false, 3000);
                    }
                    
                    await audioContext.resume();
                } else {
                    showStatus("⚠️ No audio track - check 'Share audio'", true, 3000);
                }
                
                recordedChunks = [];
                
                const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') 
                    ? 'video/webm;codecs=vp9,opus' 
                    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
                        ? 'video/webm;codecs=vp8,opus'
                        : 'video/webm';
                
                mediaRecorder = new MediaRecorder(finalStream, {
                    mimeType: mimeType,
                    videoBitsPerSecond: 2500000,
                    audioBitsPerSecond: 256000
                });
                
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) {
                        recordedChunks.push(e.data);
                        console.log(`📊 Recorded chunk: ${(e.data.size / 1024).toFixed(1)} KB, Total chunks: ${recordedChunks.length}`);
                    }
                };
                
                mediaRecorder.onstop = () => {
                    console.log(`📼 MediaRecorder stopped. Chunks: ${recordedChunks.length}`);
                    // Only download if not already saved by forceSaveAndStop
                    if (!hasAutoSaved && recordedChunks.length > 0) {
                        downloadRecordingReliably(recordedChunks);
                    }
                    isRecording = false;
                };
                
                mediaRecorder.onerror = (e) => {
                    console.error("Recorder error:", e);
                    showStatus("Recording error occurred", true, 3000);
                };
                
                mediaRecorder.start(1000);
                isRecording = true;
                startTimer();
                
                // Setup ALL leave detection methods (CRITICAL for auto-download)
                setupLeaveButtonDetection();
                setupVisibilityDetection();
                const beforeUnloadHandler = setupBeforeUnloadHandler();
                
                try {
                    await chrome.storage.local.set({ isRecording: true });
                    chrome.runtime.sendMessage({ action: "recordingStarted", isAuto: isAuto });
                } catch(e) {}
                
                console.log("✅ Recording started successfully - will auto-save when you leave the call");
                showStatus(`🔴 RECORDING HUDDLE... 00:00 - Will auto-save when you leave`);
                
                if (screenStream.getVideoTracks()[0]) {
                    screenStream.getVideoTracks()[0].onended = () => {
                        if (isRecording && !hasAutoSaved) {
                            console.log("Screen sharing stopped - ending recording");
                            forceSaveAndStop("Screen sharing stopped");
                        }
                    };
                }
                
                return true;
                
            } catch (error) {
                console.error("Start recording error:", error);
                showStatus(`❌ ${error.message}`, true, 4000);
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    try { mediaRecorder.stop(); } catch(e) {}
                }
                try {
                    chrome.runtime.sendMessage({ action: "recorderFailed", error: error.message });
                } catch(e) {}
                return false;
            }
        }
        
        // Load auto-record setting
        async function loadAutoRecordSetting() {
            try {
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                const autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
                
                if (autoRecordEnabled && isInMeeting()) {
                    console.log("🎬 Auto-record enabled - starting recording");
                    setTimeout(() => startRecording(true), 1500);
                }
            } catch(e) {}
        }
        
        // Listen for messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("📨 Content script received:", message.action);
            
            switch (message.action) {
                case "startRecording":
                    startRecording(message.isAuto || false).then(success => {
                        sendResponse({ success: success });
                    });
                    return true;
                    
                case "stopRecording":
                    stopRecording();
                    sendResponse({ success: true });
                    break;
                    
                case "manualRecordingStarted":
                    startRecording(false).then(success => {
                        sendResponse({ success: success });
                    });
                    return true;
                    
                case "manualRecordingStopped":
                    stopRecording();
                    sendResponse({ success: true });
                    break;
                    
                case "getRecordingStatus":
                    sendResponse({ 
                        isRecording: isRecording,
                        time: timerInterval ? "recording" : "00:00"
                    });
                    break;
                    
                case "ping":
                    sendResponse({ success: true, alive: true });
                    break;
            }
            return true;
        });
        
        // Initialize
        console.log("🔥 Huddle Recorder Ready - Auto-save to Downloads when you leave call!");
        showStatus("📹 Huddle Recorder Ready\nRecording will auto-save to Downloads when you leave", false, 5000);
        
        setTimeout(() => {
            if (isInMeeting()) {
                console.log("📞 Currently in a huddle! Checking auto-record setting...");
                loadAutoRecordSetting();
            } else {
                console.log("📞 Not in a huddle. Join a huddle to start recording.");
            }
        }, 1000);
        
        window.recordHuddle = () => startRecording(false);
        window.stopHuddle = () => stopRecording();
        window.checkMeeting = () => console.log("In meeting:", isInMeeting());
    }
    
    // ============================================================
    // DIRECT STANDALONE GOOGLE MEET RECORDER
    // ============================================================
    function initDirectMeetRecorder() {
        console.log("🔴 INITIALIZING DIRECT MEET RECORDER");
        
        let mediaRecorder = null;
        let recordedChunks = [];
        let isRecording = false;
        let timerInterval = null;
        let statusDiv = null;
        let audioContext = null;
        let screenStreamRef = null;
        let hasAutoSaved = false;
        
        function showStatus(msg, isError = false, duration = 0) {
            if (!statusDiv || !document.body.contains(statusDiv)) {
                statusDiv = document.createElement('div');
                statusDiv.id = 'meet-recorder-status';
                statusDiv.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: #1a1a2e;
                    color: #fff;
                    padding: 12px 18px;
                    border-radius: 12px;
                    font-family: monospace;
                    font-size: 14px;
                    z-index: 999999;
                    border-left: 4px solid ${isError ? '#ff4444' : '#4CAF50'};
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                    pointer-events: none;
                    font-weight: bold;
                `;
                document.body.appendChild(statusDiv);
            }
            statusDiv.textContent = msg;
            if (duration > 0 && !msg.includes('RECORDING')) {
                setTimeout(() => {
                    if (statusDiv && statusDiv.parentNode && !isRecording) {
                        statusDiv.remove();
                        statusDiv = null;
                    }
                }, duration);
            }
        }
        
        async function forceSaveAndStop(reason) {
            if (!isRecording || hasAutoSaved) return;
            hasAutoSaved = true;
            console.log(`🛑 ${reason} - Saving to Downloads`);
            
            if (timerInterval) clearInterval(timerInterval);
            
            const chunksToSave = [...recordedChunks];
            
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try {
                    mediaRecorder.onstop = null;
                    mediaRecorder.stop();
                } catch(e) {}
            }
            
            if (chunksToSave.length > 0) {
                await downloadRecordingReliably(chunksToSave);
            }
            
            if (screenStreamRef) {
                screenStreamRef.getTracks().forEach(t => t.stop());
                screenStreamRef = null;
            }
            if (audioContext) await audioContext.close();
            
            isRecording = false;
        }
        
        function isInMeet() {
            return !!document.querySelector('button[jsname="CQylAd"], [aria-label="Leave call"]');
        }
        
        function setupLeaveDetection() {
            document.addEventListener('click', (e) => {
                const leaveButton = e.target.closest('button[jsname="CQylAd"], [aria-label="Leave call"]');
                if (leaveButton && isRecording && !hasAutoSaved) {
                    console.log("🚪 Leave button clicked - auto-saving");
                    forceSaveAndStop("Left the call");
                }
            });
            
            window.addEventListener('beforeunload', () => {
                if (isRecording && !hasAutoSaved && recordedChunks.length > 0) {
                    const blob = new Blob(recordedChunks, { type: 'video/webm' });
                    const blobUrl = URL.createObjectURL(blob);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const filename = `meet_recording_${timestamp}.webm`;
                    
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    a.click();
                    
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                }
            });
        }
        
        async function startRecording() {
            if (isRecording) return;
            if (!isInMeet()) {
                showStatus("Not in a meeting", true, 3000);
                return;
            }
            
            hasAutoSaved = false;
            
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                    audio: { echoCancellation: false, noiseSuppression: false },
                    systemAudio: 'include',
                    preferCurrentTab: true
                });
                
                screenStreamRef = screenStream;
                
                audioContext = new AudioContext();
                const destination = audioContext.createMediaStreamDestination();
                const tabAudio = audioContext.createMediaStreamSource(
                    new MediaStream(screenStream.getAudioTracks())
                );
                tabAudio.connect(destination);
                
                const finalStream = new MediaStream([
                    screenStream.getVideoTracks()[0],
                    ...destination.stream.getAudioTracks()
                ]);
                
                recordedChunks = [];
                
                const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') 
                    ? 'video/webm;codecs=vp9,opus' : 'video/webm';
                
                mediaRecorder = new MediaRecorder(finalStream, {
                    mimeType: mimeType,
                    videoBitsPerSecond: 2500000
                });
                
                mediaRecorder.ondataavailable = e => {
                    if (e.data && e.data.size) recordedChunks.push(e.data);
                };
                
                mediaRecorder.onstop = () => {
                    if (!hasAutoSaved && recordedChunks.length > 0) {
                        downloadRecordingReliably(recordedChunks);
                    }
                };
                
                mediaRecorder.start(1000);
                isRecording = true;
                
                let seconds = 0;
                timerInterval = setInterval(() => {
                    if (!isRecording) return;
                    seconds++;
                    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
                    const secs = String(seconds % 60).padStart(2, '0');
                    showStatus(`🔴 RECORDING MEET... ${mins}:${secs}`);
                }, 1000);
                
                setupLeaveDetection();
                
                showStatus("🔴 RECORDING - will auto-save when you leave");
                await chrome.storage.local.set({ isRecording: true });
                
                screenStream.getVideoTracks()[0].onended = () => {
                    if (isRecording && !hasAutoSaved) forceSaveAndStop("Screen share ended");
                };
                
            } catch (err) {
                showStatus(`❌ ${err.message}`, true, 3000);
            }
        }
        
        function stopRecording() {
            if (!isRecording) return;
            forceSaveAndStop("Manual stop");
        }
        
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.action === "manualRecordingStarted") startRecording();
            if (msg.action === "manualRecordingStopped") stopRecording();
            sendResponse({ success: true });
            return true;
        });
        
        showStatus("Meet Recorder Ready - Auto-saves when you leave");
        window.recordMeeting = startRecording;
        window.stopMeeting = stopRecording;
    }
    
    // ============================================================
    // MONITOR FOR HUDDLE IFRAME FROM PARENT PAGE
    // ============================================================
    function monitorForHuddleIframe() {
        console.log("👀 Monitoring for huddle iframe");
        
        let lastIframeStatus = false;
        
        function checkForIframe() {
            const iframes = document.querySelectorAll('iframe[src*="meet.google.com/_/frame"]');
            let iframeFound = false;
            
            for (const iframe of iframes) {
                const rect = iframe.getBoundingClientRect();
                const isVisible = iframe.offsetParent !== null && rect.width > 0;
                if (isVisible) {
                    iframeFound = true;
                    if (!iframe.dataset.recorderNotified) {
                        iframe.dataset.recorderNotified = "true";
                        console.log("🎯 Huddle iframe detected - recorder active inside");
                    }
                }
            }
            
            if (lastIframeStatus && !iframeFound) {
                console.log("📞 Huddle iframe disappeared - meeting likely ended");
            }
            
            lastIframeStatus = iframeFound;
        }
        
        const observer = new MutationObserver(() => checkForIframe());
        observer.observe(document.body, { childList: true, subtree: true });
        checkForIframe();
        setInterval(checkForIframe, 2000);
        
        setTimeout(() => {
            const hint = document.createElement('div');
            hint.textContent = "🎬 Huddle Recorder Ready! Recording auto-saves when you leave the call.";
            hint.style.cssText = `position:fixed;bottom:20px;right:20px;background:#1a73e8;color:#fff;padding:8px 14px;border-radius:20px;font-size:12px;z-index:100000;`;
            document.body.appendChild(hint);
            setTimeout(() => hint.remove(), 5000);
        }, 1000);
    }
    
    console.log("✅ Content script loaded - Auto-download when you leave the call");
})();