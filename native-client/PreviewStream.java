package local.agentview;
import java.io.*;import java.nio.ByteBuffer;import java.nio.file.*;import java.util.concurrent.TimeUnit;
/** Fallback for `node native-preview.mjs`: H.264 over RTP to the Node relay while its control file is fresh. */
public class PreviewStream {
 static final Path control=Paths.get(System.getProperty("agent.captureDir")).resolve("preview-rtp.txt");
 static volatile int port=0;
 // The Node server refreshes the control file while viewers are connected; a stale file means it died.
 static void poll(){
  int p=0;
  try{if(Files.exists(control)&&System.currentTimeMillis()-Files.getLastModifiedTime(control).toMillis()<6000)p=Integer.parseInt(Files.readString(control).trim());}catch(Exception e){p=0;}
  port=p<1||p>65535?0:p;
 }
 static final FrameSink sink=new FrameSink("native-rtp-preview"){
  Process ffmpeg;OutputStream pipe;int running,width,height;long startNanos,frames;byte[] bytes;
  long interval(long now){return port!=0?33_333_333L:0;}
  void tick(){if(port==0&&pipe!=null)stop();}
  void consume(Frame f) throws IOException{
   int want=port;if(want==0){stop();return;}
   if(pipe==null||want!=running||f.width!=width||f.height!=height){stop();start(want,f.width,f.height,f.nanos);}
   if(bytes==null||bytes.length!=f.width*f.height*4)bytes=new byte[f.width*f.height*4];
   ByteBuffer src=f.rgba.duplicate();src.clear();src.get(bytes);
   // RTP timestamps come from the frame count, so repeat frames to keep them on wall-clock time.
   long due=(f.nanos-startNanos)/33_333_333L+1;
   try{while(frames<due){pipe.write(bytes);frames++;}pipe.flush();}catch(IOException e){System.err.println("Native preview: "+e);stop();}
  }
  void start(int p,int w,int h,long nanos) throws IOException{
   ffmpeg=new ProcessBuilder(System.getProperty("agent.ffmpeg","ffmpeg"),"-hide_banner","-loglevel","warning","-f","rawvideo","-pixel_format","rgba","-video_size",w+"x"+h,"-framerate","30","-i","pipe:0",
    "-an","-c:v","libx264","-preset","ultrafast","-tune","zerolatency","-profile:v","baseline","-level","3.1","-pix_fmt","yuv420p","-g","30","-bf","0",
    "-b:v","2500k","-maxrate","2500k","-bufsize","1250k","-bsf:v","dump_extra","-f","rtp","-payload_type","96","rtp://127.0.0.1:"+p+"?pkt_size=1200")
    .redirectError(control.resolveSibling("preview-encoder.log").toFile()).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
   pipe=new BufferedOutputStream(ffmpeg.getOutputStream(),w*h*4);running=p;width=w;height=h;startNanos=nanos;frames=0;
   System.out.println("Native view: RTP preview encoder started for rtp://127.0.0.1:"+p);
  }
  void stop(){
   try{if(pipe!=null)pipe.close();}catch(IOException ignored){}
   try{if(ffmpeg!=null&&!ffmpeg.waitFor(2,TimeUnit.SECONDS))ffmpeg.destroyForcibly();}catch(InterruptedException e){ffmpeg.destroyForcibly();}
   pipe=null;ffmpeg=null;running=0;
  }
 };
}
