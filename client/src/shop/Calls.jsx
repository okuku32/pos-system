// 📞 In-app voice calls: a buyer calls a seller, straight from the browser or the app (WebRTC). Seller offline: their
// phone gets a "… is calling you" push and the call waits a minute for them to open the app and answer.
// The server only passes the set-up messages between the two (server/market/calls.js); the voice goes directly
// between the two phones / computers. <CallManager/> sits once in the shop layout (the call screen, ring tones,
// incoming calls); <CallButton person={…}/> starts a call from anywhere (seller cards, ad page, seller page).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useShop } from './ShopContext';
import { usePresence } from '../market/Presence';
import { imgUrl } from '../market/marketApi';
import { prettyPhone } from './shopApi';

const DEVICE = Math.random().toString(36).slice(2, 12); // this tab: the callee's other tabs stop ringing when it answers
const RING_SECONDS = 40;
export const canCall = () => typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia;
const firstName = (name) => String(name || '').split(' ')[0] || 'them';

// start a call from anywhere: the <CallManager/> on the page picks it up
export function startCall(person) {
  window.dispatchEvent(new CustomEvent('os:call', { detail: person }));
}

// ---------------------------------------------------------------- tones (Web Audio, no sound files)
// ringback (I'm calling): one long beep every 3 s · ringtone (someone's calling me): two quick beeps every 2 s
function playTone(kind) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return () => {};
  let ctx;
  try {
    ctx = new Ctx();
  } catch {
    return () => {};
  }
  const beep = (freq, at, length, volume) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.03);
    gain.gain.setValueAtTime(volume, at + length - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  };
  const once = () => {
    const now = ctx.currentTime + 0.02;
    if (kind === 'ringback') beep(425, now, 1, 0.12);
    else { beep(880, now, 0.35, 0.22); beep(660, now + 0.45, 0.35, 0.22); }
  };
  once();
  const timer = setInterval(once, kind === 'ringback' ? 3000 : 2000);
  return () => {
    clearInterval(timer);
    ctx.close().catch(() => {});
  };
}

const clock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

async function microphone() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (error) {
    const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    throw new Error(blocked ? 'Allow the microphone for this site to make calls (check your browser’s site settings).' : 'No microphone found on this device.');
  }
}

