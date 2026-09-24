package local.agentview;
/** Optional (-Dagent.latencyProbe=true) end-to-end latency stamp and render-rate log. */
public class LatencyProbe {
 static final boolean enabled=Boolean.getBoolean("agent.latencyProbe");
 static long windowStart=0,lastSwap=0,maxSwapGap=0,maxCapture=0;static int swaps=0;
 public static void captureTime(long nanos){if(enabled&&nanos>maxCapture)maxCapture=nanos;}
 static final long[] phase=new long[4];
 public static void phase(int i,long nanos){if(enabled&&nanos>phase[i])phase[i]=nanos;}
 // 16 black/white 16x16 blocks at the bottom-left carrying the low 16 bits of the capture time in milliseconds.
 public static void stamp(java.nio.ByteBuffer rgba,int width,int height){
  if(!enabled||width<256||height<16)return;
  long t=System.currentTimeMillis();
  for(int bit=0;bit<16;bit++){byte v=(byte)(((t>>bit)&1)!=0?255:0);
   for(int y=height-16;y<height;y++)for(int x=bit*16;x<bit*16+16;x++){int i=(y*width+x)*4;rgba.put(i,v);rgba.put(i+1,v);rgba.put(i+2,v);rgba.put(i+3,(byte)255);}}
 }
 public static void swap(long now){
  if(!enabled)return;
  if(windowStart==0)windowStart=now;swaps++;if(lastSwap!=0&&now-lastSwap>maxSwapGap)maxSwapGap=now-lastSwap;lastSwap=now;
  if(now-windowStart>=5_000_000_000L){System.out.printf("Latency probe: render %.1f fps, longest frame %d ms, longest capture %.1f ms (wait %.1f map %.1f copy %.1f read %.1f)%n",swaps*1e9/(now-windowStart),maxSwapGap/1_000_000,maxCapture/1e6,phase[0]/1e6,phase[1]/1e6,phase[2]/1e6,phase[3]/1e6);java.util.Arrays.fill(phase,0);windowStart=now;swaps=0;maxSwapGap=0;maxCapture=0;}
 }
}
