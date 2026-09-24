package local.agentview;
import com.sun.net.httpserver.*;import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.*;
/**
 * Live view inside the Minecraft process: http://127.0.0.1:25590/ serves the page and answers WebRTC offers
 * (bind address from -Dagent.webrtcHost, default loopback).
 * Kept free of webrtc-java types so a missing native library only disables the stream, never the client.
 */
public class WebRtcServer {
 static volatile int viewers=0;
 static final FrameSink sink=new FrameSink("native-webrtc-video"){
  long interval(long now){return viewers>0?33_333_333L:0;}
  void consume(Frame f) throws Exception{WebRtcPeers.push(f);}
 };

 public static void start(){
  int port=Integer.getInteger("agent.webrtcPort",25590);
  if(port<=0)return;
  try{
   HttpServer http=HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(),port),16);
   http.createContext("/",WebRtcServer::handle);
   http.setExecutor(Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"native-webrtc-http");t.setDaemon(true);return t;}));
   http.start();
   System.out.println("Native view: live view at http://127.0.0.1:"+port+"/");
  }catch(IOException e){System.err.println("Native view: live view disabled, port "+port+" unavailable ("+e.getMessage()+")");}
 }

 static void handle(HttpExchange ex) throws IOException{
  try(ex){
   String path=ex.getRequestURI().getPath(),method=ex.getRequestMethod();
   if(method.equals("GET")&&path.equals("/"))reply(ex,200,"text/html; charset=utf-8",PAGE);
   else if(method.equals("GET")&&path.equals("/stats"))reply(ex,200,"application/json",stats());
   else if(method.equals("POST")&&path.equals("/offer")){
    byte[] body=ex.getRequestBody().readNBytes(100_001);
    if(body.length>100_000){reply(ex,413,"text/plain","offer too large");return;}
    try{reply(ex,200,"application/sdp",WebRtcPeers.answer(new String(body,StandardCharsets.UTF_8)));}
    catch(Throwable e){System.err.println("Native view: offer failed: "+e);reply(ex,500,"text/plain",String.valueOf(e));}
   }
   else reply(ex,404,"text/plain","not found");
  }
 }

 static String stats(){
  StringBuilder b=new StringBuilder("{\"viewers\":"+viewers+",\"poolEmpty\":"+FrameCapture.poolEmpty+",\"gpuNotReady\":"+FrameCapture.gpuNotReady+",\"sinks\":{");
  String sep="";
  for(FrameSink s:FrameCapture.sinks){b.append(sep).append('"').append(s.name).append("\":{\"consumed\":").append(s.consumed).append(",\"dropped\":").append(s.dropped).append(",\"maxGapMs\":").append(s.maxGapNanos/1_000_000).append('}');s.maxGapNanos=0;sep=",";}
  return b.append("}}").toString();
 }

 static void reply(HttpExchange ex,int status,String type,String text) throws IOException{
  byte[] out=text.getBytes(StandardCharsets.UTF_8);
  ex.getResponseHeaders().set("Content-Type",type);ex.getResponseHeaders().set("Cache-Control","no-store");
  ex.sendResponseHeaders(status,out.length);ex.getResponseBody().write(out);
 }

 static final String PAGE="""
<!doctype html><html><head><meta charset="utf-8"><title>Native client live view</title>
<style>html,body{margin:0;height:100%;background:#111;color:#aaa;font:13px sans-serif}body{display:flex;flex-direction:column}
video{flex:1;min-height:0;width:100%;object-fit:contain;background:#000}p{margin:4px 8px}</style></head>
<body><video id="v" autoplay muted playsinline></video><p id="s">connecting...</p>
<script>
const v = document.getElementById('v'), s = document.getElementById('s');
let pc, retry;
const log = (msg) => { s.textContent = msg; console.log('[live view]', msg); };
function again(msg) { log(msg + ' · retrying...'); clearTimeout(retry); retry = setTimeout(connect, 2000); }
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
      log(conn.connectionState);
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') again('connection ' + conn.connectionState);
    };
    await conn.setLocalDescription(await conn.createOffer());
    const res = await fetch('/offer', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: conn.localDescription.sdp, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('server answered HTTP ' + res.status + ': ' + await res.text());
    await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    setTimeout(() => { if (conn === pc && conn.connectionState !== 'connected') again('ICE did not connect (' + conn.iceConnectionState + ')'); }, 10000);
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
</script></body></html>
""";
}
