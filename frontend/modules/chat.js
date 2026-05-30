// Chat

function initChat(audio, voice) {
  const chatThread = el('chat-thread');
  const chatInput = el('chat-input');
  const sendBtn = el('send-btn');
  const typingIndicator = el('typing-indicator');
  const typingStatus = el('typing-status');

  let isGenerating = false;

  function setThinkingIndicator(isThinking) {
    if (!typingIndicator) return;

    if (isThinking) {
      typingIndicator.hidden = false;
      typingIndicator.removeAttribute('hidden');
      typingIndicator.setAttribute('aria-hidden', 'false');
      typingIndicator.classList.add('is-visible');
      typingIndicator.style.display = 'inline-flex';
      if (typingStatus) typingStatus.textContent = t('chat.typingStatus', 'GuIA is writing.');
    } else {
      typingIndicator.hidden = true;
      typingIndicator.setAttribute('hidden', '');
      typingIndicator.setAttribute('aria-hidden', 'true');
      typingIndicator.classList.remove('is-visible');
      typingIndicator.style.display = 'none';
      if (typingStatus) typingStatus.textContent = '';
    }
  }

  function appendToBubble(bubble, text) {
    setBubbleText(bubble, getBubbleText(bubble) + text, 'assistant');
    updateBubbleAccessibilityLabel(bubble, 'assistant');
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function extractCompleteSentences(buffer) {
    const sentences = [];
    const sentenceEndPattern = /[.!?\u3002\uff01\uff1f]+(?=\s|$)/g;
    let lastEnd = 0;
    let match;

    while ((match = sentenceEndPattern.exec(buffer)) !== null) {
      const end = sentenceEndPattern.lastIndex;
      const sentence = buffer.slice(lastEnd, end).trim();
      if (sentence) sentences.push(sentence);
      lastEnd = end;
      while (buffer[lastEnd] === ' ' || buffer[lastEnd] === '\n') lastEnd += 1;
    }

    return {
      sentences,
      remainder: buffer.slice(lastEnd)
    };
  }

  async function readNdjsonStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        onEvent(JSON.parse(line));
      }
    }

    pending += decoder.decode();
    if (pending.trim()) onEvent(JSON.parse(pending));
  }

  async function streamAssistantReply(payload) {
    let assistantBubble = null;
    let receivedText = false;
    let sentenceBuffer = '';
    let fullAssistantText = '';

    const timingStart = performance.now();
    let ttftMs = null;
    let streamErrored = false;

    try {
      const res = await fetch(API_ENDPOINTS.chatStream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      if (!res.body) {
        throw new Error('This browser does not support streamed responses.');
      }

      await readNdjsonStream(res, (event) => {
        if (event.type === 'delta') {
          const text = event.text || '';
          if (!text) return;

          if (!receivedText) {
            receivedText = true;
            if (ttftMs === null) ttftMs = Math.round(performance.now() - timingStart);
            setThinkingIndicator(false);
            assistantBubble = addBubble('assistant', '');
          }

          appendToBubble(assistantBubble, text);
          sentenceBuffer += text;
          fullAssistantText += text;

          if (!payload.simple_language) {
            const extracted = extractCompleteSentences(sentenceBuffer);
            extracted.sentences.forEach((sentence) => audio.queueSpeech(sentence));
            sentenceBuffer = extracted.remainder;
          }
        } else if (event.type === 'replace') {
          const text = event.text || '';
          if (!text) return;

          if (!receivedText) {
            receivedText = true;
            if (ttftMs === null) ttftMs = Math.round(performance.now() - timingStart);
            setThinkingIndicator(false);
            assistantBubble = addBubble('assistant', '');
          }

          setBubbleText(assistantBubble, text, 'assistant');
          updateBubbleAccessibilityLabel(assistantBubble, 'assistant');
          fullAssistantText = text;
          sentenceBuffer = '';
          chatThread.scrollTop = chatThread.scrollHeight;

        } else if (event.type === 'error') {
          streamErrored = true;
          throw new Error(event.error || 'Streaming chat failed');
        }
      });

      if (!payload.simple_language && sentenceBuffer.trim()) {
        audio.queueSpeech(sentenceBuffer);
      }

      if (fullAssistantText.trim()) {
        audio.lastAssistantText = fullAssistantText.trim();
        if (assistantBubble) {
          setBubbleSource(assistantBubble, fullAssistantText.trim(), state.selectedLang);
          assistantBubble.dataset.messageLang = state.selectedLang;
          window.saveGuiaSession?.();
        }
        if (payload.simple_language) {
          audio.resetSpeechQueue();
          audio.queueSpeech(audio.lastAssistantText);
        }
      }

      if (assistantBubble && !payload.simple_language) {
        await annotateEasyWords(assistantBubble);
      }

      if (!receivedText) {
        const emptyBubble = addBubble('assistant', t('chat.emptyResponse', "I couldn't generate a response."), {
          sourceText: t('chat.emptyResponse', "I couldn't generate a response."),
          sourceLang: state.selectedLang
        });
        if (!payload.simple_language) {
          await annotateEasyWords(emptyBubble);
        }
      }
    } catch (err) {
      streamErrored = true;
      throw err;
    } finally {
      setThinkingIndicator(false);
      window.guiaTrack?.('answer_timing', {
        clientReqId: payload.client_req_id || null,
        ttftMs,
        ttdoneMs: Math.round(performance.now() - timingStart),
        errored: streamErrored
      });
    }
  }

  async function handleSend() {
    if (isGenerating) return;

    if (voice.isRecording()) {
      voice.stopRecording(false);
      return;
    }

    if (voice.isProcessing()) {
      announce(t('audio.reviewTranscription', 'Wait for transcription to finish, then review the text before sending.'));
      return;
    }

    const value = chatInput.value.trim();
    if (!value) return;

    addBubble('user', value, { sourceText: value, sourceLang: state.selectedLang });
    chatInput.value = '';

    audio.resetSpeechQueue();
    setThinkingIndicator(true);

    isGenerating = true;
    state.chatGenerating = true;
    sendBtn.disabled = true;

    const clientReqId = crypto.randomUUID();
    const via = window.guiaAnalytics?.state.lastSendVia || 'text';
    if (window.guiaAnalytics) window.guiaAnalytics.state.lastSendVia = 'text';
    const locationInfo = window.guiaAnalytics?.nextQuestionIndexForLocation?.() || {};
    window.guiaTrack?.('question_asked', {
      clientReqId,
      lang: state.selectedLang,
      msgLen: value.length,
      msgWords: value.split(/\s+/).filter(Boolean).length,
      via,
      locationKey: locationInfo.locationKey || null,
      questionIndexInLocation: locationInfo.questionIndexInLocation || null
    });

    try {
      await streamAssistantReply({
        session_id: sessionId,
        visit_id: window.guiaAnalytics?.visitId,
        client_req_id: clientReqId,
        message: value,
        language: state.selectedLang,
        age_range: state.selectedAge || 'adult',
        personality: state.selectedPersona,
        simple_language: state.accessibilityPrefs.simpleLanguage,
        visual_descriptions: state.accessibilityPrefs.audioDescription,
        more_time: state.accessibilityPrefs.moreTime,
        room: state.currentRoom,
        artwork: state.currentArtwork
      });
    } catch (e) {
      console.error('Chat error:', e);
      setThinkingIndicator(false);
      addBubble('assistant', t('chat.connectionError'), {
        sourceText: t('chat.connectionError'),
        sourceLang: state.selectedLang
      });
    } finally {
      isGenerating = false;
      state.chatGenerating = false;
      sendBtn.disabled = false;
      setThinkingIndicator(false);
      window.saveGuiaSession?.();
    }
  }

  async function sendContextMessage(value) {
    if (isGenerating) return;
    if (!value?.trim()) return;

    audio.resetSpeechQueue();
    setThinkingIndicator(true);

    isGenerating = true;
    state.chatGenerating = true;
    sendBtn.disabled = true;

    const trimmed = value.trim();
    const clientReqId = crypto.randomUUID();
    const locationInfo = window.guiaAnalytics?.nextQuestionIndexForLocation?.() || {};
    window.guiaTrack?.('question_asked', {
      clientReqId,
      lang: state.selectedLang,
      msgLen: trimmed.length,
      msgWords: trimmed.split(/\s+/).filter(Boolean).length,
      via: 'context',
      locationKey: locationInfo.locationKey || null,
      questionIndexInLocation: locationInfo.questionIndexInLocation || null
    });

    try {
      await streamAssistantReply({
        session_id: sessionId,
        visit_id: window.guiaAnalytics?.visitId,
        client_req_id: clientReqId,
        message: trimmed,
        language: state.selectedLang,
        age_range: state.selectedAge || 'adult',
        personality: state.selectedPersona,
        simple_language: state.accessibilityPrefs.simpleLanguage,
        visual_descriptions: state.accessibilityPrefs.audioDescription,
        more_time: state.accessibilityPrefs.moreTime,
        room: state.currentRoom,
        artwork: state.currentArtwork
      });
    } catch (e) {
      console.error('Chat error:', e);
      setThinkingIndicator(false);
      addBubble('assistant', t('chat.connectionError'), {
        sourceText: t('chat.connectionError'),
        sourceLang: state.selectedLang
      });
    } finally {
      isGenerating = false;
      state.chatGenerating = false;
      sendBtn.disabled = false;
      setThinkingIndicator(false);
      window.saveGuiaSession?.();
    }
  }

  // Wire handleSend into the voice module so onstop can call it
  voice.setHandleSend(handleSend);
  window.guiaSendContextMessage = sendContextMessage;

  function initSuggestionButtons() {
    qa('.suggestion-btn').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        if (index === 0) {
          chatInput.value = btn.textContent.trim();
          window.guiaAnalytics?.setLastSendVia('suggestion');
          handleSend();
          return;
        }

        if (index === 1) {
          if (!audio.lastAssistantText.trim()) return;
          audio.resetSpeechQueue();
          audio.queueSpeech(audio.lastAssistantText);
          return;
        }

        if (index === 2) {
          audio.setSpeechSpeed('slow');
          chatInput.value = btn.textContent.trim();
          window.guiaAnalytics?.setLastSendVia('suggestion');
          handleSend();
        }
      });
    });
  }

  setThinkingIndicator(false);
  initSuggestionButtons();

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  return { handleSend };
}
