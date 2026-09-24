package local.agentview;
import java.util.concurrent.atomic.AtomicReference;import java.util.concurrent.locks.LockSupport;
/** One consumer thread holding only the newest frame, so a slow sink drops frames instead of delaying the others. */
abstract class FrameSink implements Runnable {
 private final AtomicReference<Frame> slot=new AtomicReference<>();
 final String name;private Thread thread;
 volatile long consumed,dropped,maxGapNanos;private long lastConsumed;
 FrameSink(String name){this.name=name;}
 final FrameSink start(){thread=new Thread(this,name);thread.setDaemon(true);thread.start();return this;}
 /** Capture period this sink needs right now, or 0 when it wants no frames. Called on the render thread. */
 abstract long interval(long now);
 /** Whether this particular capture should be delivered. Called on the render thread. */
 boolean accepts(long now){return interval(now)>0;}
 abstract void consume(Frame f) throws Exception;
 /** Housekeeping on the sink thread at least every 500 ms, e.g. closing an encoder that is no longer wanted. */
 void tick(){}
 final void offer(Frame f){f.retain();Frame old=slot.getAndSet(f);if(old!=null){old.release();dropped++;}LockSupport.unpark(thread);}
 public final void run(){
  for(;;){
   Frame f=slot.getAndSet(null);
   if(f==null){LockSupport.parkNanos(this,500_000_000L);try{tick();}catch(Throwable e){System.err.println(name+": "+e);}continue;}
 long t=System.nanoTime();if(lastConsumed!=0&&t-lastConsumed>maxGapNanos)maxGapNanos=t-lastConsumed;lastConsumed=t;
   try{consume(f);consumed++;}catch(Throwable e){System.err.println(name+": "+e);}finally{f.release();}
  }
 }
}
