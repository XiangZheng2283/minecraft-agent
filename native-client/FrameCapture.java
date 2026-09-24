package local.agentview;
import java.nio.*;import java.nio.file.*;import java.io.*;import java.awt.image.BufferedImage;import javax.imageio.ImageIO;import java.util.*;import java.util.concurrent.*;
import org.lwjgl.opengl.*;import org.lwjgl.system.MemoryUtil;
public class FrameCapture {
 static final Path root=Paths.get(System.getProperty("agent.captureDir"));
 static final long SLACK=4_000_000L;
 static volatile String recordPath="";
 static final Recorder recorder=new Recorder();
 static final Snapshot snapshot=new Snapshot();
 static final FrameSink[] sinks={recorder,snapshot,PreviewStream.sink,WebRtcServer.sink};
 static {
  for(FrameSink s:sinks)s.start();
  ScheduledExecutorService control=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"native-capture-control");t.setDaemon(true);return t;});
  control.scheduleWithFixedDelay(()->{
   try{Path p=root.resolve("record-path.txt");recordPath=Files.exists(p)?Files.readString(p).trim():"";}catch(Exception e){recordPath="";}
   PreviewStream.poll();
  },0,500,TimeUnit.MILLISECONDS);
 }
 static long lastCapture=0;
 static boolean glChecked=false,usePbo=false,useFence=false;
 static int[] pbo;static int pboIndex=0,pboBytes=0;
 static int pendingPbo=-1,pendingW,pendingH,pendingWaits;static long pendingFence,pendingNanos;static FrameSink[] pendingTargets;
 static ByteBuffer syncPixels;
 static volatile long poolEmpty,gpuNotReady;

 public static void resourcesReady(){try{Files.writeString(root.resolve("resources-ready.txt"),java.time.Instant.now().toString());}catch(Exception e){e.printStackTrace();}}

 public static void frame(long window){
  NativeUi.tick();
  long now=System.nanoTime();LatencyProbe.swap(now);
  try{
   if(!glChecked){GLCapabilities caps=GL.getCapabilities();usePbo=caps.OpenGL21;useFence=caps.OpenGL32||caps.GL_ARB_sync;glChecked=true;System.out.println("Native view: capture "+(usePbo?"async PBO":"synchronous")+(useFence?" with fences":""));}
   if(pendingPbo>=0&&!collect())return;
   long interval=Long.MAX_VALUE;
   for(FrameSink s:sinks){long i=s.interval(now);if(i>0&&i<interval)interval=i;}
   if(interval==Long.MAX_VALUE||now-lastCapture<interval-SLACK)return;
   List<FrameSink> targets=new ArrayList<>(sinks.length);
   for(FrameSink s:sinks)if(s.accepts(now))targets.add(s);
   if(targets.isEmpty())return;
   int[] vp=new int[4];GL11.glGetIntegerv(GL11.GL_VIEWPORT,vp);int w=vp[2],h=vp[3];if(w<1||h<1)return;
   lastCapture=now;
   FrameSink[] to=targets.toArray(new FrameSink[0]);
   int oldRead=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
   GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,0);GL11.glReadBuffer(GL11.GL_BACK);
   try{
    long t3=System.nanoTime();if(usePbo)readAsync(w,h,now,to);else readSync(w,h,now,to);LatencyProbe.phase(3,System.nanoTime()-t3);
   }finally{GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,oldRead);}
  }catch(Throwable e){e.printStackTrace();}
  finally{LatencyProbe.captureTime(System.nanoTime()-now);}
 }

 // Queue the read into a pixel buffer and return at once; the copy happens on the next rendered frame, so the render thread never waits for the GPU.
 static void readAsync(int w,int h,long now,FrameSink[] to){
  int bytes=w*h*4,oldPack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
  if(pbo==null){pbo=new int[2];GL15.glGenBuffers(pbo);}
  try{
   if(bytes!=pboBytes){for(int b:pbo){GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,b);GL15.glBufferData(GL21.GL_PIXEL_PACK_BUFFER,bytes,GL15.GL_STREAM_READ);}pboBytes=bytes;}
   GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,pbo[pboIndex]);
   GL11.glReadPixels(0,0,w,h,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,0L);
   pendingFence=useFence?GL32.glFenceSync(GL32.GL_SYNC_GPU_COMMANDS_COMPLETE,0):0;
   pendingPbo=pboIndex;pboIndex^=1;pendingW=w;pendingH=h;pendingNanos=now;pendingTargets=to;pendingWaits=0;
  }finally{GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,oldPack);}
 }

 /** Returns false while the pending read is still in flight, so no new capture is queued behind it. */
 static boolean collect(){
  long t0=System.nanoTime();
  if(pendingFence!=0){
   int state=GL32.glClientWaitSync(pendingFence,GL32.GL_SYNC_FLUSH_COMMANDS_BIT,0);
   if(state==GL32.GL_TIMEOUT_EXPIRED){gpuNotReady++;if(++pendingWaits<3)return false;}
   GL32.glDeleteSync(pendingFence);pendingFence=0;
  }
  LatencyProbe.phase(0,System.nanoTime()-t0);
  int oldPack=GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
  try{
   GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,pbo[pendingPbo]);
   long t1=System.nanoTime();ByteBuffer mapped=GL15.glMapBuffer(GL21.GL_PIXEL_PACK_BUFFER,GL15.GL_READ_ONLY,(long)pendingW*pendingH*4,null);LatencyProbe.phase(1,System.nanoTime()-t1);
   if(mapped!=null){try{deliver(mapped,pendingW,pendingH,pendingNanos,pendingTargets);}finally{GL15.glUnmapBuffer(GL21.GL_PIXEL_PACK_BUFFER);}}
  }finally{GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER,oldPack);pendingPbo=-1;pendingTargets=null;}
  return true;
 }

 static void readSync(int w,int h,long now,FrameSink[] to){
  int bytes=w*h*4;
  if(syncPixels==null||syncPixels.capacity()!=bytes){if(syncPixels!=null)MemoryUtil.memFree(syncPixels);syncPixels=MemoryUtil.memAlloc(bytes);}
  syncPixels.clear();GL11.glReadPixels(0,0,w,h,GL11.GL_RGBA,GL11.GL_UNSIGNED_BYTE,syncPixels);
  deliver(syncPixels,w,h,now,to);
 }

 // OpenGL rows are bottom-up; flipping here means no sink has to.
 static void deliver(ByteBuffer glRows,int w,int h,long nanos,FrameSink[] to){
  long t2=System.nanoTime();Frame f=Frame.obtain(w,h);if(f==null){poolEmpty++;return;}
  long src=MemoryUtil.memAddress(glRows),dst=MemoryUtil.memAddress(f.rgba),stride=w*4L;
  for(int y=0;y<h;y++)MemoryUtil.memCopy(src+(h-1-y)*stride,dst+y*stride,stride);
  LatencyProbe.phase(2,System.nanoTime()-t2);f.nanos=nanos;LatencyProbe.stamp(f.rgba,w,h);
  for(FrameSink s:to)s.offer(f);
  f.release();
 }

 /** Constant 20 fps H.264 file; frames are repeated to stay on wall-clock time because the video timing is used as evidence. */
 static final class Recorder extends FrameSink {
  static final int W=960,H=540;
  String recording="";Process encoder;OutputStream pipe;long startNanos,frames,lastHeartbeat;byte[] bytes;
  Recorder(){super("native-recorder");}
  long interval(long now){return recordPath.isEmpty()?0:45_000_000L;}
  void tick(){if(!recording.isEmpty()&&!recording.equals(recordPath))finish();}
  void consume(Frame f) throws IOException{
   String want=recordPath;
   // A frame captured just before recording stopped can arrive after the file was closed.
   if(want.isEmpty()){finish();return;}
   if(!want.equals(recording)){finish();start(want,f.nanos);}
   byte[] out=frameBytes(f);
   long due=(f.nanos-startNanos)/50_000_000L+1;while(frames<due){pipe.write(out);frames++;}
   if(f.nanos-lastHeartbeat>1_000_000_000L){lastHeartbeat=f.nanos;heartbeat();}
  }
  byte[] frameBytes(Frame f){
   if(bytes==null)bytes=new byte[W*H*4];
   ByteBuffer src=f.rgba.duplicate();src.clear();
   if(f.width==W&&f.height==H){src.get(bytes);return bytes;}
   for(int y=0;y<H;y++)for(int x=0;x<W;x++){int s=((y*f.height/H)*f.width+x*f.width/W)*4,d=(y*W+x)*4;bytes[d]=src.get(s);bytes[d+1]=src.get(s+1);bytes[d+2]=src.get(s+2);bytes[d+3]=src.get(s+3);}
   return bytes;
  }
  void start(String want,long nanos) throws IOException{
   Files.createDirectories(Paths.get(want).getParent());
   encoder=new ProcessBuilder(System.getProperty("agent.ffmpeg","ffmpeg"),"-y","-f","rawvideo","-pixel_format","rgba","-video_size",W+"x"+H,"-framerate","20","-i","pipe:0","-an","-c:v","libx264","-preset","veryfast","-crf","29","-maxrate","1600k","-bufsize","3200k","-pix_fmt","yuv420p","-movflags","+faststart",want)
    .redirectError(new File(want+".encoder.log")).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
   pipe=new BufferedOutputStream(encoder.getOutputStream(),W*H*4);recording=want;startNanos=nanos;frames=0;lastHeartbeat=0;
   Files.writeString(Paths.get(want+".started.json"),"{\"time\":\""+java.time.Instant.now()+"\",\"width\":"+W+",\"height\":"+H+",\"fps\":20}");
  }
  void heartbeat(){
   Path dest=root.resolve("capture-heartbeat.json"),temp=root.resolve("capture-heartbeat.tmp.json");
   try{Files.writeString(temp,"{\"time\":"+System.currentTimeMillis()+",\"frames\":"+frames+",\"encoderAlive\":"+encoder.isAlive()+"}");Files.move(temp,dest,StandardCopyOption.REPLACE_EXISTING);}catch(IOException ignored){}
  }
  void finish(){
   try{if(pipe!=null){pipe.close();encoder.waitFor(30,TimeUnit.SECONDS);Files.writeString(Paths.get(recording+".finished.json"),"{\"time\":\""+java.time.Instant.now()+"\",\"frames\":"+frames+",\"fps\":20,\"exitCode\":"+encoder.exitValue()+"}");}}
   catch(Exception e){e.printStackTrace();}
   finally{pipe=null;encoder=null;recording="";}
  }
 }

 /** native-preview.png every 2 s; the agent treats its age as the capture health signal. */
 static final class Snapshot extends FrameSink {
  static final long PERIOD=2_000_000_000L;
  long lastOffered=Long.MIN_VALUE/2;int[] rgb;
  Snapshot(){super("native-snapshot");}
  long interval(long now){return PERIOD;}
  boolean accepts(long now){if(now-lastOffered<PERIOD-SLACK)return false;lastOffered=now;return true;}
  void consume(Frame f) throws IOException{
   int w=f.width,h=f.height;if(rgb==null||rgb.length!=w*h)rgb=new int[w*h];
   ByteBuffer p=f.rgba;
   for(int i=0;i<w*h;i++){int o=i*4;rgb[i]=((p.get(o)&255)<<16)|((p.get(o+1)&255)<<8)|(p.get(o+2)&255);}
   BufferedImage image=new BufferedImage(w,h,BufferedImage.TYPE_INT_RGB);image.setRGB(0,0,w,h,rgb,0,w);
   Path dest=root.resolve("native-preview.png"),temp=root.resolve("native-preview.tmp.png");
   ImageIO.write(image,"png",temp.toFile());Files.move(temp,dest,StandardCopyOption.REPLACE_EXISTING);
  }
 }
}
