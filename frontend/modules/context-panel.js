// Context panel

function initContextPanel() {
  const roomSelect = el('room-select');
  const artworkSelect = el('artwork-select');
  const setContextBtn = el('set-context-btn');
  const locationPanelBtn = el('location-panel-btn');
  const manualLocationBtn = el('manual-location-btn');
  const manualLocationPanel = el('manual-location-panel');

  renderLocationSelects();
  enableSelectEnterOpen(roomSelect);
  enableSelectEnterOpen(artworkSelect);

  function setLocationPanelOpen(open) {
    document.body.toggleAttribute('data-location-panel-open', open);
    locationPanelBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      announce(t('app.locationPanelOpened', 'Location panel opened.'));
    } else {
      announce(t('app.locationPanelClosed', 'Location panel closed.'));
    }
  }

  locationPanelBtn?.addEventListener('click', () => {
    const willOpen = !document.body.hasAttribute('data-location-panel-open');
    if (willOpen) {
      document.body.removeAttribute('data-audio-settings-open');
      el('audio-settings-btn')?.setAttribute('aria-expanded', 'false');
    }
    setLocationPanelOpen(willOpen);
  });

  roomSelect?.addEventListener('change', () => {
    roomSelect.removeAttribute('aria-invalid');
    renderArtworkSelect();
  });

  setContextBtn?.addEventListener('click', () => {
    if (!roomSelect.value) {
      el('context-error').textContent = t('app.contextError');
      roomSelect.setAttribute('aria-invalid', 'true');
      roomSelect.focus();
      return;
    }

    const roomText = roomSelect.options[roomSelect.selectedIndex].text;
    const artworkText = artworkSelect.value
      ? artworkSelect.options[artworkSelect.selectedIndex].text
      : '';

    applyContext(roomText, artworkText);
  });

  manualLocationBtn?.addEventListener('click', async () => {
    const willOpen = manualLocationPanel?.hasAttribute('hidden');
    if (willOpen) {
      await loadLocations();
      renderLocationSelects();
      closeQRScanner({ announceClose: false });
      manualLocationPanel?.removeAttribute('hidden');
      announce(t('app.manualSelectionOpened', 'Manual location selection opened.'));
      roomSelect?.focus();
    } else {
      manualLocationPanel?.setAttribute('hidden', '');
      announce(t('app.manualSelectionClosed', 'Manual location selection closed.'));
    }

    manualLocationBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  // ─── Navi Lens Integration ──────────────────────────────────────────────────────────
  let qrScannerActive = false;

  el('open-app-btn')?.addEventListener('click', () => {
    const ua = navigator.userAgent;
    const platform = navigator.platform || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS =
      /iPad|iPhone|iPod/i.test(ua) ||
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const navilensWebsiteURL = 'https://www.navilens.com/';
    const androidStoreURL = 'https://play.google.com/store/apps/details?id=com.neosistec.NaviLens';
    const iosStoreURL = 'https://apps.apple.com/us/app/navilens/id1273704914';

    if (isAndroid) {
      window.location.href =
        'intent://open#Intent;' +
        'action=android.intent.action.MAIN;' +
        'category=android.intent.category.LAUNCHER;' +
        'package=com.neosistec.NaviLens;' +
        `S.browser_fallback_url=${encodeURIComponent(androidStoreURL)};` +
        'end';

    } else if (isIOS) {
      const fallbackTimer = setTimeout(() => {
        window.location.href = iosStoreURL;
      }, 1500);

      const cancelFallback = () => {
        if (document.hidden) {
          clearTimeout(fallbackTimer);
          document.removeEventListener('visibilitychange', cancelFallback);
        }
      };
      document.addEventListener('visibilitychange', cancelFallback);

      window.location.href = 'navilens://';

    } else {
      window.open(navilensWebsiteURL, '_blank', 'noopener,noreferrer');
    }
  });

  el('scan-qr-btn').addEventListener('click', async () => {
    const scanner = el('qr-scanner');
    const openAppBtn = el('open-app-btn');
    const scanQrBtn = el('scan-qr-btn');
    const manualLocationBtn = el('manual-location-btn');

    if (qrScannerActive) {
      return;
    }

    try {
      closeManualLocationPanel();
      scanner.removeAttribute('hidden');
      openAppBtn.hidden = true;
      manualLocationBtn.hidden = true;
      scanQrBtn.disabled = true;
      scanQrBtn.setAttribute('aria-expanded', 'true');
      qrScannerActive = true;
      announce(t('app.qrScannerOpened', 'QR scanner opened.'));

      // html5-qrcode will handle camera access internally
      startQRDetection();
      el('close-qr-btn')?.focus();
    } catch (err) {
      console.error('QR scanner error:', err);
      closeQRScanner();
      const cameraError = el('camera-error');
      if (cameraError) {
        cameraError.textContent = t('app.cameraError');
        cameraError.hidden = false;
      }
    }
  });

  el('close-qr-btn').addEventListener('click', () => closeQRScanner({ restoreFocus: true }));

  function closeManualLocationPanel() {
    manualLocationPanel?.setAttribute('hidden', '');
    manualLocationBtn?.setAttribute('aria-expanded', 'false');
  }

  function setQRError(message) {
    const cameraError = el('camera-error');
    if (!cameraError) return;
    cameraError.textContent = message;
    cameraError.hidden = false;
  }

  async function closeQRScanner({ announceClose = true, restoreFocus = false } = {}) {
    const scanner = el('qr-scanner');
    const openAppBtn = el('open-app-btn');
    const scanQrBtn = el('scan-qr-btn');
    const manualLocationBtn = el('manual-location-btn');
    const cameraError = el('camera-error');
    const qrVideo = el('qr-video');

    const wasActive = qrScannerActive || !scanner.hasAttribute('hidden');
    scanner.setAttribute('hidden', '');
    openAppBtn.hidden = false;
    manualLocationBtn.hidden = false;
    scanQrBtn.disabled = false;
    scanQrBtn.setAttribute('aria-expanded', 'false');
    qrScannerActive = false;
    if (cameraError) cameraError.hidden = true;
    if (announceClose && wasActive) {
      announce(t('app.qrScannerClosed', 'QR scanner closed.'));
    }

    // Stop the html5-qrcode scanner if active
    if (html5QrCodeScanner) {
      const scannerInstance = html5QrCodeScanner;
      html5QrCodeScanner = null;
      try {
        await scannerInstance.stop();
      } catch (err) {
        console.warn('QR scanner stop skipped:', err);
      }

      try {
        await scannerInstance.clear();
      } catch (err) {
        console.warn('QR scanner clear skipped:', err);
      }
    }

    if (qrVideo) qrVideo.innerHTML = '';
    if (restoreFocus) scanQrBtn.focus();
  }

  let html5QrCodeScanner = null;

  function startQRDetection() {
    if (!window.Html5Qrcode) {
      console.error('Html5Qrcode library not loaded');
      el('context-error').textContent = 'QR code library not loaded';
      return;
    }

    // Create a new Html5Qrcode instance with the div element ID
    html5QrCodeScanner = new Html5Qrcode('qr-video');

    const onScanSuccess = (decodedText) => {
      console.info('QR decoded text:', decodedText);
      announce(t('app.qrScanSuccess', 'QR code scanned.'));
      const handled = handleQRCodeDetected(decodedText);
      if (handled) {
        closeQRScanner({ announceClose: false });
      }
    };

    const onScanFailure = (error) => {
      // QR code not detected in this frame - this is normal, just continue scanning
    };

    // Start scanning
    html5QrCodeScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      onScanSuccess,
      onScanFailure
    ).catch((err) => {
      console.error('Failed to start QR scanning:', err);
      closeQRScanner({ announceClose: false });
      const cameraError = el('camera-error');
      if (cameraError) {
        cameraError.textContent = t('app.cameraError', 'Camera error');
        cameraError.hidden = false;
      }
    });
  }

  function handleQRCodeDetected(data) {
    const decodedText = String(data || '').trim();
    const linkPayload = parseLocationLinkParams(decodedText);
    const isURL = /^[a-z][a-z0-9+.-]*:\/\//i.test(decodedText);

    if (linkPayload) {
      const applied = applyLocationPayload(linkPayload);
      if (applied) {
        const cameraError = el('camera-error');
        if (cameraError) cameraError.hidden = true;
      } else {
        setQRError(t('app.invalidQR', 'Invalid QR code'));
      }
      return applied;
    }

    if (isURL) {
      setQRError(t('app.invalidQR', 'Invalid QR code'));
      return false;
    }

    try {
      const qrData = JSON.parse(decodedText);

      if (!qrData.roomId && !qrData.room) {
        console.warn('No room ID in QR code');
        setQRError(t('app.invalidQR', 'Invalid QR code'));
        return false;
      }

      const applied = applyLocationPayload({
        room: qrData.roomId || qrData.room,
        artwork: qrData.artworkId || qrData.artwork
      });
      if (applied) {
        const cameraError = el('camera-error');
        if (cameraError) cameraError.hidden = true;
      } else {
        setQRError(t('app.invalidQR', 'Invalid QR code'));
      }
      return applied;
    } catch (err) {
      console.error('Failed to parse QR code:', err);
      setQRError(t('app.invalidQR', 'Invalid QR code format'));
      return false;
    }
  }

}
