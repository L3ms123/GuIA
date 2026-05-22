function initAudioControls() {
  const speedBtns = qa('.speed-btn');
  const muteBtn = el('mute-btn');
  const volumeSlider = el('volume-slider');
  const playbackBtn = el('audio-playback-btn');
  const replayBtn = el('audio-replay-btn');
  const spokenAudioBtn = el('spoken-audio-btn');
  const audioSettingsBtn = el('audio-settings-btn');

  let isMuted = false;
  let isAudioPaused = false;
  let spokenAudioEnabled = false;
  let currentVolume = 0.5;
  let previousVolume = 0.5;
  let audioWaiters = [];
  let currentAudioBaseSpeed = 'normal';
  let currentSpeechSpeed = 'normal';
  let speechPlaybackQueue = Promise.resolve();
  let speechQueueVersion = 0;
  let currentAudio = null;
  let lastAssistantText = '';

  function setAudioSettingsOpen(open) {
    document.body.toggleAttribute('data-audio-settings-open', open);
    if (!audioSettingsBtn) return;

    audioSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const icon = q('.material-symbols-outlined', audioSettingsBtn);
    if (icon) icon.textContent = open ? 'close' : 'tune';
    audioSettingsBtn.setAttribute(
      'aria-label',
      open
        ? t('audio.closeSettings', 'Close audio settings')
        : t('audio.openSettings', 'Open audio settings')
    );
  }

  function updateMuteIcon() {
    if (!muteBtn) return;
    const muted = isMuted || !spokenAudioEnabled || currentVolume === 0;
    muteBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${muted ? 'volume_off' : 'volume_up'}</span>`;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', muted ? t('audio.unmute', 'Unmute audio') : t('audio.mute', 'Mute audio'));
  }

  function updatePlaybackButton() {
    if (!playbackBtn) return;

    const icon = q('.material-symbols-outlined', playbackBtn);
    if (icon) icon.textContent = isAudioPaused ? 'play_arrow' : 'pause';
    playbackBtn.setAttribute('aria-pressed', isAudioPaused ? 'true' : 'false');
    playbackBtn.setAttribute(
      'aria-label',
      isAudioPaused ? t('audio.resume', 'Resume audio') : t('audio.pause', 'Pause audio')
    );
  }

  function updateSpokenAudioButton() {
    spokenAudioEnabled = !!state.accessibilityPrefs.spokenAudio;
    isMuted = !spokenAudioEnabled;

    if (volumeSlider) {
      if (spokenAudioEnabled) {
        if (Number(volumeSlider.value) === 0) {
          volumeSlider.value = Math.round(previousVolume * 100);
        }
        currentVolume = Number(volumeSlider.value) / 100;
      } else {
        if (currentVolume > 0) previousVolume = currentVolume;
        volumeSlider.value = 0;
        currentVolume = 0;
      }
    }

    applyAudioSettings();
    updateMuteIcon();

    if (spokenAudioEnabled) {
      resumeAudioOutput();
    } else {
      pauseAudioOutput();
    }

    if (!spokenAudioBtn) return;

    spokenAudioBtn.textContent = spokenAudioEnabled
      ? t('audio.spokenOn', 'Audio on')
      : t('audio.spokenOff', 'Audio off');
    spokenAudioBtn.setAttribute('aria-pressed', spokenAudioEnabled ? 'true' : 'false');
    spokenAudioBtn.setAttribute(
      'aria-label',
      spokenAudioEnabled
        ? t('audio.turnSpokenOff', 'Turn spoken audio off')
        : t('audio.turnSpokenOn', 'Turn spoken audio on')
    );
  }

  function applyAudioSettings(audio = currentAudio) {
    if (!audio) return;
    audio.volume = isMuted || !spokenAudioEnabled ? 0 : currentVolume;
    audio.muted = isMuted || !spokenAudioEnabled || currentVolume === 0;
    const baseRate = SPEECH_SPEED[currentAudioBaseSpeed];
    const targetRate = SPEECH_SPEED[currentSpeechSpeed];
    audio.playbackRate = targetRate / baseRate;
  }

  function canPlayAudio() {
    return spokenAudioEnabled && !isAudioPaused;
  }

  function waitUntilAudioAllowed() {
    if (canPlayAudio()) return Promise.resolve();
    return new Promise((resolve) => {
      audioWaiters.push(resolve);
    });
  }

  function resolveAudioWaiters() {
    const waiters = audioWaiters;
    audioWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function releaseAudioWaiters() {
    if (!canPlayAudio()) return;
    resolveAudioWaiters();
  }

  function pauseAudioOutput() {
    if (currentAudio && !currentAudio.paused) {
      applyAudioSettings(currentAudio);
      currentAudio.pause();
    }

    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
    }
  }

  function resumeAudioOutput() {
    if (!canPlayAudio()) return;

    if (currentAudio && currentAudio.paused) {
      applyAudioSettings(currentAudio);
      currentAudio.play().catch((err) => {
        console.error('Audio resume failed:', err);
      });
    }

    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }

    releaseAudioWaiters();
  }

  function stopCurrentAudio() {
    if (!currentAudio) return;

    const audio = currentAudio;
    currentAudio = null;
    audio.pause();
    audio.currentTime = 0;
    if (typeof audio.onended === 'function') {
      audio.onended();
    }
  }

  function resetSpeechQueue() {
    speechQueueVersion += 1;
    speechPlaybackQueue = Promise.resolve();

    stopCurrentAudio();
    speechSynthesis.cancel();
    resolveAudioWaiters();
  }

  function setSpeechSpeed(speed) {
    currentSpeechSpeed = speed;
    applyAudioSettings();

    speedBtns.forEach((btn) => {
      const on = btn.dataset.speed === speed;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  async function fetchKokoroAudio(text, lang = state.selectedLang) {
    const res = await fetch(API_ENDPOINTS.speak, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang, speed: currentSpeechSpeed })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.blob();
  }

  function playAudioBlob(blob, generatedSpeed = currentSpeechSpeed) {
    return new Promise(async (resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      currentAudioBaseSpeed = generatedSpeed;
      applyAudioSettings(audio);

      const cleanup = (played = true) => {
        if (currentAudio === audio) {
          currentAudio = null;
        }
        URL.revokeObjectURL(url);
        resolve(played);
      };

      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);

      try {
        await waitUntilAudioAllowed();

        if (currentAudio !== audio) {
          cleanup(false);
          return;
        }

        await audio.play();
      } catch (err) {
        console.error('Audio playback failed:', err);
        cleanup(false);
      }
    });
  }

  function browserSpeechPersonaFromAge(age = state.selectedAge) {
    const voicePersonaByAge = {
      young: 'teen',
      adult: 'adult',
      senior: 'senior'
    };

    return voicePersonaByAge[age] || 'adult';
  }

  function speakBrowser(text, lang = state.selectedLang, persona = browserSpeechPersonaFromAge(), cancelExisting = true) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);

      utterance.lang = BROWSER_SPEECH_LANG[lang];

      const style = BROWSER_SPEECH_PERSONA[persona];
      utterance.pitch = style.pitch;
      utterance.volume = isMuted || !spokenAudioEnabled ? 0 : currentVolume;

      utterance.rate = style.rate * (SPEECH_SPEED[currentSpeechSpeed]);
      utterance.onend = resolve;
      utterance.onerror = resolve;

      if (cancelExisting) speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }

  function queueSpeech(text, lang = state.selectedLang, persona = browserSpeechPersonaFromAge()) {
    if (!spokenAudioEnabled) return;

    const sentence = text.trim();
    if (!sentence) return;

    const queueVersion = speechQueueVersion;

    if (window.USE_KOKORO) {
      const requestedSpeed = currentSpeechSpeed;
      const audioPromise = fetchKokoroAudio(sentence, lang)
        .then((blob) => ({ blob }))
        .catch((err) => ({ err }));

      speechPlaybackQueue = speechPlaybackQueue
        .catch(() => {})
        .then(async () => {
          if (queueVersion !== speechQueueVersion) return;

          await waitUntilAudioAllowed();

          if (queueVersion !== speechQueueVersion) return;

          try {
            const result = await audioPromise;

            if (queueVersion !== speechQueueVersion) return;
            if (result.err) throw result.err;

            const played = await playAudioBlob(result.blob, requestedSpeed);
            if (!played && queueVersion === speechQueueVersion) {
              await speakBrowser(sentence, lang, persona, false);
            }
          } catch (err) {
            console.error('Kokoro fail:', err);
            if (queueVersion === speechQueueVersion) {
              await speakBrowser(sentence, lang, persona, false);
            }
          }
        });

      return;
    }

    speechPlaybackQueue = speechPlaybackQueue
      .catch(() => {})
      .then(async () => {
        if (queueVersion !== speechQueueVersion) return;

        await waitUntilAudioAllowed();

        if (queueVersion !== speechQueueVersion) return;

        return speakBrowser(sentence, lang, persona, false);
      });
  }

  function replayLastAssistantSpeech() {
    const fallbackText = q('.assistant-bubble')?.textContent?.trim() || '';
    const text = lastAssistantText.trim() || fallbackText;
    if (!text) return;

    isAudioPaused = false;
    resetSpeechQueue();
    updateSpokenAudioButton();
    updatePlaybackButton();
    queueSpeech(text);
  }

  function handleNarrationPreferenceChange(wasEnabled, isEnabled) {
    if (!isEnabled) {
      resetSpeechQueue();
      updateSpokenAudioButton();
      updatePlaybackButton();
      return;
    }

    isAudioPaused = false;
    updateSpokenAudioButton();
    updatePlaybackButton();

    if (!wasEnabled) {
      replayLastAssistantSpeech();
    }
  }

  // Event listeners
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeechSpeed(btn.dataset.speed);
    });
  });

  if (audioSettingsBtn) {
    audioSettingsBtn.addEventListener('click', () => {
      const willOpen = !document.body.hasAttribute('data-audio-settings-open');
      if (willOpen) {
        document.body.removeAttribute('data-location-panel-open');
        el('location-panel-btn')?.setAttribute('aria-expanded', 'false');
      }
      setAudioSettingsOpen(willOpen);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setAudioSettingsOpen(false);
    });

    setAudioSettingsOpen(false);
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
      const value = Number(volumeSlider.value);
      currentVolume = value / 100;
      if (currentVolume > 0) previousVolume = currentVolume;

      if (value === 0) {
        isMuted = true;
        state.accessibilityPrefs.spokenAudio = false;
        applyAudioSettings();
      } else {
        if (isMuted) isMuted = false;
        state.accessibilityPrefs.spokenAudio = true;
        applyAudioSettings();
      }

      document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
      syncAccessibilityControls();
      releaseAudioWaiters();
      updateSpokenAudioButton();
      if (!wasSpokenAudio && state.accessibilityPrefs.spokenAudio) {
        replayLastAssistantSpeech();
      }
      updateMuteIcon();
    });

    updateMuteIcon();
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
      isMuted = !isMuted;

      muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
      muteBtn.setAttribute('aria-label', isMuted ? t('audio.unmute', 'Unmute audio') : t('audio.mute', 'Mute audio'));

      if (isMuted) {
        state.accessibilityPrefs.spokenAudio = false;
        if (volumeSlider) volumeSlider.value = 0;
        applyAudioSettings();
      } else {
        state.accessibilityPrefs.spokenAudio = true;
        if (volumeSlider && Number(volumeSlider.value) === 0) {
          volumeSlider.value = Math.round((previousVolume) * 100);
        }
        currentVolume = Number(volumeSlider?.value || 50) / 100;
        previousVolume = currentVolume || previousVolume;
        applyAudioSettings();
      }

      document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
      syncAccessibilityControls();
      updateSpokenAudioButton();
      releaseAudioWaiters();
      if (!wasSpokenAudio && state.accessibilityPrefs.spokenAudio) {
        replayLastAssistantSpeech();
      }
      updateMuteIcon();
    });
  }

  if (playbackBtn) {
    playbackBtn.addEventListener('click', () => {
      isAudioPaused = !isAudioPaused;

      if (isAudioPaused) {
        pauseAudioOutput();
      } else {
        resumeAudioOutput();
      }

      updatePlaybackButton();
    });

    updatePlaybackButton();
  }

  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      state.accessibilityPrefs.spokenAudio = true;
      isAudioPaused = false;
      document.body.toggleAttribute('data-spoken-audio', true);
      syncAccessibilityControls();
      replayLastAssistantSpeech();
    });
  }

  if (spokenAudioBtn) {
    spokenAudioBtn.addEventListener('click', () => {
      const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
      state.accessibilityPrefs.spokenAudio = !state.accessibilityPrefs.spokenAudio;

      document.body.toggleAttribute('data-spoken-audio', state.accessibilityPrefs.spokenAudio);
      syncAccessibilityControls();
      handleNarrationPreferenceChange(wasSpokenAudio, state.accessibilityPrefs.spokenAudio);
    });

    updateSpokenAudioButton();
  }

  window.guiaResetSpeechQueue = resetSpeechQueue;
  window.guiaUpdateSpokenAudio = updateSpokenAudioButton;
  window.guiaReleaseAudioWaiters = releaseAudioWaiters; 
  window.guiaHandleNarrationPreferenceChange = handleNarrationPreferenceChange;
  window.guiaSetLastAssistantText = (text) => {
    if (typeof text === 'string' && text.trim()) {
      lastAssistantText = text.trim();
    }
  };

  return {
    get lastAssistantText() {
      return lastAssistantText;
    },
    set lastAssistantText(value) {
      lastAssistantText = value;
    },
    get currentSpeechSpeed() {
      return currentSpeechSpeed;
    },
    setSpeechSpeed,
    queueSpeech,
    resetSpeechQueue,
    applyAudioSettings,
    resumeAudioOutput
  };
}

// Initial welcome speech
function initInitialWelcomeSpeech(audio) {
  let welcomeSpoken = false;

  function speakInitialWelcome() {
    if (!state.chatStarted) return;
    if (welcomeSpoken) return;

    const firstBubble = q('.assistant-bubble');
    const text = firstBubble?.textContent?.trim();
    if (!text) return;

    audio.lastAssistantText = text;
    audio.resetSpeechQueue();
    audio.resumeAudioOutput();
    
    if (!state.accessibilityPrefs.spokenAudio) return;

    audio.queueSpeech(text, state.selectedLang);
    welcomeSpoken = true;
  }

  window.guiaSpeakInitialWelcome = speakInitialWelcome;
}
