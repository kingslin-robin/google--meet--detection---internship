// RECORDER - Media recording, Audio mixing, Timer management, Status broadcasting, Download handling

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;
let muteCheckInterval = null;
let autoRecordEnabled = false;
let globalMicStream = null; 
let globalMicGainNode = null; 
let currentTabId = null;

console.log("🎬 GMeet Recorder tab loaded");

// Safe dom helper function
function safeSetStatus(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = message;
  }
}

// Function to sync toggle state
async function syncToggleState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
      updateToggleDisplay();
      resolve(autoRecordEnabled);
    });
  });
}

// Function to update the toggle
function updateToggleDisplay() {
  const statusElement = document.getElementById("status");
  const indicatorElement = document.getElementById("autoRecordIndicator");
  
  if (indicatorElement) {
    indicatorElement.textContent = `Auto Record: ${autoRecordEnabled ? 'ON' : 'OFF'}`;
    indicatorElement.className = `auto-record-indicator ${autoRecordEnabled ? 'auto-on' : 'auto-off'}`;
  }
  
  if (statusElement) {
    if (isRecording) {
      statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
    } else {
      statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
    }
  }
}

// Tab closure detection
function setupTabClosureDetection(tabId) {
  const tabCheckInterval = setInterval(async () => {
    if (!isRecording) {
      clearInterval(tabCheckInterval);
      return;
    }
    
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.log("❌ Source tab closed - stopping recording");
        stopRecording();
        clearInterval(tabCheckInterval);
      }
    } catch (error) {
      console.log("❌ Source tab closed or inaccessible - stopping recording");
      stopRecording();
      clearInterval(tabCheckInterval);
    }
  }, 2000);
}

// To listen for toggle state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    console.log("🔄 Recorder: Toggle state updated to:", autoRecordEnabled);
    updateToggleDisplay();
  }
});

// Broadcast functions for meet tab 
function broadcastToMeetTab(message, duration = 4000){
    chrome.runtime.sendMessage({
        action: "showMeetStatus", 
        message: message,
        duration: duration
    });
}

function broadcastTimerUpdate(timeStr) {
    chrome.runtime.sendMessage({
        action: "updateMeetTimer",
        time: timeStr
    });
}

function checkRecorderInitialization() {
  // If the page doesn't have basic functionality after 5 seconds, it's failed
  setTimeout(() => {
    if (typeof mediaRecorder === 'undefined' && !isRecording) {
      console.error("❌ Recorder page failed to initialize properly");
      safeSetStatus("❌ Recorder failed - closing tab");
      
      // Notify background about failure
      chrome.runtime.sendMessage({ 
        action: "recorderFailed",
        error: "Failed to initialize",
        tabId: currentTabId
      });
      
      // Close tab after short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    }
  }, 5000);
}


// Proper async message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  const handleAsync = async () => {
    try {
      if (message.action === "startRecording") {
        isAutoRecord = message.autoRecord || false;
        currentTabId = message.tabId;
        console.log("🎬 Starting recording, auto mode:", isAutoRecord, "tabId:", currentTabId);
        await startRecording(message.tabId);
        sendResponse({ success: true });
      }
      else if (message.action === "stopRecording") {
        if (message.forceAutoDownload) {
          isAutoRecord = true;
        }
        console.log("🛑 Stopping recording");
        stopRecording();
        sendResponse({ success: true });
      }

      else if (message.action === "healthCheck") {
        console.log("❤️ Recorder health check received");
          sendResponse({ 
          status: "healthy", 
          service: "recorder",
          isRecording: isRecording,
          chunksCount: recordedChunks.length
        });
      }

      else {
        sendResponse({ success: false, reason: "unknown_action" });
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  };

  handleAsync();
  return true; 
});

