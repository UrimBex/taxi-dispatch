/* Real voice over WebRTC — browser to browser, no telephony provider involved. Signaling (SDP offer/answer,
   ICE candidates) is relayed through the existing WebSocket (server/ws.js's rtc relay); once a peer connection
   is up, audio flows directly between the two browsers (or via a TURN relay if a direct path isn't reachable —
   see ICE_SERVERS below).
   Two addressing channels, both piggybacking on an existing ringing/active call state machine for "who's
   calling whom" rather than reinventing one:
    - 'driver' (default): driver<->ops or driver<->rider, id is a driverId — engine.js's voipStart/voipAnswer/
      voipEnd, disambiguated by peer ('ops'/'client').
    - 'call': rider<->operator via the IVR queue, id is the call's own id — engine.js's queueCall/answerCall/
      endCall.
   This module only adds the actual audio on top of whichever of those actions driver.js/ops.js/customer.js/
   ivr.js already trigger. Loaded after net.js (needs RO.live.sendRtc) and before those. */
(function (RO) {
  'use strict';
  const bus = RO.bus;
  // Public STUN only, free and account-less — works for most networks. If real-world testing turns up call
  // failures (symmetric NATs, restrictive corporate/mobile networks), add a TURN server here; nothing else
  // in this module needs to change.
  const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  let pc = null, localStream = null, currentId = null, currentChannel = 'driver', currentPeer = 'ops', audioEl = null, unlockArmed = false;
  let pendingRemote = null, pendingIce = [];
  // A call can fail and reset itself (teardownConnection/hangup) faster than a human can type a debug command —
  // debug() alone then just shows "nothing happened", which looks identical to "never started". Keep a running
  // trail of what actually happened instead, printed live and readable afterwards via RO.RTC.log().
  const events = [];
  let debugBox = null;
  // Visible on-screen instead of only in the console — a call can fail and reset before there's time to open
  // DevTools and type anything, and relaying console output by hand has turned out to be its own source of
  // errors. A screenshot of the page now shows exactly what happened.
  function ensureDebugBox() {
    if (debugBox) return debugBox;
    debugBox = document.createElement('div');
    debugBox.id = 'rtc-debug';
    // Top-left, not bottom — a call toast sits at the bottom of the screen (.d-toast) and the ops incoming-call
    // banner sits top-RIGHT (#voip-modal); this was visually covering a driver's Hang Up button even with
    // pointer-events:none, since that only stops clicks, not hiding what's underneath from view.
    debugBox.style.cssText = 'position:fixed;left:8px;top:8px;max-width:70vw;max-height:26vh;overflow:auto;background:#000c;color:#0f0;font:10px/1.4 ui-monospace,Consolas,monospace;padding:6px 8px;border-radius:6px;z-index:99999;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(debugBox);
    return debugBox;
  }
  function renderDebugBox() { ensureDebugBox().textContent = events.slice(-12).join('\n'); }
  function log(...args) {
    const line = `[rtc ${new Date().toISOString().slice(11, 23)}] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    events.push(line); if (events.length > 100) events.shift();
    console.log(line);
    renderDebugBox();
  }

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

  function newPeerConnection(id, channel, peer) {
    const p = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p.onicecandidate = e => { if (e.candidate) { log('local ICE candidate ready, sending'); RO.live.sendRtc(id, 'ice', e.candidate.toJSON(), peer, channel); } else log('local ICE gathering complete'); };
    p.ontrack = e => { log('ontrack: remote audio arrived'); ensureAudioEl().srcObject = e.streams[0] || new MediaStream([e.track]); tryPlay(); };
    p.oniceconnectionstatechange = () => log('iceConnectionState ->', p.iceConnectionState);
    p.onconnectionstatechange = () => {
      log('connectionState ->', p.connectionState);
      bus.emit('rtc-state', p.connectionState);
      if (p.connectionState === 'failed' || p.connectionState === 'closed') hangup();
    };
    return p;
  }

  async function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser/context has no microphone access (needs HTTPS or localhost).');
    if (!localStream) { log('requesting microphone...'); localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); log('microphone granted', localStream.getTracks().map(t => t.label)); }
    return localStream;
  }

  async function applyRemote(id, sdp) {
    if (!pc || currentId !== id) { log('buffering remote', sdp.type, '(no active call yet for', id, ')'); pendingRemote = { id, sdp }; return; }
    log('applying remote', sdp.type);
    await pc.setRemoteDescription(sdp);
    const queued = pendingIce.splice(0);
    if (queued.length) log('flushing', queued.length, 'queued ICE candidate(s)');
    for (const c of queued) { try { await pc.addIceCandidate(c); } catch (e) { log('queued ICE candidate rejected:', e.message); } }
  }

  // Closes any existing connection/stream WITHOUT touching pendingRemote/pendingIce — those hold a signal that
  // may have arrived for the call about to start (the offer almost always beats a human clicking "Answer" to
  // it), and wiping them here would throw it away right before it's needed. hangup() (below) is the one that
  // actually discards them, once a call is genuinely over rather than just starting.
  function teardownConnection() {
    if (pc) { try { pc.close(); } catch (e) { } pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (audioEl) audioEl.srcObject = null;
    currentId = null;
  }

  // channel: 'driver' (default) or 'call' — see file header. peer only matters for a driver's own outgoing
  // signals (ops vs rider); OPS and CLIENT callers can omit it, the server infers their peer from their role
  // regardless of what's sent.
  async function startAsCaller(id, peer, channel) {
    channel = channel || 'driver';
    log('startAsCaller', channel, id, peer || 'ops');
    teardownConnection();
    currentId = id; currentChannel = channel; currentPeer = peer || 'ops';
    try {
      const stream = await getMic();
      pc = newPeerConnection(id, channel, currentPeer);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      log('sending offer');
      RO.live.sendRtc(id, 'offer', offer.toJSON ? offer.toJSON() : { type: offer.type, sdp: offer.sdp }, currentPeer, channel);
    } catch (err) { log('FAILED:', err.name, err.message); bus.emit('rtc-error', err.message || String(err)); hangup(); }
  }

  async function startAsCallee(id, peer, channel) {
    channel = channel || 'driver';
    log('startAsCallee', channel, id, peer || 'ops', 'pendingRemote for this id?', !!(pendingRemote && pendingRemote.id === id));
    teardownConnection();
    currentId = id; currentChannel = channel; currentPeer = peer || 'ops';
    try {
      const stream = await getMic();
      pc = newPeerConnection(id, channel, currentPeer);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      if (pendingRemote && pendingRemote.id === id) { await applyRemote(id, pendingRemote.sdp); pendingRemote = null; }
      else log('WARNING: no offer buffered for', id, '— creating an answer with nothing to answer');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log('sending answer');
      RO.live.sendRtc(id, 'answer', answer.toJSON ? answer.toJSON() : { type: answer.type, sdp: answer.sdp }, currentPeer, channel);
    } catch (err) { log('FAILED:', err.name, err.message); bus.emit('rtc-error', err.message || String(err)); hangup(); }
  }

  function hangup() {
    log('hangup');
    teardownConnection();
    pendingRemote = null; pendingIce = [];
  }

  bus.on('rtc', async msg => {
    log('received', msg.channel, msg.kind, 'from', msg.from, 'for', msg.id);
    if (msg.kind === 'offer' || msg.kind === 'answer') applyRemote(msg.id, msg.payload).catch(err => { log('setRemoteDescription FAILED:', err.message); bus.emit('rtc-error', err.message || String(err)); });
    else if (msg.kind === 'ice') {
      if (pc && currentId === msg.id && pc.remoteDescription) pc.addIceCandidate(msg.payload).catch(err => log('addIceCandidate failed:', err.message));
      else { log('queueing ICE candidate (no matching active call yet)'); pendingIce.push(msg.payload); }
    }
  });

  // Manual diagnostic — run RO.RTC.debug() in the browser console during/after a call to see what's actually
  // happening (which side stalled: no local media, no remote description, no ICE candidates, etc.) instead of
  // waiting for something to throw.
  function debug() {
    if (!pc) return { active: false, currentId, currentChannel, pendingRemote: !!pendingRemote, pendingIceCount: pendingIce.length };
    return {
      active: true, currentId, currentChannel,
      connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, signalingState: pc.signalingState,
      hasLocalDescription: !!pc.localDescription, hasRemoteDescription: !!pc.remoteDescription,
      localTracks: localStream ? localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted, readyState: t.readyState })) : [],
      remoteTracks: pc.getReceivers().map(r => r.track && ({ kind: r.track.kind, enabled: r.track.enabled, muted: r.track.muted, readyState: r.track.readyState })).filter(Boolean),
      audioElHasSrc: !!(audioEl && audioEl.srcObject), audioElPaused: audioEl ? audioEl.paused : null,
      pendingRemote: !!pendingRemote, pendingIceCount: pendingIce.length
    };
  }

  // RO.RTC.log() — the running event trail (what actually happened, in order), for when the call has already
  // failed/reset itself by the time you get to type a command. RO.RTC.debug() is the live snapshot right now.
  RO.RTC = { startAsCaller, startAsCallee, hangup, debug, log: () => events.slice() };
})(window.RO);
