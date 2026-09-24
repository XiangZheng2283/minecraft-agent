import pathlib,json,subprocess,os,sys,shutil
root=pathlib.Path(__file__).resolve().parent
(root/'resources-ready.txt').unlink(missing_ok=True)
config=json.load(open(root/'config.json',encoding='utf-8'));game=root/'game';game.mkdir(exist_ok=True)
(game/'options.txt').write_text('fullscreen:false\noverrideWidth:960\noverrideHeight:540\nrenderDistance:8\nmaxFps:40\nguiScale:4\nviewBobbing:true\npauseOnLostFocus:false\ntutorialStep:none\ngamma:1.0\nadvancedItemTooltips:false\nsoundCategory_master:0.0\n')
javaHome=os.environ.get('MC_JAVA_HOME') or os.environ.get('JAVA_HOME')
bundled=root/'java17/Contents/Home/bin/java'
java=pathlib.Path(javaHome)/'bin'/('java.exe' if sys.platform=='win32' else 'java') if javaHome else bundled if bundled.exists() else pathlib.Path(shutil.which('java') or bundled)
if not java.exists():sys.exit(f'Java not found at {java}; set MC_JAVA_HOME to a Java 17 installation')
port=os.environ.get('NATIVE_MIRROR_PORT','25578')
# NATIVE_MIRROR_HOST points the client at an agent on another machine (for example the Linux host); default is this machine.
host=os.environ.get('NATIVE_MIRROR_HOST','127.0.0.1')
print(f'Native view: connecting to mirror {host}:{port}; live view at http://127.0.0.1:'+os.environ.get('NATIVE_WEBRTC_PORT','25590')+'/',flush=True)
args=[str(java),'-javaagent:'+str(root/'native-view-agent.jar')]+(['-XstartOnFirstThread'] if sys.platform=='darwin' else [])+['-Djava.awt.headless=true','-Dagent.mirrorPort='+port,'-Dagent.captureDir='+str(root),'-Dagent.ffmpeg='+os.environ.get('FFMPEG','ffmpeg'),'-Dagent.webrtcPort='+os.environ.get('NATIVE_WEBRTC_PORT','25590'),'-Dagent.latencyProbe='+('true' if os.environ.get('NATIVE_LATENCY_PROBE')=='1' else 'false'),'-Xmx1G','-Dorg.lwjgl.librarypath='+str(root/'natives'),'-Djava.library.path='+str(root/'natives'),'-Dlog4j2.formatMsgNoLookups=true','--add-opens=java.base/java.lang=ALL-UNNAMED','-cp',(root/'classpath.txt').read_text(encoding='utf-8'),config['mainClass'],'--username','AgentView','--version','1.16.5','--gameDir',str(game),'--assetsDir',str(root/'assets'),'--assetIndex',config['assetIndex'],'--uuid','00000000000000000000000000000001','--accessToken','0','--userType','legacy','--width','960','--height','540','--server',host,'--port',port]
if sys.platform=='win32':sys.exit(subprocess.call(args))
os.execv(args[0],args)
