package local.agentview;
import java.nio.ByteBuffer;import java.util.concurrent.ConcurrentLinkedQueue;import java.util.concurrent.atomic.AtomicInteger;
/** Top-down RGBA frame shared by every sink; returned to the pool when the last sink releases it. */
final class Frame {
 static final int POOL_LIMIT=8;
 static final ConcurrentLinkedQueue<Frame> pool=new ConcurrentLinkedQueue<>();
 static final AtomicInteger allocated=new AtomicInteger();
 final ByteBuffer rgba;final int width,height;long nanos;
 private final AtomicInteger refs=new AtomicInteger();
 private Frame(int w,int h){width=w;height=h;rgba=ByteBuffer.allocateDirect(w*h*4);}
 // Returns null when every frame is still held by a slow sink; the caller skips that capture instead of blocking.
 static Frame obtain(int w,int h){
  Frame f;
  while((f=pool.poll())!=null){if(f.width==w&&f.height==h)break;allocated.decrementAndGet();}
  if(f==null){if(allocated.get()>=POOL_LIMIT)return null;allocated.incrementAndGet();f=new Frame(w,h);}
  f.refs.set(1);return f;
 }
 void retain(){refs.incrementAndGet();}
 void release(){if(refs.decrementAndGet()==0)pool.offer(this);}
}
