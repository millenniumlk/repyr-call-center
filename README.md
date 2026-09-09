# Repyr WebRTC Call Center

A full-stack, browser-to-browser audio call center where agents initiate calls from a desktop dashboard and customers receive a WhatsApp invitation that opens a mobile-optimized call page in their browser.

**WebRTC** handles all audio. **WhatsApp** is only the invitation delivery channel.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Call Lifecycle](#call-lifecycle)
3. [WebRTC Signaling — Deep Dive](#webrtc-signaling--deep-dive)
4. [SDP Offer / Answer Flow](#sdp-offer--answer-flow)
5. [ICE and STUN / TURN](#ice-and-stun--turn)
6. [Socket.io Events](#socketio-events)
7. [WhatsApp Integration](#whatsapp-integration)
8. [Project Structure](#project-structure)
9. [Environment Variables](#environment-variables)
10. [Local Development](#local-development)
11. [Production Deployment](#production-deployment)
12. [Security Considerations](#security-considerations)
13. [Mobile Browser Requirements](#mobile-browser-requirements)
14. [Troubleshooting](#troubleshooting)
15. [Future Enhancements](#future-enhancements)

---

## Architecture Overview

```
┌──────────────────────────┐
│    Repyr Agent Portal    │    React + Vite + Tailwind
│    /dashboard            │    Desktop browser
└────────────┬─────────────┘
             │ Socket.io (signaling only)
             │ REST (call management)
             ▼
┌──────────────────────────┐
│   Node.js + Express      │    Call session management
│   Socket.io Server       │    WebRTC signaling relay
│   WhatsApp Cloud API     │    Invitation delivery
└───────┬───────────┬──────┘
        │           │
 WhatsApp API       │ Socket.io (signaling)
        │           │
        ▼           ▼
Customer WhatsApp   Customer Browser
                       │
                       │ WebRTC P2P Audio
                       ▼
                  Agent Browser
```

**Key principle:** Audio flows directly between browsers via WebRTC (peer-to-peer). The server only handles:
- Call session management (REST API)
- WebRTC signaling (SDP, ICE candidates) via Socket.io
- WhatsApp invitation delivery

---

## Call Lifecycle

```
AGENT                    SERVER                   CUSTOMER
  │                        │                          │
  │── POST /api/calls ────▶│                          │
  │◀─ { callId, callUrl } ─│                          │
  │                        │── WhatsApp message ─────▶│ (customer's phone)
  │                        │                          │
  │── socket: agent-join ─▶│                          │
  │   (joins room)         │                          │
  │                        │         ┌── opens callUrl ──────┘
  │                        │         │
  │                        │◀─ GET /api/calls/token/:token
  │                        │─▶ { valid: true, callId }
  │                        │                          │
  │                        │◀─ socket: call:join ─────│
  │                        │   (token validated)      │
  │◀─ call:customer-joined ─│                          │
  │                        │                          │
  │── createOffer() ───────┤                          │
  │── webrtc:offer ───────▶│── webrtc:offer ─────────▶│
  │                        │                          │── createAnswer()
  │                        │◀─ webrtc:answer ──────────│
  │◀─ webrtc:answer ────────│                          │
  │                        │                          │
  │◀═══ webrtc:ice-candidate (trickle, both ways) ════▶│
  │                        │                          │
  │◀══════════════ P2P AUDIO CONNECTED ══════════════▶│
  │                        │                          │
```

### Status Progression

| Status | Meaning |
|--------|---------|
| `CREATED` | Session created, token generated |
| `INVITATION_SENT` | WhatsApp message sent (or mock) |
| `WAITING` | Agent ready, waiting for customer |
| `CUSTOMER_OPENED` | Customer opened the call URL |
| `CUSTOMER_ANSWERING` | Customer tapped Answer |
| `CONNECTING` | SDP exchange in progress |
| `CONNECTED` | WebRTC audio connected |
| `ENDED` | Call finished, token invalidated |

---

## WebRTC Signaling — Deep Dive

WebRTC requires a **signaling channel** to exchange metadata before the peer-to-peer connection can be established. In this project, Socket.io is that signaling channel.

**Important:** Socket.io carries only signaling data (text JSON). Audio NEVER passes through the server.

### Why signaling is needed

WebRTC peers need to agree on:
1. **What media** they'll exchange (codecs, direction) → via SDP
2. **How to reach each other** (IP addresses, ports) → via ICE candidates

Once this exchange is complete, browsers connect directly.

---

## SDP Offer / Answer Flow

SDP (Session Description Protocol) is a text format describing media capabilities.

**Agent creates offer:**
```js
const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
await peerConnection.setLocalDescription(offer);
socket.emit('webrtc:offer', { callId, sdp: peerConnection.localDescription });
```

**Customer receives offer, creates answer:**
```js
await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
const answer = await peerConnection.createAnswer();
await peerConnection.setLocalDescription(answer);
socket.emit('webrtc:answer', { callId, sdp: peerConnection.localDescription });
```

**Agent receives answer:**
```js
await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
// ICE negotiation begins...
```

---

## ICE and STUN / TURN

### What is ICE?

ICE (Interactive Connectivity Establishment) is the process WebRTC uses to find the best network path between two browsers.

ICE candidates are potential network addresses:
- **host** — local IP (works on same network)
- **srflx** (server reflexive) — public IP found via STUN (works most of the time)
- **relay** — TURN server IP (works always, even through strict NAT/firewalls)

### STUN

STUN (Session Traversal Utilities for NAT) tells each browser its public IP address.

```
Browser → STUN server → "Your public IP is 203.0.113.42:54321"
```

This project uses Google's public STUN server by default: `stun:stun.l.google.com:19302`

### TURN

TURN (Traversal Using Relays around NAT) relays audio when peer-to-peer isn't possible.

```
Browser A → TURN server → Browser B
```

TURN is required when both peers are behind symmetric NAT (common on mobile networks and enterprise firewalls).

**For production reliability, deploy a TURN server.** Options:
- Self-hosted: [Coturn](https://github.com/coturn/coturn)
- Managed: [Metered.ca](https://www.metered.ca/tools/openrelay/), [Twilio NTS](https://www.twilio.com/stun-turn)

### Trickle ICE

Instead of waiting for all candidates to be gathered, trickle ICE sends each candidate as it's discovered:

```js
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit('webrtc:ice-candidate', { callId, candidate: event.candidate });
  }
};
```

---

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `call:agent-join` | `{ callId }` | Agent announces readiness |
| `call:join` | `{ token }` | Customer joins via secret token |
| `call:accepted` | `{ callId }` | Customer tapped Answer |
| `call:declined` | `{ callId }` | Customer tapped Decline |
| `webrtc:offer` | `{ callId, sdp }` | Agent sends SDP offer |
| `webrtc:answer` | `{ callId, sdp }` | Customer sends SDP answer |
| `webrtc:ice-candidate` | `{ callId, candidate }` | Trickle ICE (both) |
| `call:connected` | `{ callId }` | WebRTC connected confirmation |
| `call:hangup` | `{ callId }` | Either side hangs up |
| `call:mute` | `{ callId, muted }` | Mute state sync |

### Server → Client

| Event | Payload | Recipients |
|-------|---------|------------|
| `call:customer-joined` | `{ callId }` | Agent |
| `call:ready` | `{ callId }` | Customer |
| `call:accepted` | `{ callId }` | Agent |
| `webrtc:offer` | `{ callId, sdp }` | Customer |
| `webrtc:answer` | `{ callId, sdp }` | Agent |
| `webrtc:ice-candidate` | `{ callId, candidate }` | Other peer |
| `call:connected` | `{ callId }` | Both |
| `call:ended` | `{ callId, reason }` | Both |
| `call:mute` | `{ callId, muted, role }` | Other peer |
| `call:error` | `{ callId, message }` | Originating socket |

---

## WhatsApp Integration

### How it works

1. Agent clicks "Call Customer" in the dashboard
2. Backend generates a secure call token and URL: `https://app.repyr.com/c/<token>`
3. Backend calls Meta WhatsApp Cloud API with a pre-approved template message
4. Customer receives a WhatsApp message with an "Answer Call" button
5. Customer taps the button → mobile browser opens the Repyr call page
6. Customer taps Answer → WebRTC connects

### Template requirement

Meta requires pre-approved message templates for business-initiated messages. You must:

1. Create a template in Meta Business Manager → WhatsApp → Message Templates
2. The template should contain a Call-to-Action button with type "url" and a dynamic URL suffix
3. Submit for approval (typically 24–48 hours)
4. Set `WHATSAPP_TEMPLATE_NAME` to your approved template name

### Mock mode

Set `MOCK_WHATSAPP=true` in backend `.env` to skip the WhatsApp API call during development. The backend will log the call URL to the console, and the agent dashboard will show an "Open Customer Call" button.

---

## Project Structure

```
repyr-webrtc-call-center/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/Button.jsx          # Reusable button
│   │   │   ├── CallStatusBadge.jsx    # Animated status indicator
│   │   │   ├── DebugPanel.jsx         # Dev-only WebRTC diagnostics
│   │   │   └── RepyrLogo.jsx          # Brand logo component
│   │   ├── hooks/
│   │   │   └── useWebRTC.js           # Core WebRTC hook (reusable)
│   │   ├── lib/
│   │   │   └── socket.js              # Socket.io singleton
│   │   ├── pages/
│   │   │   ├── AgentDashboard.jsx     # /dashboard
│   │   │   └── CustomerCall.jsx       # /c/:token
│   │   ├── services/
│   │   │   └── api.js                 # REST API client
│   │   ├── styles/
│   │   │   └── index.css              # Tailwind base
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   └── callController.js      # HTTP route handlers
│   │   ├── middleware/
│   │   │   ├── rateLimiter.js         # express-rate-limit
│   │   │   └── validatePhone.js       # E.164 validation
│   │   ├── routes/
│   │   │   └── calls.js               # Express router
│   │   ├── services/
│   │   │   ├── callSessionService.js  # In-memory call store
│   │   │   └── whatsappService.js     # Meta Cloud API client
│   │   ├── socket/
│   │   │   └── callSignaling.js       # Socket.io event handlers
│   │   └── utils/
│   │       └── tokenUtils.js          # Crypto token generation
│   ├── server.js
│   ├── .env.example
│   └── package.json
│
└── README.md
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Server
PORT=3001
NODE_ENV=development

# CORS — set to your frontend URL
FRONTEND_URL=http://localhost:5173

# Base URL used to build customer call links
# In production: https://app.repyr.com
BASE_CALL_URL=http://localhost:5173

# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=           # System user permanent token
WHATSAPP_PHONE_NUMBER_ID=        # From Meta Business Manager
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_TEMPLATE_NAME=repyr_call_invite
WHATSAPP_TEMPLATE_LANGUAGE=en_US

# Set to true to skip real WhatsApp API calls during development
MOCK_WHATSAPP=true

# WebRTC ICE servers
WEBRTC_STUN_URL=stun:stun.l.google.com:19302
WEBRTC_TURN_URL=                 # e.g. turn:turn.example.com:3478
WEBRTC_TURN_USERNAME=
WEBRTC_TURN_CREDENTIAL=
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001

# Optional: override default STUN/TURN
VITE_STUN_URL=stun:stun.l.google.com:19302
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

---

## Local Development

### Prerequisites

- Node.js 18+
- npm 9+

### Start the backend

```bash
cd backend
npm install
# Copy example env
cp .env.example .env
# Edit .env — set MOCK_WHATSAPP=true for development
npm run dev
```

Backend runs on `http://localhost:3001`

### Start the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend runs on `http://localhost:5173`

### Test the WebRTC flow (Milestone 1)

1. Open `http://localhost:5173/dashboard` in Chrome (Agent)
2. Enter any phone number (e.g., `+971501234567`)
3. Click **Call Customer**
4. In Mock Mode, a yellow panel shows the customer URL
5. Click **Open Customer Call** (or copy URL to another tab/device)
6. Customer page shows the incoming call screen
7. Click **Answer** — browser requests microphone
8. Both sides should connect
9. Test Mute and Hang Up

### Testing on a real mobile device

WebRTC requires HTTPS except on `localhost`. To test on a phone:

**Option A: Use ngrok**
```bash
# Install ngrok, then:
ngrok http 5173
# Use the https:// ngrok URL on your phone
```

**Option B: Local HTTPS with mkcert**
```bash
npm install -g mkcert
mkcert create-ca
mkcert create-cert
# Configure Vite to use the certificate
```

---

## Production Deployment

### Backend — Railway / Render / VPS

1. Push to your git repo
2. Set all environment variables (especially `NODE_ENV=production`, real WhatsApp credentials, `FRONTEND_URL`)
3. Start command: `node server.js`
4. Ensure the server supports WebSockets (most platforms do)

### Frontend — Vercel / Netlify

1. Set `VITE_API_URL` and `VITE_SOCKET_URL` to your backend URL
2. Build command: `npm run build`
3. Output directory: `dist`
4. For Vercel, add a `vercel.json` to handle client-side routing:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### TURN Server for Production

For production mobile reliability, deploy Coturn:

```bash
# Ubuntu
apt-get install coturn

# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=turn.yourserver.com
server-name=turn.yourserver.com
lt-cred-mech
use-auth-secret
static-auth-secret=YOUR_STRONG_SECRET
cert=/etc/ssl/cert.pem
pkey=/etc/ssl/key.pem
```

Then set in backend `.env`:
```
WEBRTC_TURN_URL=turn:turn.yourserver.com:3478
WEBRTC_TURN_USERNAME=<time-based>
WEBRTC_TURN_CREDENTIAL=<hmac-sha1>
```

---

## Security Considerations

| Concern | Implementation |
|---------|---------------|
| Token entropy | `crypto.randomBytes(32)` — 256-bit entropy |
| Token TTL | 5 minutes (extended to 4h while connected) |
| Token invalidation | Immediately on call end |
| Session enumeration | callId never trusted from client; resolved server-side from token |
| Rate limiting | POST /api/calls: 10/min; token validation: 30/min |
| CORS | Explicit allowlist; no wildcard |
| WhatsApp token | Server-side only, never in API responses |
| TURN credentials | Not included in client responses; configured via env |
| Input validation | E.164 phone validation; token format check |
| Room isolation | Socket.io rooms per callId; cross-call forwarding prevented |

---

## Mobile Browser Requirements

WebRTC audio calling works on:

| Browser | Platform | Support |
|---------|----------|---------|
| Safari 14+ | iOS 14+ | ✅ Full support |
| Chrome 80+ | Android | ✅ Full support |
| Firefox 78+ | Android | ✅ Full support |
| Chrome 80+ | Desktop | ✅ Full support |
| Safari 14+ | macOS | ✅ Full support |

**Requirements:**
- HTTPS (or localhost for development)
- Microphone permission granted by user
- JavaScript enabled

**iOS notes:**
- Safari is the only browser with full WebRTC support on iOS
- `playsInline` must be set on audio elements
- Autoplay requires prior user gesture (satisfied by the Answer button tap)

---

## Troubleshooting

### "ICE connection failed"
- Usually a NAT/firewall issue
- Add a TURN server (see [Production Deployment](#production-deployment))
- Check that UDP ports 3478, 49152–65535 are open on firewall

### "Microphone permission denied"
- User denied permission — show UI to guide them to browser settings
- On iOS, microphone access requires HTTPS

### Customer hears agent but agent can't hear customer
- ICE asymmetry — one candidate pair succeeded one way
- Usually fixed with a TURN server

### Socket disconnects mid-call
- Check server health endpoint: `GET /health`
- Ensure WebSocket connections are kept alive (no proxy timeouts < call duration)
- Set proxy timeout to > 1 hour for long calls

### WhatsApp API error 131030
- Template not found or not approved
- Verify `WHATSAPP_TEMPLATE_NAME` matches exactly in Meta Business Manager

### "Call invitation expired" immediately
- The token TTL of 5 minutes may have elapsed
- Check server clock is correct
- Increase `INVITATION_TTL_MS` in `callSessionService.js` if needed

---

## Future Enhancements

| Feature | Priority | Notes |
|---------|----------|-------|
| Redis session store | High | Replace in-memory Map for multi-server deployments |
| Agent authentication | High | JWT or session-based auth for the dashboard |
| Call recording | Medium | MediaRecorder API or server-side mixing |
| Short-lived TURN credentials | Medium | HMAC-SHA1 time-based credentials (more secure) |
| Call history / analytics | Medium | Requires database (PostgreSQL recommended) |
| Multi-agent queue | Medium | Queue incoming calls, assign to available agents |
| CRM integration | Low | Link calls to customer records |
| AI transcription | Low | Whisper or Google Speech-to-Text post-call |
| Video support | Low | Add `offerToReceiveVideo: true` to RTCPeerConnection |
| Native mobile app | Low | React Native with react-native-webrtc |
