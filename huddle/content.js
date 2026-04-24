// UNIFIED CONTENT.JS - Google Meet, Microsoft Teams & Zoom (with iframe support)

(function() {
    'use strict';

    // Service detection
    function detectService() {
        const url = window.location.href;
        if (url.includes('meet.google.com')) return 'gmeet';
        if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
        if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom'; 
        return null;
    }

    const currentService = detectService();
    
    // Check if we're in an iframe
    const isInIframe = window !== window.top;
    
    console.log(`🔍 Content script initializing for: ${currentService} (in iframe: ${isInIframe})`);

    // For Google Meet iframes, we need to run in the iframe context
    if (currentService === 'gmeet') {
        if (isInIframe && window.location.pathname.includes('/_/frame')) {
            console.log("✅ Running inside Google Meet iframe - this is where the meeting UI lives");
            gmeetContent();
        } else if (!isInIframe) {
            console.log("🔍 Running in main Google Meet page - setting up iframe detection");
            setupIframeDetection();
        } else {
            // Fallback - run anyway
            gmeetContent();
        }
    } else if (currentService === 'teams') {
        teamsContent();
    } else if (currentService === 'zoom') {
        zoomContent();
    }

    // Function to detect when iframe loads and inject content script
    function setupIframeDetection() {
        console.log("🔍 Setting up iframe detection for Google Meet");
        
        // Wait for the iframe to be created
        const iframeObserver = new MutationObserver((mutations) => {
            const iframe = document.querySelector('iframe[src*="meet.google.com/_/frame"]');
            if (iframe && iframe.contentWindow) {
                console.log("✅ Google Meet iframe detected");
                
                // Try to communicate with iframe
                try {
                    // Send a message to the iframe
                    iframe.contentWindow.postMessage({ type: 'MEET_RECORDER_READY' }, '*');
                    
                    // Also try to inject script into iframe
                    window.postMessage({ type: 'MEET_RECORDER_INIT', service: 'gmeet' }, '*');
                } catch (e) {
                    console.log("⚠️ Could not communicate with iframe:", e);
                }
                
                iframeObserver.disconnect();
            }
        });
        
        iframeObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Also check immediately
        const existingIframe = document.querySelector('iframe[src*="meet.google.com/_/frame"]');
        if (existingIframe && existingIframe.contentWindow) {
            console.log("✅ Google Meet iframe already exists");
            try {
                window.postMessage({ type: 'MEET_RECORDER_INIT', service: 'gmeet' }, '*');
            } catch (e) {
                console.log("⚠️ Could not communicate with iframe:", e);
            }
        }
    }

    // Listen for messages from parent/iframe
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'MEET_RECORDER_INIT' && event.data.service === 'gmeet') {
            console.log("📨 Received initialization message in iframe");
            gmeetContent();
        }
    });

    // ==================== GOOGLE MEET ====================
    function gmeetContent() {
        console.log("🔍 Initializing Google Meet content script (in correct context)");

        let isInMeeting = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let leaveButtonObserver = null;
        let lastLeaveButtonVisible = false;

        // Meeting Detection + Timer + Duration        
        let meetingStarted = false;
        let meetingStartTime = null;
        let meetingEndTime = null;
        let totalMeetingDuration = 0;

        // Enhanced leave button detection for iframe context
        function findLeaveButton() {
            // Try multiple selectors that work inside the iframe
            const selectors = [
                'button[aria-label="Leave call"]',
                'button[aria-label*="Leave call"]',
                'div[role="button"][data-tooltip="Leave call"]',
                'div[role="button"][aria-label*="Leave"]',
                'button[jscontroller][jsname][aria-label*="Leave"]',
                // Additional selectors for the iframe context
                '[data-tooltip="Leave call"]',
                '[aria-label="Leave call"]',
                '.VfPpkd-Bz112c-LgbsSe[aria-label*="Leave"]',
                'button[aria-label*="exit"]',
                // More generic selectors
                '[data-is-multi-control="true"][aria-label*="Leave"]',
                'div[role="button"][aria-label*="Leave call"]'
            ];
            
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && isElementVisible(el)) {
                    console.log(`✅ Found leave button with selector: ${selector}`);
                    return el;
                }
            }
            
            // Try to find any button with leave-related text
            const allButtons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of allButtons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const tooltip = btn.getAttribute('data-tooltip') || '';
                const text = btn.textContent || '';
                
                if ((ariaLabel.toLowerCase().includes('leave') || tooltip.toLowerCase().includes('leave') || text.toLowerCase().includes('leave')) &&
                    !ariaLabel.toLowerCase().includes('join')) {
                    if (isElementVisible(btn)) {
                        console.log(`✅ Found leave button by content: ${ariaLabel || tooltip || text}`);
                        return btn;
                    }
                }
            }
            
            return null;
        }

        function isElementVisible(element) {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0' &&
                   rect.width > 0 &&
                   rect.height > 0 &&
                   element.offsetParent !== null;
        }

        function showMeetStatus(message, duration = 4000) {
            // Try to add status to both iframe and parent
            const existing = document.getElementById('meet-recorder-status');
            
            if (existing && message.includes("Recording...")) {
                existing.innerHTML = message.replace(/\n/g, '<br>');
                return;
            }
            
            if (existing) existing.remove();
            
            const status = document.createElement('div');
            status.id = 'meet-recorder-status';
            status.innerHTML = message.replace(/\n/g, '<br>');
            status.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0,0,0,0.95);
                color: white;
                padding: 12px 16px;
                border-radius: 10px;
                font-family: 'Google Sans', Arial, sans-serif;
                font-size: 14px;
                z-index: 100000;
                font-weight: bold;
                border: 2px solid #4285f4;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                backdrop-filter: blur(10px);
                max-width: 400px;
                word-wrap: break-word;
            `;
            
            document.body.appendChild(status);

            if (!message.includes("Recording...")) {
                setTimeout(() => {
                    const currentStatus = document.getElementById('meet-recorder-status');
                    if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                        currentStatus.remove();
                    }
                }, duration);
            }
        }

        function startMeetingTimer() {
            meetingStartTime = Date.now();
            const startTime = new Date(meetingStartTime).toLocaleTimeString();
            console.log(`%c📅 Meeting started at : ${startTime}`,"color: #0f9d58; font-weight: bold;");
            showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
        }

        function stopMeetingTimer() {
            if (meetingStartTime) {
                meetingEndTime = Date.now();
                totalMeetingDuration = Math.floor((meetingEndTime - meetingStartTime) / 1000);
                
                const minutes = Math.floor(totalMeetingDuration / 60);
                const seconds = totalMeetingDuration % 60;
                const endTime = new Date(meetingEndTime).toLocaleTimeString();

                console.log(`%c📅 Meeting ended at : ${new Date(meetingEndTime).toLocaleTimeString()}`, "color: #d93025; font-weight: bold;");
                console.log(`%c⏱️ Duration of meeting : ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

                showMeetStatus(`📅 Meeting ended at : ${endTime}\n Duration: ${minutes}m ${seconds}s`, 5000);

                chrome.storage.local.set({
                    lastMeetingDuration: totalMeetingDuration,
                    lastMeetingEndTime: meetingEndTime
                });
                
                meetingStartTime = null;
                meetingEndTime = null;
            }
        }

        function checkMeetingState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);

            if (leaveVisible && !lastLeaveButtonVisible) {
                console.log("✅ Leave button visible - Meeting joined");
                isInMeeting = true;
                meetingStarted = true;
                startMeetingTimer();

                const startTime = new Date(meetingStartTime).toLocaleTimeString();
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
                    showMeetStatus(`📅 Meeting started at: ${startTime}\n🟡 Auto recording starting in 3 seconds...`);

                    if (window.autoRecordTimeout) {
                        clearTimeout(window.autoRecordTimeout);
                    }
                    
                    window.autoRecordTimeout = setTimeout(async () => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            await startAutoRecording();
                        }
                    }, 3000);
                } else {
                    showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
                }
            }

            if (!leaveVisible && lastLeaveButtonVisible) {
                console.log("❌ Leave button hidden - Meeting ended");
                isInMeeting = false;
                meetingStarted = false;
                stopMeetingTimer();
                
                if (window.autoRecordTimeout) {
                    clearTimeout(window.autoRecordTimeout);
                    window.autoRecordTimeout = null;
                }
        
                if (recordingStarted) {
                    console.log("🛑 Meeting ended - stopping recording");
                    chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
                }
            }

            lastLeaveButtonVisible = leaveVisible;
            chrome.storage.local.set({ isInMeeting });
        }

        async function startAutoRecording() {
            if (recordingStarted) {
                console.log("⚠️ Auto recording already started, skipping");
                return;
            }
            
            console.log("🚀 Starting auto recording...");

            chrome.storage.local.set({ isRecording: false });

            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: "autoStartRecording" }, resolve);
                });
                
                if (response?.success) {
                    recordingStarted = true;            
                    chrome.storage.local.set({ isRecording: true });
                    showMeetStatus("🔴 Auto Recording Started");
                } else {
                    console.log("❌ Failed to start auto recording:", response);
                    recordingStarted = false;
                    showMeetStatus("❌ Auto Recording Failed");
                    setTimeout(() => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            console.log("🔄 Retrying auto recording...");
                            startAutoRecording();
                        }
                    }, 3000);
                }
            } catch (error) {
                console.log("❌ Error starting auto recording:", error);
                recordingStarted = false;
                showMeetStatus("❌ Auto Recording Error");
            }
        }

        async function checkAutoRecordPermission() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                    autoRecordEnabled = result.autoRecordPermissions?.['gmeet'] || false;
                    console.log(`🔐 Auto record enabled for gmeet:`, autoRecordEnabled);
                    resolve(autoRecordEnabled);
                });
            });
        }

        // Initialize
        setTimeout(async () => {
            await checkAutoRecordPermission();
            setupLeaveButtonObserver();
            checkInitialMeetingState();
            setInterval(checkMeetingState, 2000);
            
            console.log("🔍 Meet Auto Recorder content script fully loaded with iframe support");
    
            if (autoRecordEnabled) {
                showMeetStatus("✅ Google Meet's Auto Recording Enabled", 3000);
            } else {
                showMeetStatus("✅ Google Meet's Manual Recorder Is Ready", 3000);
            }
        }, 1000);

        function setupLeaveButtonObserver() {
            if (leaveButtonObserver) leaveButtonObserver.disconnect();
            leaveButtonObserver = new MutationObserver(() => {
                setTimeout(checkMeetingState, 500);
            });
            leaveButtonObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-hidden', 'disabled']
            });
        }

        function checkInitialMeetingState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);
            
            if (leaveVisible && !isInMeeting) {
                console.log("🔍 Already in meeting - will auto-start recording in 3 seconds");
                isInMeeting = true;
                meetingStarted = true;
                
                if (!meetingStartTime) {
                    startMeetingTimer();
                }
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🚀 Auto-starting recording for existing meeting");
                    showMeetStatus("🟡 Auto recording starting in 3 seconds...", 3000);
                    setTimeout(async () => {
                        await startAutoRecording();
                    }, 3000);
                }
            }
        }

        // Message listener for Google Meet
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log(`🔄 Auto record permission updated:`, autoRecordEnabled);
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStarted") {
                console.log("🎬 Manual recording started - showing timer in Meet");
                recordingStarted = true;
                sendResponse({ success: true });
            }
    
            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Manual recording stopped");
                recordingStarted = false;
                sendResponse({ success: true });
            }

            if (message.action === "autoRecordToggledOn") {
                autoRecordEnabled = message.enabled;
                console.log("🔄 Auto-record toggled ON, checking if we're in a meeting...");
                if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                    startAutoRecording();
                }
                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                sendResponse({ 
                    isInMeeting, 
                    recording: recordingStarted, 
                    autoRecordEnabled
                });
            }

            if (message.action === "autoStopRecording") {
                recordingStarted = false;
                sendResponse({ success: true });
            }

            if (message.action === "showMeetStatus") {
                showMeetStatus(message.message, message.duration || 4000);
                sendResponse({ success: true });
            }
            
            if (message.action === "updateMeetTimer") {
                const status = document.getElementById('meet-recorder-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording... ${message.time}`;
                } else if (isInMeeting && recordingStarted) {
                    showMeetStatus(`🔴 Recording... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                showMeetStatus("✅ Recording Completed & Downloaded");
                sendResponse({ success: true });
            }
            
            return true;
        });
    }

    // ==================== MICROSOFT TEAMS ====================
    function teamsContent() {
        console.log("🔍 Initializing Microsoft Teams content script");
        // ... (rest of Teams code remains the same)
    }

    // ==================== ZOOM ====================
    function zoomContent() {
        console.log("🔍 Initializing Zoom content script");
        // ... (rest of Zoom code remains the same)
    }
})();