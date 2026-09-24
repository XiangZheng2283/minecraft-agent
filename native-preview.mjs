import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RTCPeerConnection, MediaStreamTrack, useH264 } from 'werift';

const httpPort = Number(process.env.NATIVE_PREVIEW_PORT || 25590);
const rtpPort = Number(process.env.NATIVE_PREVIEW_RTP_PORT || 25592);
const control = path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-client', 'preview-rtp.txt');
const viewers = new Set();

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Native client live view</title>
<style>html,body{margin:0;height:100%;background:#111;color:#aaa;font:13px sans-serif}body{display:flex;flex-direction:column}
video{flex:1;min-height:0;width:100%;object-fit:contain;background:#000}p{margin:4px 8px}</style></head>
<body><video id="v" autoplay muted playsinline></video><p id="s">connecting...</p>
<script>
const v = document.getElementById('v'), s = document.getElementById('s');
let pc, retry;
const log = (msg) => { s.textContent = msg; console.log('[live view]', msg); };
function again(msg) { log(msg + ' · retrying...'); clearTimeout(retry); retry = setTimeout(connect, 3000); }
async function connect() {
  clearTimeout(retry);
  try {
    if (typeof RTCPeerConnection === 'undefined') return log('WebRTC is disabled in this browser (policy or extension)');
    pc?.close();
    const conn = pc = new RTCPeerConnection();
    const transceiver = conn.addTransceiver('video', { direction: 'recvonly' });
    if ('jitterBufferTarget' in transceiver.receiver) transceiver.receiver.jitterBufferTarget = 0;
    conn.ontrack = (e) => { v.srcObject = new MediaStream([e.track]); v.play().catch(() => {}); };
    conn.onconnectionstatechange = () => {
      if (conn !== pc) return;
      log(conn.connectionState + ' (ice ' + conn.iceConnectionState + ')');
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') again('connection ' + conn.connectionState);
    };
    log('creating offer...');
    await conn.setLocalDescription(await conn.createOffer());
    await new Promise((resolve) => {
      if (conn.iceGatheringState === 'complete') return resolve();
      conn.onicegatheringstatechange = () => conn.iceGatheringState === 'complete' && resolve();
      setTimeout(resolve, 1500);
    });
    const candidates = (conn.localDescription.sdp.match(/a=candidate/g) || []).length;
    log('sending offer (' + candidates + ' ICE candidates)...');
    const res = await fetch('/offer', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: conn.localDescription.sdp, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('server answered HTTP ' + res.status);
    await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    log('answer received, connecting (' + candidates + ' local candidates)...');
    setTimeout(() => { if (conn === pc && conn.connectionState !== 'connected') again('ICE did not connect (' + conn.iceConnectionState + ', ' + candidates + ' local candidates)'); }, 10000);
  } catch (e) { again((e.name || 'Error') + ': ' + e.message); }
}
setInterval(async () => {
  const stats = await pc?.getStats();
  stats?.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'video' && r.framesDecoded) {
      const delay = r.jitterBufferEmittedCount ? Math.round(1000 * r.jitterBufferDelay / r.jitterBufferEmittedCount) : 0;
      s.textContent = pc.connectionState + ' · ' + (r.framesPerSecond || 0) + ' fps · ' + r.frameWidth + 'x' + r.frameHeight + ' · jitter buffer ' + delay + ' ms';
    }
  });
}, 1000);
connect();
</script></body></html>`;

// The native client polls this file and only encodes while it is fresh.
function syncControl() {
  if (viewers.size) fs.writeFileSync(control, String(rtpPort));
  else fs.rmSync(control, { force: true });
}
setInterval(syncControl, 2000).unref();

// Windows defaults to a 64 KB receive buffer, which a single keyframe burst overflows.
const rtp = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 * 1024 * 1024 });
let lastSeq = -1, gaps = 0;
rtp.on('message', (packet) => {
  const seq = packet.readUInt16BE(2);
  if (lastSeq >= 0 && seq !== ((lastSeq + 1) & 0xffff)) gaps++;
  lastSeq = seq;
  for (const { track } of viewers) track.writeRtp(packet);
});
rtp.bind(rtpPort, '127.0.0.1');
if (process.env.NATIVE_PREVIEW_DEBUG) setInterval(() => console.log(`rtp gaps ${gaps}`), 1000).unref();

async function answer(sdp) {
  const pc = new RTCPeerConnection({ codecs: { video: [useH264()] }, iceAdditionalHostAddresses: ['127.0.0.1'], iceUseIpv6: false });
  const track = new MediaStreamTrack({ kind: 'video' });
  pc.addTransceiver(track, { direction: 'sendonly' });
  const viewer = { pc, track };
  pc.connectionStateChange.subscribe((state) => {
    if (state === 'connected') { viewers.add(viewer); syncControl(); console.log(`viewer connected (${viewers.size})`); }
    if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      if (viewers.delete(viewer)) console.log(`viewer left (${viewers.size})`);
      syncControl();
      if (state !== 'closed') pc.close();
    }
  });
  setTimeout(() => { if (!viewers.has(viewer) && pc.connectionState !== 'closed') pc.close(); }, 15_000).unref();
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  return pc.localDescription.sdp;
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
  } else if (req.method === 'POST' && req.url === '/offer') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; if (body.length > 100_000) req.destroy(); });
    req.on('end', () => answer(body)
      .then((sdp) => res.writeHead(200, { 'Content-Type': 'application/sdp' }).end(sdp))
      .catch((e) => { console.error('offer failed:', e); res.writeHead(400).end(); }));
  } else {
    res.writeHead(404).end();
  }
}).listen(httpPort, '127.0.0.1', () => console.log(`Native live view: http://127.0.0.1:${httpPort}/ (RTP in on 127.0.0.1:${rtpPort})`));

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { fs.rmSync(control, { force: true }); process.exit(0); });