// ---------------------------------------------------------------- the call screen and its logic (once per page)
export default function CallManager() {
  const { customer, socket } = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const [call, setCall] = useState(null); // { phase, callId, sig, from, to, peer, role, iceServers, text, startedAt }
  const [muted, setMuted] = useState(false);
  const [, tick] = useState(0);
  const callRef = useRef(null);
  const pc = useRef(null);
  const mic = useRef(null);
  const pendingIce = useRef([]);
  const stopTone = useRef(() => {});
  const timers = useRef([]);
  const audio = useRef(null);
  const handlers = useRef({});

  const update = (next) => {
    callRef.current = typeof next === 'function' ? next(callRef.current) : next;
    setCall(callRef.current);
  };
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const send = (kind, extra = {}) => {
    const current = callRef.current;
    if (!current || !socket) return;
    socket.emit('call:signal', { callId: current.callId, sig: current.sig, from: current.from, to: current.to, kind, device: DEVICE, ...extra });
  };
  const cleanup = () => {
    stopTone.current();
    stopTone.current = () => {};
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (pc.current) {
      pc.current.onicecandidate = null;
      pc.current.ontrack = null;
      pc.current.onconnectionstatechange = null;
      pc.current.close();
      pc.current = null;
    }
    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;
    pendingIce.current = [];
    if (audio.current) audio.current.srcObject = null;
    setMuted(false);
  };
  // the call is over: show why for a moment, then close the screen
  const finish = (text) => {
    cleanup();
    if (!callRef.current) return;
    update((current) => ({ ...current, phase: 'ended', text }));
    const callId = callRef.current.callId;
    setTimeout(() => { if (callRef.current?.callId === callId) update(null); }, 2600);
  };

  const connect = () => {
    const current = callRef.current;
    const peer = new RTCPeerConnection({ iceServers: current.iceServers });
    pc.current = peer;
    mic.current.getTracks().forEach((track) => peer.addTrack(track, mic.current));
    peer.onicecandidate = (event) => { if (event.candidate) send('ice', { data: event.candidate.toJSON() }); };
    peer.ontrack = (event) => {
      if (audio.current) {
        audio.current.srcObject = event.streams[0];
        audio.current.play().catch(() => {});
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected' && callRef.current?.phase !== 'active') {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        update((value) => ({ ...value, phase: 'active', startedAt: Date.now() }));
      }
      if (peer.connectionState === 'failed') {
        send('end', { reason: 'failed' });
        finish('Couldn’t connect the call. Try again, or use the phone number.');
      }
    };
    // no voice path after 25 s (very strict networks): stop instead of hanging
    later(() => {
      if (callRef.current && callRef.current.phase === 'connecting') {
        send('end', { reason: 'failed' });
        finish('Couldn’t connect the call. Try again, or use the phone number.');
      }
    }, 25000);
    return peer;
  };
  const flushIce = async () => {
    const list = pendingIce.current;
    pendingIce.current = [];
    for (const candidate of list) await pc.current?.addIceCandidate(candidate).catch(() => {});
  };

  // ----- I call someone
  // person: { _id, name } a seller · { task, name } the rider / buyer on a delivery under way
  const start = async (person) => {
    if (!person?._id && !person?.task) return;
    if (!customer) {
      toast('Log in to call sellers in the app', { icon: '📞' });
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (callRef.current) return toast('You’re already on a call');
    if (!canCall()) return toast.error('This browser can’t make calls. Use the phone number instead.');
    if (!socket?.connected) return toast.error('You’re offline. Check your connection and try again.');
    update({ phase: 'starting', peer: person, role: 'caller' });
    try {
      mic.current = await microphone(); // asks for the microphone now, while the tap still counts
    } catch (error) {
      update(null);
      return toast.error(error.message);
    }
    const reply = await new Promise((resolve) => {
      const giveUp = setTimeout(() => resolve({ error: 'The call couldn’t start. Please try again.' }), 10000);
      socket.emit('call:start', person.task ? { task: person.task } : { to: person._id }, (answer) => { clearTimeout(giveUp); resolve(answer || {}); });
    });
    if (reply.error) {
      cleanup();
      update(null);
      return toast(reply.error, { icon: reply.offline ? '⚪' : '⚠️', duration: 6000 });
    }
    update({ phase: 'outgoing', callId: reply.callId, sig: reply.sig, from: reply.from, to: reply.to, peer: { ...person, ...reply.callee }, role: 'caller', iceServers: reply.iceServers, offline: !!reply.offline, reach: reply.reach });
    stopTone.current = playTone('ringback');
    later(() => {
      if (callRef.current?.phase === 'outgoing') {
        send('end', { reason: 'no-answer' });
        finish(`${firstName(callRef.current.peer.name)} didn’t answer. We’ve let them know you called; try a chat message too.`);
      }
    }, (reply.waitSeconds || RING_SECONDS) * 1000);
  };

  // ----- someone calls me
  const incoming = (data) => {
    if (callRef.current?.callId === data.callId) return; // the same call again (I reconnected while it rang)
    if (callRef.current) { // already on a call: "busy"
      socket.emit('call:signal', { callId: data.callId, sig: data.sig, from: data.from, to: data.to, kind: 'busy', device: DEVICE });
      return;
    }
    update({ phase: 'incoming', callId: data.callId, sig: data.sig, from: data.from, to: data.to, peer: data.caller, role: 'callee', iceServers: data.iceServers });
    stopTone.current = playTone('ringtone');
    if ('vibrate' in navigator) navigator.vibrate?.([400, 200, 400, 200, 400]);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(`📞 ${data.caller.name} is calling`, { body: 'Open Kapu to answer', tag: `call-${data.callId}` }); } catch { /* not allowed here */ }
    }
    later(() => { if (callRef.current?.phase === 'incoming') finish('Missed call'); }, (RING_SECONDS + 5) * 1000);
  };
  const accept = async () => {
    stopTone.current();
    try {
      mic.current = await microphone();
    } catch (error) {
      send('decline');
      toast.error(error.message);
      return finish('Call declined');
    }
    update((current) => ({ ...current, phase: 'connecting' }));
    connect();
    send('accept');
  };
  const decline = () => {
    send('decline');
    finish('Call declined');
  };
  const hangUp = () => {
    const phase = callRef.current?.phase;
    send('end', { reason: phase === 'outgoing' ? 'cancelled' : 'hangup' });
    finish(phase === 'outgoing' ? 'Call cancelled' : 'Call ended');
  };
  const toggleMute = () => {
    const next = !muted;
    mic.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  // ----- messages from the other side
  const signal = async (message) => {
    const current = callRef.current;
    if (!current || message.callId !== current.callId) return;
    const name = firstName(current.peer?.name);
    try {
      switch (message.kind) {
        case 'taken': // I answered / declined on another tab or phone
          if (message.device !== DEVICE && current.phase === 'incoming') { cleanup(); update(null); }
          break;
        case 'accept': {
          if (current.role !== 'caller' || current.phase !== 'outgoing') break;
          stopTone.current();
          timers.current.forEach(clearTimeout);
          timers.current = [];
          update((value) => ({ ...value, phase: 'connecting' }));
          const peer = connect();
          const offer = await peer.createOffer({ offerToReceiveAudio: true });
          await peer.setLocalDescription(offer);
          send('offer', { data: { type: offer.type, sdp: offer.sdp } });
          break;
        }
        case 'offer': {
          if (!pc.current) break;
          await pc.current.setRemoteDescription(message.data);
          await flushIce();
          const answer = await pc.current.createAnswer();
          await pc.current.setLocalDescription(answer);
          send('answer', { data: { type: answer.type, sdp: answer.sdp } });
          break;
        }
        case 'answer':
          if (!pc.current) break;
          await pc.current.setRemoteDescription(message.data);
          await flushIce();
          break;
        case 'ice':
          if (pc.current?.remoteDescription) await pc.current.addIceCandidate(message.data).catch(() => {});
          else pendingIce.current.push(message.data);
          break;
        case 'decline':
          finish(`${name} can’t take the call right now. Try a chat message.`);
          break;
        case 'busy':
          finish(`${name} is on another call. Try again in a few minutes.`);
          break;
        case 'end':
          finish(current.phase === 'incoming' ? 'Missed call' : message.reason === 'failed' ? 'Couldn’t connect the call' : 'Call ended');
          break;
        default:
      }
    } catch {
      send('end', { reason: 'failed' });
      finish('Couldn’t connect the call. Try again, or use the phone number.');
    }
  };
  handlers.current = { start, incoming, signal };

  useEffect(() => {
    if (!socket) return undefined;
    const onIncoming = (data) => handlers.current.incoming(data);
    const onSignal = (message) => handlers.current.signal(message);
    socket.on('call:incoming', onIncoming);
    socket.on('call:signal', onSignal);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:signal', onSignal);
    };
  }, [socket]);
  useEffect(() => {
    const onStart = (event) => handlers.current.start(event.detail);
    window.addEventListener('os:call', onStart);
    // closing the tab ends the call for the other person too
    const onLeave = () => { if (callRef.current && callRef.current.phase !== 'ended') send('end', { reason: callRef.current.phase === 'outgoing' ? 'cancelled' : 'hangup' }); };
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('os:call', onStart);
      window.removeEventListener('pagehide', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);
  // logged out mid-call
  useEffect(() => {
    if (!customer && callRef.current) { cleanup(); update(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // the call timer
  useEffect(() => {
    if (call?.phase !== 'active') return undefined;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [call?.phase]);

  const status = !call ? '' : {
    starting: 'Getting your microphone ready…',
    outgoing: !call.offline ? 'Calling… ringing on their phone' : call.reach === 'push' ? 'Offline: ringing their phone, waiting for them to open the app…' : 'Offline: waiting for them to come online…',
    incoming: 'is calling you',
    connecting: 'Connecting…',
    active: clock(Date.now() - (call.startedAt || Date.now())),
    ended: call.text,
  }[call.phase];

  return (
    <>
      <audio ref={audio} autoPlay playsInline />
      {call && createPortal(
        <div className={`os os-call-wrap ${call.phase}`}>
          <div className="os-call" role="dialog" aria-modal="false" aria-label={`Call with ${call.peer?.name || 'seller'}`}>
            <div className="os-call-who">
              <span className={`os-call-avatar ${['outgoing', 'incoming'].includes(call.phase) ? 'ringing' : ''}`} aria-hidden="true">
                {call.peer?.avatar ? <img src={imgUrl(call.peer.avatar)} alt="" /> : (call.peer?.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <div>
                <b>{call.peer?.name || 'Seller'}</b>
                <span className="os-call-status" aria-live="polite">{status}</span>
                {call.phase !== 'ended' && <small className="os-call-tag">📞 In-app call · free over the internet</small>}
              </div>
            </div>
            <div className="os-call-actions">
              {call.phase === 'incoming' ? (
                <>
                  <button type="button" className="os-call-btn decline" onClick={decline} aria-label="Decline"><PhoneIcon down /><span>Decline</span></button>
                  <button type="button" className="os-call-btn accept" onClick={accept} aria-label="Answer"><PhoneIcon /><span>Answer</span></button>
                </>
              ) : call.phase === 'ended' ? (
                <button type="button" className="os-call-btn close" onClick={() => update(null)}><span>Close</span></button>
              ) : (
                <>
                  {['connecting', 'active'].includes(call.phase) && (
                    <button type="button" className={`os-call-btn mute ${muted ? 'on' : ''}`} onClick={toggleMute} aria-pressed={muted}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />{muted && <path d="M3 3l18 18" />}</svg>
                      <span>{muted ? 'Unmute' : 'Mute'}</span>
                    </button>
                  )}
                  <button type="button" className="os-call-btn decline" onClick={hangUp} disabled={call.phase === 'starting'} aria-label="End call"><PhoneIcon down /><span>End</span></button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function PhoneIcon({ down = false }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={down ? { transform: 'rotate(135deg)' } : undefined}>
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </svg>
  );
}

// ---------------------------------------------------------------- contacts on a delivery (rider ↔ buyer)
// Shown only once the rider has accepted the job. One tap reveals the number (tap to call), WhatsApp and a free
// in-app call. who: 'rider' (the buyer sees their rider) or 'buyer' (the rider sees who they deliver to).
export function RideContact({ task, name, phone, who = 'rider', className = '' }) {
  const [open, setOpen] = useState(false);
  if (!phone && !task) return null;
  const label = who === 'rider' ? 'Rider’s contacts' : who === 'customer' ? 'Customer’s contacts' : who === 'seller' ? 'Seller’s contacts' : 'Buyer’s contacts';
  if (!open) {
    return (
      <button type="button" className={`os-btn mk-show-number mk-ride-contact-show ${className}`} onClick={() => setOpen(true)} aria-expanded="false">
        📞 {label}
      </button>
    );
  }
  const wa = String(phone || '').replace(/\D/g, '');
  return (
    <span className={`mk-contact inline mk-ride-contact ${className}`} aria-label={`${label}${name ? `: ${name}` : ''}`}>
      {name && <b className="mk-ride-contact-name">{who === 'rider' ? '🏍️' : who === 'seller' ? '🏪' : '👤'} {name}</b>}
      {phone && <a className="os-btn mk-contact-num" href={`tel:+${phone}`}>📞 {prettyPhone(phone)}</a>}
      {wa && <a className="os-btn mk-contact-wa" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
      {task && canCall() && (
        <button type="button" className="os-btn mk-call-btn online" onClick={() => startCall({ task, name })} title="Free call over the internet, in the app">
          <span className="mk-call-dot" aria-hidden="true" />📞 Call in app
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- the button
// person: { _id, name, avatar? }. Works online or offline; the dot shows which (green: answers now · grey: we ring their phone).
export function CallButton({ person, compact = false, className = '' }) {
  const { customer } = useShop();
  const presence = usePresence(person?._id);
  if (!person?._id || String(customer?._id) === String(person._id) || !canCall()) return null;
  const online = !!presence?.online;
  return (
    <button
      type="button"
      className={`os-btn mk-call-btn ${online ? 'online' : 'offline'} ${compact ? 'compact' : ''} ${className}`}
      onClick={() => startCall(person)}
      title={online ? `${firstName(person.name)} is online: call in the app (free over the internet)` : `${firstName(person.name)} is offline: we’ll ring their phone and wait a minute for them to answer`}
      aria-label={`Call ${person.name} in the app${online ? '' : ' (offline: rings their phone)'}`}
    >
      <span className="mk-call-dot" aria-hidden="true" />📞 Call in app
    </button>
  );
}
