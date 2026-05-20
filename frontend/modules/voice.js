// Voice input

function initVoiceInput(audio) {
  const micBtn = el('mic-btn');

  if (!micBtn) {
    return {
      isRecording: () => false,
      isProcessing: () => false,
      stopRecording: () => {},
      sendAfterTranscription: () => {}
    };
  }

  const micStatus = el('mic-status');
  const micIcon = micBtn.querySelector('.material-symbols-outlined');
  const inputShell = q('.input-shell');
  const chatInputForVoice = el('chat-input');
  const sendBtnForVoice = el('send-btn');
  const voiceInputStatus = el('voice-input-status');
  const voiceInputStatusText = el('voice-input-status-text');

  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceMimeType = '';
  let voiceRecording = false;
  let voiceProcessing = false;
  let sendAfterVoiceTranscription = false;

  function setVoiceStatus(message, isError = false) {
    if (!micStatus) return;
    if (!message) {
      micStatus.textContent = '';
      micStatus.setAttribute('hidden', '');
      return;
    }
    micStatus.textContent = message;
    micStatus.hidden = false;
    micStatus.style.color = isError ? 'var(--error)' : 'var(--on-surface-variant)';
  }

  function setVoiceButtonState(recording) {
    micBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
    micBtn.setAttribute('aria-label', recording ? t('audio.stop') : t('audio.voice'));
    micBtn.setAttribute('title', recording ? t('audio.stop') : t('audio.voice'));
    micBtn.classList.toggle('is-listening', recording);
    if (micIcon) micIcon.textContent = recording ? 'stop' : 'mic';
  }

  function setVoiceInputTranscribing(transcribing) {
    inputShell?.classList.toggle('is-transcribing', transcribing);

    if (chatInputForVoice) {
      chatInputForVoice.disabled = transcribing;
      if (transcribing) {
        chatInputForVoice.setAttribute('aria-busy', 'true');
      } else {
        chatInputForVoice.removeAttribute('aria-busy');
      }
    }

    if (sendBtnForVoice) sendBtnForVoice.disabled = false;

    if (!voiceInputStatus) return;
    if (transcribing) {
      if (voiceInputStatusText) {
        voiceInputStatusText.textContent = t('audio.transcribing');
      }
      voiceInputStatus.hidden = false;
    } else {
      voiceInputStatus.setAttribute('hidden', '');
    }
  }

  function cleanupVoiceStream() {
    if (!voiceStream) return;
    voiceStream.getTracks().forEach((track) => track.stop());
    voiceStream = null;
  }

  function supportedVoiceMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function transcribeVoiceRecording() {
    const blob = new Blob(voiceChunks, { type: voiceMimeType || 'audio/webm' });
    if (!blob.size) {
      setVoiceStatus(t('audio.empty'), true);
      return '';
    }

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('lang', state.selectedLang);

    const res = await fetch(API_ENDPOINTS.transcribe, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `Transcription failed with ${res.status}`);
    }

    const data = await res.json();
    const text = (data.text || '').trim();
    if (!text) {
      setVoiceStatus(t('audio.empty'), true);
      return '';
    }

    el('chat-input').value = text;
    setVoiceStatus('');
    return text;
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus(t('audio.unavailable'), true);
      return;
    }

    audio.resetSpeechQueue();
    micBtn.disabled = true;
    setVoiceStatus(t('audio.requesting'));

    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMimeType = supportedVoiceMimeType();
      voiceRecorder = voiceMimeType
        ? new MediaRecorder(voiceStream, { mimeType: voiceMimeType })
        : new MediaRecorder(voiceStream);
      voiceChunks = [];

      voiceRecorder.ondataavailable = (event) => {
        if (event.data?.size) voiceChunks.push(event.data);
      };

      voiceRecorder.onerror = (event) => {
        console.error('Microphone recording error:', event.error || event);
        setVoiceStatus(t('audio.failed'), true);
      };

      voiceRecorder.onstop = async () => {
        cleanupVoiceStream();
        voiceRecording = false;
        voiceProcessing = true;
        setVoiceButtonState(false);
        setVoiceInputTranscribing(true);
        setVoiceStatus('');

        try {
          const text = await transcribeVoiceRecording();
          if (sendAfterVoiceTranscription && text) {
            sendAfterVoiceTranscription = false;
            setTimeout(() => {
              handleSendRef();
            }, 0);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          setVoiceStatus(t('audio.failed'), true);
        } finally {
          sendAfterVoiceTranscription = false;
          voiceRecorder = null;
          voiceChunks = [];
          voiceMimeType = '';
          voiceProcessing = false;
          micBtn.disabled = false;
          setVoiceInputTranscribing(false);
          if (chatInputForVoice?.value.trim()) chatInputForVoice.focus();
        }
      };

      voiceRecorder.start();
      voiceRecording = true;
      setVoiceButtonState(true);
      setVoiceStatus(t('audio.recording'));
    } catch (err) {
      console.error('Microphone access error:', err);
      cleanupVoiceStream();
      voiceRecorder = null;
      voiceMimeType = '';
      voiceRecording = false;
      setVoiceButtonState(false);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setVoiceStatus(denied ? t('audio.denied') : t('audio.failed'), true);
    } finally {
      if (!voiceProcessing) micBtn.disabled = false;
    }
  }

  function stopVoiceRecording(sendAfterTranscription = false) {
    if (!voiceRecorder || voiceRecorder.state !== 'recording') return;
    sendAfterVoiceTranscription = sendAfterTranscription;
    micBtn.disabled = true;
    setVoiceInputTranscribing(true);
    setVoiceStatus('');
    voiceRecorder.stop();
  }

  micBtn.addEventListener(
    'click',
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (voiceProcessing || micBtn.disabled) return;
      if (voiceRecording) {
        stopVoiceRecording();
      } else {
        await startVoiceRecording();
      }
    },
    true
  );

  // handleSend reference: set after initChat runs.
  let handleSendRef = () => {};

  return {
    isRecording: () => voiceRecording,
    isProcessing: () => voiceProcessing,
    stopRecording: stopVoiceRecording,
    sendAfterTranscription() {
      sendAfterVoiceTranscription = true;
    },
    setHandleSend(fn) {
      handleSendRef = fn;
    }
  };
}
