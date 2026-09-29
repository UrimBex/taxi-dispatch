/* Real driver<->ops voice over WebRTC — browser to browser, no telephony provider involved. Signaling (SDP
   offer/answer, ICE candidates) is relayed through the existing WebSocket (server/ws.js's rtc relay); once a
   peer connection is up, audio flows directly between the two browsers (or via a TURN relay if a direct path
   isn't reachable — see ICE_SERVERS below).
   Piggybacks on the existing simulated voip call state (engine.js's voipStart/voipAnswer/voipEnd) for "who's
   calling whom" — this module only adds the actual audio on top of the same call/answer/hang-up actions
   driver.js and ops.js already trigger. Loaded after net.js (needs RO.live.sendRtc) and before driver.js/ops.js. */
(function (RO) {
  'use strict';
  const bus = RO.bus;
  // Public STUN only, free and account-less — works for most networks. If real-world testing turns up call
  // failures (symmetric NATs, restrictive corporate/mobile networks), add a TURN server here; nothing else
  // in this module needs to change.
  const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  let pc = null, localStream = null, currentDriverId = null, audioEl = null, unlockArmed = false;
  let pendingRemote = null, pendingIce = [];

  function ensureAudioEl() {
    if (audioEl) return audioEl;
    audioEl = document.createElement('audio');
    audioEl.id = 'rtc-audio'; audioEl.autoplay = true;
    document.body.appendChild(audioEl);
    return audioEl;
  }
  // <audio autoplay> alone isn't reliable here: the track arrives asynchronously, well after the click that
  // started the call, and browsers increasingly block audio playback that isn't tied directly to a user
  // gesture — the exact "call connected but silent" symptom. Explicitly play() it, and if that's blocked,
  // unlock it on the next click anywhere (answering/calling in the first place already proves the user is
  // interacting with the page, so this fires almost immediately in practice).
  function tryPlay() {
    const el = ensureAudioEl();
    const p = el.play();
    if (p && p.catch) p.catch(() => armUnlock());
  }
  function armUnlock() {
    bus.emit('rtc-error', 'Tap anywhere to enable audio');
    if (unlockArmed) return;
    unlockArmed = true;
    document.addEventListener('click', function handler() {
      unlockArmed = false; document.removeEventListener('click', handler); tryPlay();
    }, { once: true });
  }

  function newPeerConnection(driverId) {
    const p = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p.onicecandidate = e => { if (e.candidate) RO.live.sendRtc(driverId, 'ice', e.candidate.toJSON()); };
    p.ontrack = e => { ensureAudioEl().srcObject = e.streams[0] || new MediaStream([e.track]); tryPlay(); };
    p.onconnectionstatechange = () => {
      bus.emit('rtc-state', p.connectionState);
      if (p.connectionState === 'failed' || p.connectionState === 'closed') hangup();
    };
    return p;
  }

  async function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser/context has no microphone access (needs HTTPS or localhost).');
    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return localStream;
  }

  async function applyRemote(driverId, sdp) {
    if (!pc || currentDriverId !== driverId) { pendingRemote = { driverId, sdp }; return; }
    await pc.setRemoteDescription(sdp);
    for (const c of pendingIce.splice(0)) { try { await pc.addIceCandidate(c); } catch (e) { } }
  }

  async function startAsCaller(driverId) {
    hangup();
    currentDriverId = driverId;
    try {
      const stream = await getMic();
      pc = newPeerConnection(driverId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      RO.live.sendRtc(driverId, 'offer', offer.toJSON ? offer.toJSON() : { type: offer.type, sdp: offer.sdp });
    } catch (err) { bus.emit('rtc-error', err.message || String(err)); hangup(); }
  }

  async function startAsCallee(driverId) {
    hangup();
    currentDriverId = driverId;
    try {
      const stream = await getMic();
      pc = newPeerConnection(driverId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      if (pendingRemote && pendingRemote.driverId === driverId) { await applyRemote(driverId, pendingRemote.sdp); pendingRemote = null; }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      RO.live.sendRtc(driverId, 'answer', answer.toJSON ? answer.toJSON() : { type: answer.type, sdp: answer.sdp });
    } catch (err) { bus.emit('rtc-error', err.message || String(err)); hangup(); }
  }

  function hangup() {
    if (pc) { try { pc.close(); } catch (e) { } pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (audioEl) audioEl.srcObject = null;
    currentDriverId = null; pendingRemote = null; pendingIce = [];
  }

  bus.on('rtc', async msg => {
    if (msg.kind === 'offer' || msg.kind === 'answer') applyRemote(msg.driverId, msg.payload).catch(err => bus.emit('rtc-error', err.message || String(err)));
    else if (msg.kind === 'ice') {
      if (pc && currentDriverId === msg.driverId && pc.remoteDescription) pc.addIceCandidate(msg.payload).catch(() => { });
      else pendingIce.push(msg.payload);
    }
  });

  RO.RTC = { startAsCaller, startAsCallee, hangup };
})(window.RO);
