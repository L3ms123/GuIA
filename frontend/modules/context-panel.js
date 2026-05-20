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
  let qrScannerStream = null;

  el('open-app-btn').addEventListener('click', () => {
    const ua = navigator.userAgent;
    const isAndroid = /Android/.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    const storeURL = isAndroid
      ? 'https://play.google.com/store/apps/details?id=com.neosistec.navilensgo'
      : isIOS
      ? 'https://apps.apple.com/us/app/navilens-go/id1313878412'
      : 'https://navilens.com';

    if (isAndroid) {
      window.location.href =
        'intent://com.neosistec.navilensgo#Intent;' +
        'action=android.intent.action.MAIN;' +
        'category=android.intent.category.LAUNCHER;' +
        'package=com.neosistec.navilensgo;' +
        `S.browser_fallback_url=${encodeURIComponent(storeURL)};` +
        'end';

    } else if (isIOS) {
      const fallbackTimer = setTimeout(() => {
        window.location.href = storeURL;
      }, 1500);

      const cancelFallback = () => {
        if (document.hidden) {
          clearTimeout(fallbackTimer);
          document.removeEventListener('visibilitychange', cancelFallback);
        }
      };
      document.addEventListener('visibilitychange', cancelFallback);

      window.location.href = 'navilensgo://';

    } else {
      window.location.href = 'https://navilens.com';
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
      console.log('QR Code detected:', decodedText);
      announce(t('app.qrScanSuccess', 'QR code scanned.'));
      handleQRCodeDetected(decodedText);
      closeQRScanner({ announceClose: false });
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
    console.log('QR Code detected:', data);

    try {
      const qrData = JSON.parse(data);
      
      // Extract room and artwork IDs from QR code
      const roomId = qrData.roomId || qrData.room;
      const artworkId = qrData.artworkId || qrData.artwork;
      
      if (!roomId) {
        console.warn('No room ID in QR code');
        el('context-error').textContent = t('app.invalidQR', 'Invalid QR code');
        return;
      }

      // Find room in location data by ID
      const room = (state.locationData.rooms || []).find(r => r.id === roomId);
      if (!room) {
        console.warn('Room not found in location data:', roomId);
        el('context-error').textContent = t('app.roomNotFound', 'Room not found');
        return;
      }

      const roomText = room.label || room.id;
      let artworkText = '';

      // Set room select
      const roomSelect = el('room-select');
      if (roomSelect) {
        roomSelect.value = roomId;
        roomSelect.removeAttribute('aria-invalid');
      }

      // Find artwork if specified in QR code
      if (artworkId) {
        const artwork = (room.artworks || []).find(a => (a.id || a.title) === artworkId);
        if (artwork) {
          artworkText = artwork.title;
          // Set artwork select
          const artworkSelect = el('artwork-select');
          if (artworkSelect) {
            artworkSelect.value = artworkId;
          }
        } else {
          console.warn('Artwork not found in room:', artworkId);
        }
      }

      // Re-render artwork select to ensure it's updated
      renderArtworkSelect();

      // Apply context which updates state.currentRoom and state.currentArtwork
      applyContext(roomText, artworkText);
    } catch (err) {
      console.error('Failed to parse QR code:', err);
      el('context-error').textContent = t('app.invalidQR', 'Invalid QR code format');
    }
  }

}
