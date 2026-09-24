import argparse,json,pathlib,platform,urllib.request,hashlib,concurrent.futures,zipfile,os,shutil,sys
root=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description='Download the Minecraft 1.16.5 client, libraries, natives and assets for the hidden native view.')
parser.add_argument('--minecraft-dir',help='Existing .minecraft directory whose assets are reused (default: MINECRAFT_DIR or the platform default)')
args=parser.parse_args()
machine=platform.machine().lower();arm=machine in('arm64','aarch64')
if sys.platform=='win32':osname,lwjglNatives='windows','natives-windows-arm64' if arm else 'natives-windows';defaultMc=pathlib.Path(os.environ.get('APPDATA',pathlib.Path.home()/'AppData/Roaming'))/'.minecraft'
elif sys.platform=='darwin':osname,lwjglNatives='osx','natives-macos-arm64' if arm else 'natives-macos';defaultMc=pathlib.Path.home()/'Library/Application Support/minecraft'
else:osname,lwjglNatives='linux','natives-linux-arm64' if arm else 'natives-linux';defaultMc=pathlib.Path.home()/'.minecraft'
mc=pathlib.Path(args.minecraft_dir or os.environ.get('MINECRAFT_DIR') or defaultMc).expanduser()
print('Platform',osname,machine,'| LWJGL natives',lwjglNatives,'| reusing assets from',mc,'' if (mc/'assets/objects').is_dir() else '(not found, assets will be downloaded)')
version=json.load(open(root.parent/'research/version-1.16.5.json'))
cache=root/'libraries';cache.mkdir(exist_ok=True);natives=root/'natives';natives.mkdir(exist_ok=True)
def get(url,path,sha=None):
 path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists() and (not sha or hashlib.sha1(path.read_bytes()).hexdigest()==sha):return path
 for attempt in range(3):
  try:
   data=urllib.request.urlopen(url,timeout=60).read()
   if sha and hashlib.sha1(data).hexdigest()!=sha:raise ValueError('hash mismatch')
   path.write_bytes(data);return path
  except Exception:
   if attempt==2:raise
cp=[];jobs=[];nativeJars=[]
def add(url,path,sha=None,classpath=True):
 if classpath and str(path) not in cp:cp.append(str(path))
 if all(j[1]!=path for j in jobs):jobs.append((url,path,sha))
for lib in version['libraries']:
 rules=lib.get('rules',[]);allowed=not rules
 for rule in rules:
  osrule=rule.get('os',{})
  if not osrule or osrule.get('name')==osname:allowed=rule['action']=='allow'
 if not allowed:continue
 group,artifact,ver=lib['name'].split(':')[:3]
 if group=='org.lwjgl':
  ver='3.3.1';base=f'https://repo.maven.apache.org/maven2/org/lwjgl/{artifact}/{ver}/{artifact}-{ver}'
  add(base+'.jar',cache/f'{artifact}-{ver}.jar')
  p=cache/f'{artifact}-{ver}-{lwjglNatives}.jar';add(base+f'-{lwjglNatives}.jar',p,classpath=False)
  if p not in nativeJars:nativeJars.append(p)
  continue
 if artifact=='jna':
  add('https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.13.0/jna-5.13.0.jar',cache/'jna-5.13.0.jar');continue
 art=lib.get('downloads',{}).get('artifact')
 if art:add(art['url'],cache/art['path'],art.get('sha1'))
 classifier=lib.get('natives',{}).get(osname)
 native=lib.get('downloads',{}).get('classifiers',{}).get(classifier) if classifier else None
 if native:
  p=cache/native['path'];add(native['url'],p,native.get('sha1'),classpath=False)
  if p not in nativeJars:nativeJars.append(p)
client=version['downloads']['client'];add(client['url'],root/'client.jar',client['sha1'])
# The live view runs WebRTC inside the Minecraft process; the platform jar carries the native library.
webrtcVersion='0.18.0';webrtcPlatform={'windows':'windows','osx':'macos','linux':'linux'}[osname]+('-aarch64' if arm else '-x86_64')
webrtcBase=f'https://repo.maven.apache.org/maven2/dev/onvoid/webrtc/webrtc-java/{webrtcVersion}/webrtc-java-{webrtcVersion}'
add(webrtcBase+'.jar',root/'webrtc'/f'webrtc-java-{webrtcVersion}.jar','e0abfdb02dc443cbfeb00599d9025b0b5b62c3a5')
add(webrtcBase+f'-{webrtcPlatform}.jar',root/'webrtc'/f'webrtc-java-{webrtcVersion}-{webrtcPlatform}.jar')
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:list(ex.map(lambda a:get(*a),jobs))
for jar in nativeJars:
 with zipfile.ZipFile(jar) as z:
  for name in z.namelist():
   if name.endswith(('.dll','.dylib','.so')) and not name.startswith('META-INF/'):(natives/pathlib.Path(name).name).write_bytes(z.read(name))
idx=version['assetIndex'];indexPath=get(idx['url'],root/'assets/indexes'/f'{idx["id"]}.json',idx['sha1']);assets=json.load(open(indexPath))['objects'];jobs=[];reused=0
for a in assets.values():
 h=a['hash'];p=root/'assets/objects'/h[:2]/h;local=mc/'assets/objects'/h[:2]/h
 if p.exists():continue
 if local.exists():
  p.parent.mkdir(parents=True,exist_ok=True)
  try:os.link(local,p)
  except OSError:shutil.copyfile(local,p)
  reused+=1
 else:jobs.append((f'https://resources.download.minecraft.net/{h[:2]}/{h}',p,h))
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:list(ex.map(lambda a:get(*a),jobs))
(root/'classpath.txt').write_text(os.pathsep.join(cp),encoding='utf-8');(root/'config.json').write_text(json.dumps({'mainClass':version['mainClass'],'assetIndex':idx['id']}),encoding='utf-8')
print('Native client dependencies ready',len(assets),'assets,',reused,'reused,',len(jobs),'downloaded')
