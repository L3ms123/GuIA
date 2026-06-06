// Spoken tutorial independent from the visual tutorial — manual only (no auto-advance)
function initSpokenTutorial(audio) {
  let overlay = null;
  let titleNode = null;
  let bodyNode = null;
  let stepCountNode = null;
  let closeBtn = null;
  let prevBtn = null;
  let nextBtn = null;
  let currentIndex = 0;
  let isOpen = false;
  let isAudioPlaying = false;

  function buildSteps() {
    return [
      {
        title: t('tutorialSpoken.locationTitle', 'Location panel'),
        body: t(
          'tutorialSpoken.locationBody',
          'At the top left you will find the location panel, which is open by default. Use it to select your floor and room. Once you confirm your location, GuIA will know which artworks surround you and can answer questions about them.'
        ),
        icon: 'location_on'
      },
      {
        title: t('tutorialSpoken.chatTitle', 'Ask a question'),
        body: t(
          'tutorialSpoken.chatBody',
          'At the bottom of the screen there is a text field. Type any question about the artworks, the room, or the museum, then press the Send button to the right. GuIA will answer and read the response aloud.'
        ),
        icon: 'chat'
      },
      {
        title: t('tutorialSpoken.micTitle', 'Voice input'),
        body: t(
          'tutorialSpoken.micBody',
          'Next to the text field there is a microphone button. Press it to ask your question by voice. GuIA will transcribe what you say and you can review the text before sending.'
        ),
        icon: 'mic'
      },
      {
        title: t('tutorialSpoken.audioTitle', 'Audio controls'),
        body: t(
          'tutorialSpoken.audioBody',
          'At the top right you will find the audio controls panel. Here you can turn narration on or off, adjust the volume, change the reading speed, and replay the last answer.'
        ),
        icon: 'volume_up'
      },
      {
        title: t('tutorialSpoken.settingsTitle', 'Settings'),
        body: t(
          'tutorialSpoken.settingsBody',
          'Press the settings button at the top of the screen to change the language, the guide personality, or the age range. You can also adjust accessibility options such as large text, simple language, and audio descriptions.'
        ),
        icon: 'settings'
      }
    ];
  }

  function steps() {
    return buildSteps();
  }

  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'tutorial-spoken-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tutorial-spoken-title');
    overlay.setAttribute('aria-describedby', 'tutorial-spoken-body');
    overlay.hidden = true;

    const panel = document.createElement('section');
    panel.className = 'tutorial-spoken-panel';

    const header = document.createElement('div');
    header.className = 'tutorial-spoken-header';

    const iconNode = document.createElement('span');
    iconNode.className = 'tutorial-spoken-icon material-symbols-outlined';
    iconNode.setAttribute('aria-hidden', 'true');

    titleNode = document.createElement('h2');
    titleNode.id = 'tutorial-spoken-title';
    titleNode.className = 'tutorial-spoken-title';

    stepCountNode = document.createElement('span');
    stepCountNode.className = 'tutorial-spoken-progress';

    header.append(iconNode, titleNode, stepCountNode);

    bodyNode = document.createElement('p');
    bodyNode.id = 'tutorial-spoken-body';
    bodyNode.className = 'tutorial-spoken-body';

    const controls = document.createElement('div');
    controls.className = 'tutorial-spoken-controls';

    const audioBtn = document.createElement('button');
    audioBtn.type = 'button';
    audioBtn.className = 'tutorial-spoken-audio tutorial-spoken-audio--off';
    audioBtn.setAttribute('aria-label', t('tutorialSpoken.playAudio', 'Play audio'));
    audioBtn.setAttribute('aria-pressed', 'false');
    audioBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">volume_off</span>';
    audioBtn.addEventListener('click', () => {
      if (isAudioPlaying) {
        // Stop audio if already playing
        audio?.resetSpeechQueue();
        isAudioPlaying = false;
        if (overlay._audioBtn) {
          overlay._audioBtn.classList.remove('tutorial-spoken-audio--on');
          overlay._audioBtn.classList.add('tutorial-spoken-audio--off');
          overlay._audioBtn.setAttribute('aria-pressed', 'false');
          overlay._audioBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">volume_off</span>';
        }
      } else {
        // Play audio if not playing
        const step = steps()[currentIndex];
        speakStep(step);
      }
    });

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tutorial-spoken-close';
    closeBtn.textContent = t('tutorialSpoken.close', 'Close');
    closeBtn.addEventListener('click', closeSpokenTutorial);

    prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'tutorial-spoken-prev';
    prevBtn.textContent = t('tutorialSpoken.previous', 'Previous');
    prevBtn.addEventListener('click', () => showStep(currentIndex - 1));

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'tutorial-spoken-next';
    nextBtn.textContent = t('tutorialSpoken.next', 'Next');

    controls.append(prevBtn, nextBtn, audioBtn, closeBtn);
    panel.append(header, bodyNode, controls);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay._iconNode = iconNode;
    overlay._audioBtn = audioBtn;
  }

  function updateNavigation() {
    const allSteps = steps();
    const total = allSteps.length;

    prevBtn.disabled = currentIndex <= 0;

    const isLast = currentIndex >= total - 1;
    if (isLast) {
      nextBtn.textContent = t('tutorialSpoken.done', 'Done');
      nextBtn.className = 'tutorial-spoken-done';
    } else {
      nextBtn.textContent = t('tutorialSpoken.next', 'Next');
      nextBtn.className = 'tutorial-spoken-next';
    }

    stepCountNode.textContent = `${currentIndex + 1} / ${total}`;
  }

  function textForStep(step) {
    return `${step.title}. ${step.body}`;
  }

  function speakStep(step) {
    if (!audio) return;
    console.log('speakStep called', step);
    isAudioPlaying = true;
    // Enable audio button when user clicks it
    if (overlay._audioBtn) {
      overlay._audioBtn.classList.remove('tutorial-spoken-audio--off');
      overlay._audioBtn.classList.add('tutorial-spoken-audio--on');
      overlay._audioBtn.setAttribute('aria-pressed', 'true');
      overlay._audioBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">volume_up</span>';
    }
    audio.resetSpeechQueue();
    console.log('Calling queueSpeech with:', textForStep(step));
    
    // Temporarily enable spoken audio for tutorial
    const originalSpokenAudioEnabled = state.accessibilityPrefs.spokenAudio;
    state.accessibilityPrefs.spokenAudio = true;
    // Update the audio module's spokenAudioEnabled variable
    audio.updateSpokenAudioButton?.();
    
    const result = audio.queueSpeech(textForStep(step));
    console.log('queueSpeech result:', result);
    result?.then(() => {
      console.log('Audio finished playing');
      // Restore original spoken audio setting without updating the button
      state.accessibilityPrefs.spokenAudio = originalSpokenAudioEnabled;
      // Don't call updateSpokenAudioButton to avoid affecting the main audio button
      isAudioPlaying = false;
      if (overlay._audioBtn) {
        overlay._audioBtn.classList.remove('tutorial-spoken-audio--on');
        overlay._audioBtn.classList.add('tutorial-spoken-audio--off');
        overlay._audioBtn.setAttribute('aria-pressed', 'false');
        overlay._audioBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">volume_off</span>';
      }
    });
  }

  function showStep(index) {
    const allSteps = steps();
    if (!overlay) createOverlay();

    currentIndex = Math.min(Math.max(0, index), allSteps.length - 1);
    const step = allSteps[currentIndex];

    if (overlay._iconNode) overlay._iconNode.textContent = step.icon || 'info';
    titleNode.textContent = step.title;
    bodyNode.textContent = step.body;

    updateNavigation();

    overlay.hidden = false;
    isOpen = true;

    nextBtn.onclick = currentIndex >= allSteps.length - 1
      ? closeSpokenTutorial
      : () => showStep(currentIndex + 1);

    // Focus next button instead of close button for better accessibility
    window.setTimeout(() => nextBtn?.focus?.(), 50);

    // No speak automatically - user must press audio button
  }

  function closeSpokenTutorial() {
    if (!overlay || !isOpen) return;

    overlay.hidden = true;
    isOpen = false;
    isAudioPlaying = false;
    audio?.resetSpeechQueue();

    window.setTimeout(() => {
      if (!document.body.hasAttribute('data-onboarding-open') &&
          !document.body.hasAttribute('data-tutorial-open')) {
        window.guiaReplayLastAssistantSpeech?.();
      }
    }, 0);
  }

  function openSpokenTutorial(initialStep = 0) {
    if (!state.accessibilityPrefs.tutorialSpoken) return;
    // Activate spoken audio temporarily for the tutorial
    const wasSpokenAudio = state.accessibilityPrefs.spokenAudio;
    state.accessibilityPrefs.spokenAudio = true;
    showStep(initialStep);
    // Restore original state
    state.accessibilityPrefs.spokenAudio = wasSpokenAudio;
  }

  window.guiaOpenSpokenTutorial = openSpokenTutorial;
  window.guiaCloseSpokenTutorial = closeSpokenTutorial;
}