// Improved recording start with activeTab permission handling
async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);
  
  // Reset state to prevent conflicts
  if (isRecording) {
    console.log("⚠️ Already recording - stopping previous session");
    stopRecording();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
  }

  await syncToggleState();

  // Double-check we're not already recording
  if (isRecording) {
    console.log("❌ Still recording from previous session - aborting");
    return;
  }

  try {
    // Different messages for auto vs manual mode
    if (isAutoRecord) {
      safeSetStatus("🟡 Auto recording starting...");
      broadcastToMeetTab("🟡 Auto recording starting...");
    } else {
      safeSetStatus("🟡 Starting recording...");
      broadcastToMeetTab("🟡 Starting recording...");
    }
    
    // Add 1 sec delay to ensure stability
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Use chrome.tabs.get to validate tab before capture
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Tab not accessible: ${chrome.runtime.lastError.message}`));
        } else if (!tab) {
          reject(new Error("Tab not found"));
        } else {
          resolve(tab);
        }
      });
    });

    console.log("✅ Source tab validated:", tab.url);

    const tabStream = await new Promise((resolve, reject) => {
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
          reject(new Error("No tab stream returned - check activeTab permission"));
        } else {
          resolve(stream);
        }
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    const audioContext = new AudioContext();
    const recordingDestination = audioContext.createMediaStreamDestination();
    
    const meetAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    const splitter = audioContext.createChannelSplitter(2);
    const recordingMerger = audioContext.createChannelMerger(2);
    const playbackMerger = audioContext.createChannelMerger(2);
    
    meetAudioSource.connect(splitter);
    
    splitter.connect(playbackMerger, 0, 0);
    splitter.connect(playbackMerger, 1, 1);
    playbackMerger.connect(audioContext.destination);
    
    splitter.connect(recordingMerger, 0, 0);
    splitter.connect(recordingMerger, 1, 1);
    
    // Get microphone audio for recording
    try {
      console.log("🎤 Requesting microphone access...");
      globalMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      console.log("✅ Microphone access granted");
      const micSource = audioContext.createMediaStreamSource(globalMicStream);
      
      globalMicGainNode = audioContext.createGain();
      micSource.connect(globalMicGainNode);
      
      globalMicGainNode.gain.value = 0; // Start muted
      globalMicGainNode.connect(recordingMerger, 0, 0);
      globalMicGainNode.connect(recordingMerger, 0, 1);
      
      console.log("✅ Microphone connected to recording (initially muted)");
      
    } catch (micError) {
      console.error("❌ Microphone access denied:", micError);
    }

    recordingMerger.connect(recordingDestination);
    
    console.log("✅ Audio setup: Meet audio → Recording + Playback, Microphone → Recording only");

    // Mute detection function
    const updateMicrophoneMute = async () => {
      try {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ isMuted: true });
            } else {
              resolve(response || { isMuted: true });
            }
          });
        });

        if (globalMicGainNode) {
          if (response.isMuted) {
            globalMicGainNode.gain.value = 0;
            console.log("🔇 Microphone muted in recording (Meet is muted)");
          } else {
            globalMicGainNode.gain.value = 1.0;
            console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
          }
        } else {
          console.log("⚠️ No mic gain node available for mute control");
        }
      } catch (error) {
        console.log("⚠️ Could not check mute status, keeping microphone muted");
        if (globalMicGainNode) globalMicGainNode.gain.value = 0;
      }
    };

    // Check mute status every 2 seconds
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    updateMicrophoneMute(); // Initial check

    // Create final recording stream: video + mixed audio
    const videoTrack = tabStream.getVideoTracks()[0];
    const mixedAudioTrack = recordingDestination.stream.getAudioTracks()[0];

    // Track closure detection
    const sourceVideoTrack = tabStream.getVideoTracks()[0];
    const sourceAudioTrack = tabStream.getAudioTracks()[0];

    if (sourceVideoTrack) {
      sourceVideoTrack.onended = () => {
        console.log("❌ Source video track ended - Meet tab closed");
        if (isRecording) {
          console.log("🎬 Recording active - stopping properly");
          stopRecording();
        }
      };
    }

    if (sourceAudioTrack) {
      sourceAudioTrack.onended = () => {
        console.log("❌ Source audio track ended - Meet tab closed");
        if (isRecording) {
          console.log("🎬 Recording active - stopping properly");
          stopRecording();
        }
      };
    }

    if (!videoTrack) {
      throw new Error("No video track available from tab capture");
    }

    if (!mixedAudioTrack) {
      throw new Error("No audio track available after mixing");
    }

    const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
    console.log("✅ Final recording stream created with dual audio paths");

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();

      // Mark recording as inactive immediately when stopped
      isRecording = false;
  
      // Broadcast stopped status for both modes
      if (isAutoRecord) {
        broadcastToMeetTab("🟡 Auto Recording Stopped");
      } else {
        broadcastToMeetTab("🟡 Recording Stopped");
      }
  
      // FIXED: Only proceed with download if we have chunks
      if (recordedChunks.length > 0) {
        downloadRecording();
      } else {
        // If no chunks, then it's a failure
        safeSetStatus("❌ No recording data");
        if (isAutoRecord) {
          broadcastToMeetTab("❌ Auto Recording Failed - No data");
        } else {
        broadcastToMeetTab("❌ Recording Failed - No data");
      }
    cleanup();
  }
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      safeSetStatus("❌ Recording error");
      cleanup();
    };

    mediaRecorder.start(1000);
    updateToggleDisplay();
    startTimer();

    setupTabClosureDetection(tabId);

    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    
    console.log("Recording is starting...");
    if (isAutoRecord) {
      broadcastToMeetTab("🔴 Auto Recording Started");
    } else {
      broadcastToMeetTab("🔴 Recording Started");
    }    

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    safeSetStatus("❌ Recording failed: " + err.message);
    broadcastToMeetTab("❌ Recording failed. \nTry clicking the Reset button in UI to restart auto-recording.");
    
    // Clean up on failure
    cleanup();
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    broadcastToMeetTab("🟡 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;
  
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
    broadcastTimerUpdate(timeStr);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    safeSetStatus("❌ No recording data");
    const message = isAutoRecord ? "❌ Auto Recording failed: No data" : "❌ Recording failed: No data";
    broadcastToMeetTab(message);
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  const stoppedMessage = isAutoRecord ? "🟡 Auto Recording Stopped" : "🟡 Recording Stopped";
  broadcastToMeetTab(stoppedMessage);

  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      console.log("✅ DOWNLOAD started with ID:", downloadId);
    }
    
    const downloadedMessage = isAutoRecord ? "✅ Auto Recording Downloaded" : "✅ Recording Downloaded";
    broadcastToMeetTab(downloadedMessage);
    
    
    // Send completion message
    chrome.runtime.sendMessage({ action: "recordingCompleted" });
    
    safeSetStatus("✅ Recording Auto-Downloaded!");

    // Mark recording as inactive to prevent beforeunload confirmation
    isRecording = false;

    console.log("🔒 Closing recorder tab in 2 seconds");
        setTimeout(() => {
            console.log("🔒 Closing recorder tab");
            window.close();
        }, 2000);
  });  
}

// Comprehensive cleanup function
function comprehensiveCleanup() {
    console.log("🧹 Comprehensive cleanup started");
    
    // Stop recording if active
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log("🛑 Stopping media recorder");
        mediaRecorder.stop();
    }
    
    // Clear all intervals
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        console.log("✅ Timer interval cleared");
    }
    
    if (muteCheckInterval) {
        clearInterval(muteCheckInterval);
        muteCheckInterval = null;
        console.log("✅ Mute check interval cleared");
    }
    
    // Stop all media tracks
    if (mediaRecorder?.stream) {
        mediaRecorder.stream.getTracks().forEach(track => {
            track.stop();
            console.log("✅ Media track stopped:", track.kind);
        });
    }
    
    if (globalMicStream) {
        globalMicStream.getTracks().forEach(track => {
            track.stop();
            console.log("✅ Microphone track stopped");
        });
        globalMicStream = null;
    }
    
    // Close audio context
    if (originalAudioContext) {
        originalAudioContext.close().catch(e => console.log("AudioContext close error:", e));
        originalAudioContext = null;
        console.log("✅ Audio context closed");
    }
    
    // Clean up global mic gain node
    if (globalMicGainNode) {
        globalMicGainNode.disconnect();
        globalMicGainNode = null;
        console.log("✅ Mic gain node cleaned");
    }
    
    // Clear recorded chunks to free memory
    recordedChunks = [];
    console.log("✅ Recorded chunks cleared");
    
    // Reset states
    isRecording = false;
    isAutoRecord = false;
    currentTabId = null;
    console.log("✅ States reset");
    
    // Clear storage
    chrome.storage.local.set({ 
        isRecording: false,
        recordingStoppedByTabClose: true 
    }, () => {
        chrome.storage.local.remove(['recordingTime', 'recordingStartTime']);
        chrome.runtime.sendMessage({ action: "recordingStopped" });
        console.log("✅ Storage cleared");
    });             
    
    console.log("✅ Comprehensive cleanup completed");
}

// Refresh extension function
function refreshExtension() {
    console.log("🔄 Refreshing extension state...");
    comprehensiveCleanup();
    
    // Notify background to reset states
    chrome.runtime.sendMessage({ 
        action: "refreshExtensionState" 
    });
    
    // Close recorder tab if in auto mode
    if (isAutoRecord) {
        setTimeout(() => {
            window.close();
        }, 2000);
    }
}

// Cleanup function
function cleanup() {
  console.log("🧹 Standard cleanup started");
  
  if (isRecording && recordedChunks.length > 0) {
    comprehensiveCleanup();
  } else {
    // Minimal cleanup for normal stop cases
    stopTimer();
    if (muteCheckInterval) {
      clearInterval(muteCheckInterval);
      muteCheckInterval = null;
    }
    
    // Reset states
    isRecording = false;
    console.log("✅ Standard cleanup completed");
  }
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer")?.textContent); 
}, 30000);


window.addEventListener('beforeunload', (event) => {
  if (isRecording && recordedChunks.length > 0) {
    // AUTO MODE: No permission prompt - just auto-download and close
    if (isAutoRecord) {
      console.log("🤖 Auto-record: Closing recorder tab - auto-downloading recording");
      
      // Stop recording and trigger download immediately
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      
      // ❌ REMOVE THESE LINES - they trigger the confirmation dialog
      // event.preventDefault();
      // event.returnValue = '';
      
      // Force download after a short delay
      setTimeout(() => {
        downloadRecording();
      }, 500);
      
      // ✅ Just return without preventing default - allows silent closure
      return;
    } 
    // MANUAL MODE: Show confirmation dialog, but don't stop/download until user confirms
    else {
      console.log("🚨 Manual recording: Showing leave confirmation dialog");
      
      // Don't stop recording here - wait for user decision
      // Just show the browser's native confirmation dialog
      event.preventDefault();
      event.returnValue = 'Recording is in progress. Are you sure you want to leave?';
      
      return event.returnValue;
    }
  } // If recording is NOT active (already stopped/downloaded), allow silent closure
  else {
    console.log("✅ Recording not active - allowing silent tab closure");
    // No event.preventDefault() - allow the tab to close silently
  }
});

// Handle the actual tab closure with auto-download for auto mode
window.addEventListener('unload', () => {
  // Handle BOTH auto-record AND manual mode closures
  if (isRecording && recordedChunks.length > 0) {
    console.log(`🤖 ${isAutoRecord ? 'Auto' : 'Manual'} recording: Tab closing - ensuring recording is saved`);

    // AUTO MODE: Stop and download immediately
    if (isAutoRecord) {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log("🛑 Auto-mode: Stopping recording before tab close");
        mediaRecorder.stop();
      }
      
      // Ensure download for auto-mode
      if (recordedChunks.length > 0) {
        console.log("💾 Auto-mode: Auto-downloading recording");
        setTimeout(() => {
          downloadRecording();
        }, 100);
      }
    }
    // MANUAL MODE: Force download immediately when user confirms leave
    else {
      console.log("💾 Manual mode: User confirmed leave - forcing immediate download");
      
      // Stop recording first
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      
      // Force download immediately without waiting for mediaRecorder.onstop
      if (recordedChunks.length > 0) {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
        const filename = `gmeet-recording-${timestamp}.webm`;
        
        // Use chrome.downloads API for reliable download
        chrome.downloads.download({ 
          url: url, 
          filename: filename, 
          saveAs: false        
        });
        
        // Send completion message
        chrome.runtime.sendMessage({ action: "recordingCompleted" });
        chrome.runtime.sendMessage({
          action: "showMeetStatus", 
          message: "✅ Recording Stopped and Auto-Downloaded"
        });
      }
    }
  }
  
  // Handle manual mode pending recordings (only if recording was ACTIVE)
  const pendingRecording = sessionStorage.getItem('pendingRecording');
  if (pendingRecording && recordedChunks.length > 0) {
    console.log("✅ Cleaning up old pending recording");
    sessionStorage.removeItem('pendingRecording');
  }
});

console.log("🎬 GMeet Recorder tab loaded - starting initialization check");

checkRecorderInitialization();
