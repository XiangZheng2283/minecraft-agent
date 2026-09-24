package local.agentview;
import dev.onvoid.webrtc.*;import dev.onvoid.webrtc.media.FourCC;import dev.onvoid.webrtc.media.SyncClock;import dev.onvoid.webrtc.media.video.*;
import java.util.*;import java.util.concurrent.*;
/** webrtc-java peers; loaded on the first offer so the ~20 MB native library costs nothing until someone watches. */
final class WebRtcPeers {
 static PeerConnectionFactory factory;static CustomVideoSource source;static VideoTrack track;static SyncClock clock;
 static final Set<RTCPeerConnection> connected=ConcurrentHashMap.newKeySet();
 // Closing a peer from inside its own state callback can deadlock the signaling thread.
 static final ScheduledExecutorService closer=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"native-webrtc-close");t.setDaemon(true);return t;});

 static synchronized void init(){
  if(factory!=null)return;
  // The factory class loads the native library, so it must come before any other webrtc-java object.
  factory=new PeerConnectionFactory();clock=new SyncClock();source=new CustomVideoSource(clock);track=factory.createVideoTrack("minecraft",source);
 }

 static String answer(String offer) throws Exception{
  init();
  CompletableFuture<Void> gathered=new CompletableFuture<>();
  RTCPeerConnection[] self=new RTCPeerConnection[1];
  RTCPeerConnection pc=factory.createPeerConnection(new RTCConfiguration(),new PeerConnectionObserver(){
   public void onIceCandidate(RTCIceCandidate candidate){}
   public void onIceGatheringChange(RTCIceGatheringState state){if(state==RTCIceGatheringState.COMPLETE)gathered.complete(null);}
   public void onConnectionChange(RTCPeerConnectionState state){
    RTCPeerConnection p=self[0];if(p==null)return;
    if(state==RTCPeerConnectionState.CONNECTED){if(connected.add(p))changed();}
    else if(state==RTCPeerConnectionState.DISCONNECTED||state==RTCPeerConnectionState.FAILED||state==RTCPeerConnectionState.CLOSED){
     if(connected.remove(p))changed();
     if(state!=RTCPeerConnectionState.CLOSED)closer.execute(p::close);
    }
   }
  });
  self[0]=pc;
  try{
   await(done->pc.setRemoteDescription(new RTCSessionDescription(RTCSdpType.OFFER,withBitrate(offer)),done));
   // After the offer is applied, addTrack reuses the browser's recvonly transceiver instead of adding an m-line.
   RTCRtpSender sender=pc.addTrack(track,List.of("minecraft"));
   RTCSessionDescription[] answer=new RTCSessionDescription[1];
   CompletableFuture<Void> created=new CompletableFuture<>();
   pc.createAnswer(new RTCAnswerOptions(),new CreateSessionDescriptionObserver(){
    public void onSuccess(RTCSessionDescription d){answer[0]=d;created.complete(null);}
    public void onFailure(String error){created.completeExceptionally(new IllegalStateException(error));}
   });
   created.get(5,TimeUnit.SECONDS);
   await(done->pc.setLocalDescription(answer[0],done));
   RTCRtpSendParameters params=sender.getParameters();
   if(params.encodings!=null&&!params.encodings.isEmpty()){for(RTCRtpEncodingParameters e:params.encodings){e.maxBitrate=Integer.getInteger("agent.webrtcMaxKbps",6000)*1000;e.maxFramerate=60.0;}sender.setParameters(params);}
   // Host candidates only, so gathering finishes in milliseconds; the timeout covers odd adapters.
   try{gathered.get(1500,TimeUnit.MILLISECONDS);}catch(TimeoutException ignored){}
   closer.schedule(()->{if(!connected.contains(pc)&&pc.getConnectionState()!=RTCPeerConnectionState.CLOSED)pc.close();},15,TimeUnit.SECONDS);
   return pc.getLocalDescription().sdp;
  }catch(Exception e){closer.execute(pc::close);throw e;}
 }

 interface Call{void run(SetSessionDescriptionObserver done);}
 static void await(Call call) throws Exception{
  CompletableFuture<Void> f=new CompletableFuture<>();
  call.run(new SetSessionDescriptionObserver(){
   public void onSuccess(){f.complete(null);}
   public void onFailure(String error){f.completeExceptionally(new IllegalStateException(error));}
  });
  f.get(5,TimeUnit.SECONDS);
 }

 static void changed(){
  WebRtcServer.viewers=connected.size();
  System.out.println("Native view: "+connected.size()+" live viewer(s)");
 }

 static void push(Frame f) throws Exception{
  if(source==null)return;
  NativeI420Buffer buffer=NativeI420Buffer.allocate(f.width,f.height);
  // libyuv names formats by 32-bit word order, so OpenGL's R,G,B,A bytes are its ABGR.
  VideoBufferConverter.convertToI420(f.rgba,buffer,FourCC.ABGR);
  VideoFrame frame=new VideoFrame(buffer,clock.getTimestampUs()*1000);
  try{source.pushFrame(frame);}finally{frame.release();}
 }

 static final java.util.regex.Pattern VIDEO_CODEC=java.util.regex.Pattern.compile("a=rtpmap:(\\d+) (VP8|VP9|H264|AV1)/90000");
 // Loopback has spare bandwidth, but the congestion controller starts near 300 kbps and the encoder drops frames until it ramps up.
 // libwebrtc applies these codec parameters from the remote description to its own sending side.
 static String withBitrate(String sdp){
  String params="x-google-start-bitrate="+Integer.getInteger("agent.webrtcStartKbps",2500)+";x-google-min-bitrate="+Integer.getInteger("agent.webrtcMinKbps",1500)+";x-google-max-bitrate="+Integer.getInteger("agent.webrtcMaxKbps",6000);
  String[] lines=sdp.split("\r\n");Set<String> video=new HashSet<>(),withFmtp=new HashSet<>();
  for(String l:lines){java.util.regex.Matcher m=VIDEO_CODEC.matcher(l);if(m.matches())video.add(m.group(1));if(l.startsWith("a=fmtp:"))withFmtp.add(l.substring(7).split(" ",2)[0]);}
  StringBuilder out=new StringBuilder();
  for(String l:lines){
   java.util.regex.Matcher m=VIDEO_CODEC.matcher(l);
   if(l.startsWith("a=fmtp:")&&video.contains(l.substring(7).split(" ",2)[0]))l=l+";"+params;
   out.append(l).append("\r\n");
   if(m.matches()&&!withFmtp.contains(m.group(1)))out.append("a=fmtp:").append(m.group(1)).append(' ').append(params).append("\r\n");
  }
  return out.toString();
 }
}
