package local.agentview;
import java.nio.file.*;import java.lang.reflect.*;
public class NativeUi {
 static long poll;static String last="";static boolean own=false;
 public static void tick(){long now=System.nanoTime();if(now-poll<100_000_000L)return;poll=now;
  try{Path root=Paths.get(System.getProperty("agent.captureDir")),file=root.resolve("ui-command.txt");if(!Files.exists(file))return;String cmd=Files.readString(file).trim();if(cmd.equals(last))return;String[] parts=cmd.split(" ");if(parts.length<2)return;
   Class<?> mc=Class.forName("djz"),screen=Class.forName("dot");Object client=mc.getMethod("C").invoke(null),player=mc.getField("s").get(client);if(player==null)return;
   if(parts[1].equals("inventory")){Object gui=Class.forName("dql").getConstructor(Class.forName("bfw")).newInstance(player);mc.getMethod("a",screen).invoke(client,gui);own=true;}
   else if(parts[1].equals("close")&&own){Object current=mc.getField("y").get(client);if(current!=null&&current.getClass().getName().equals("dql"))mc.getMethod("a",screen).invoke(client,new Object[]{null});own=false;}
   last=cmd;Files.writeString(root.resolve("ui-ack.txt"),cmd);
  }catch(Throwable e){System.err.println("Native UI: "+e);}
 }
}
