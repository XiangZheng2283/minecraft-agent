import java.lang.instrument.*;
import java.security.ProtectionDomain;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import com.sun.net.httpserver.*;
import javassist.*;
public class DragonObserver {
  private static volatile String latest="{}";
  public static void premain(String args, Instrumentation inst) throws Exception {
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",Integer.parseInt(args)),0);
    server.createContext("/",ex->{byte[] b=latest.getBytes(java.nio.charset.StandardCharsets.UTF_8);ex.getResponseHeaders().set("Content-Type","application/json");ex.sendResponseHeaders(200,b.length);try(var o=ex.getResponseBody()){o.write(b);}});Thread observerThread=new Thread(server::start,"dragon-observer-start");observerThread.setDaemon(true);observerThread.start();
    inst.addTransformer(new ClassFileTransformer(){public byte[] transform(ClassLoader loader,String name,Class<?> cls,ProtectionDomain domain,byte[] bytes){if(!name.equals("bbr"))return null;try{ClassPool pool=new ClassPool(true);pool.appendClassPath(new LoaderClassPath(loader));CtClass c=pool.makeClass(new ByteArrayInputStream(bytes));c.getDeclaredMethod("k").insertAfter("DragonObserver.observe(this);");byte[] out=c.toBytecode();c.detach();System.out.println("Read-only dragon observer ready");return out;}catch(Throwable e){e.printStackTrace();return null;}}});
  }
  private static double val(Object o,String m)throws Exception{return ((Number)o.getClass().getMethod(m).invoke(o)).doubleValue();}
  private static String pos(Object o,double y)throws Exception{return "{\"x\":"+val(o,"cD")+",\"y\":"+(val(o,"cE")+y)+",\"z\":"+val(o,"cH")+"}";}
  public static void observe(Object dragon){try{Object head=dragon.getClass().getField("bo").get(dragon);Object manager=dragon.getClass().getMethod("eK").invoke(dragon);Object phase=manager.getClass().getMethod("a").invoke(manager);Object phaseType=phase.getClass().getMethod("i").invoke(phase);int phaseId=((Number)phaseType.getClass().getMethod("b").invoke(phaseType)).intValue();latest="{\"time\":"+System.currentTimeMillis()+",\"source\":\"read-only server dragon hitbox\",\"health\":"+val(dragon,"dk")+",\"phase\":"+phaseId+",\"body\":"+pos(dragon,0)+",\"headCenter\":"+pos(head,.5)+"}";}catch(Throwable e){latest="{\"error\":\""+e.getClass().getSimpleName()+"\"}";}}
}
