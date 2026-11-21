// Gesture mode is optional. Failure to load vision dependencies never blocks the sculpture.
const byId=id=>document.getElementById(id);
const btn=byId('gestureToggle'),state=byId('gestureState'),video=byId('gestureVideo'),overlay=byId('gestureOverlay'),cursor=byId('gestureCursor'),label=byId('camLabel');
let stream=null,handDetector=null,faceDetector=null,active=false,loopId=0;
let stable=0,lastFrame=-1,prevPalm=null,prevOpen=null,prevAction=0,smoothed=null,fistFrames=0,fistLatched=false;
const setStatus=s=>state.textContent=s;
function resetTracking(){stable=0;prevPalm=null;prevOpen=null;smoothed=null;fistFrames=0;fistLatched=false;cursor.style.display='none';window.sculptureGesture?.setActive(false);window.sculptureGesture?.resume()}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function openness(h){const palm=Math.max(.01,distance(h[0],h[9]));return ([8,12,16,20].reduce((sum,i)=>sum+distance(h[i],h[0]),0)/4)/palm}
function draw(hands,faces){const ctx=overlay.getContext('2d');const w=overlay.width=video.videoWidth||640,h=overlay.height=video.videoHeight||480;ctx.clearRect(0,0,w,h);ctx.lineWidth=3;ctx.strokeStyle='#e6d9f4';ctx.fillStyle='#e9ddff';for(const hand of hands){for(const chain of [[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[0,1,2,3,4]]){ctx.beginPath();chain.forEach((i,j)=>j?ctx.lineTo(hand[i].x*w,hand[i].y*h):ctx.moveTo(hand[i].x*w,hand[i].y*h));ctx.stroke()}}}
// Exhibition gesture controller: open = zoom in; close = zoom out;
// hold a fist for 1 second = play. Minimum 850 ms between zoom actions.
const LOST_GRACE_MS=2000, ZOOM_COOLDOWN_MS=850, FIST_HOLD_MS=1500;
let lastSeen=0, lastZoomAt=-Infinity, lastZoomPose=null;
let candidate='neutral', candidateSince=0, stablePose='neutral';
let fistSince=null, fistPlayed=false, missingSince=null;
let lastPalmForRotation=null;
function track(hands,faces,now){
 if(faces.length!==1||hands.length!==1){
  if(missingSince===null)missingSince=now;
  if(now-missingSince>=LOST_GRACE_MS){
   resetTracking();candidate='neutral';stablePose='neutral';lastZoomPose=null;lastPalmForRotation=null;
   fistSince=null;fistPlayed=false;
   label.textContent='LOCKED';setStatus('等待一张人脸与一只手');
  }else{setStatus('暂时丢失识别 · 保留状态 2 秒')}
  return;
 }
 const h=hands[0],box=faces[0].boundingBox;
 const faceX=(box.originX+box.width/2)/(video.videoWidth||640);
 if(Math.abs(h[0].x-faceX)>.65){
  if(missingSince===null)missingSince=now;
  if(now-missingSince>=LOST_GRACE_MS){resetTracking();candidate='neutral';stablePose='neutral';lastZoomPose=null;fistSince=null;fistPlayed=false}
  setStatus('请将手放在人脸附近');return;
 }
 missingSince=null;lastSeen=now;
 // Do not freeze automatic rotation just because a face and hand are visible.
 window.sculptureGesture?.setActive(false);
 const extended=[[8,6],[12,10],[16,14],[20,18]].filter(([tip,pip])=>
   distance(h[tip],h[0])>distance(h[pip],h[0])*1.10).length;
 const raw=extended>=3?'open':extended<=1?'closed':'neutral';
 // Open palm movement rotates the sculpture; zoom remains one action per open/close transition.
 const palmPos={x:(h[0].x+h[9].x)/2,y:(h[0].y+h[9].y)/2};
 if(raw==='open' && lastPalmForRotation){
  const dx=palmPos.x-lastPalmForRotation.x,dy=palmPos.y-lastPalmForRotation.y;
  if(Math.hypot(dx,dy)>.003 && Math.abs(dx)<.15 && Math.abs(dy)<.15){
   window.sculptureGesture?.rotate(-dx*3.5,dy*3.5);
  }
 }
 lastPalmForRotation=raw==='open'?palmPos:null;
 if(raw!==candidate){candidate=raw;candidateSince=now}
 // Small confirmation time prevents flicker, without blocking the user's deliberate action.
 if(raw!=='neutral'&&raw!==stablePose&&now-candidateSince>=180){
  stablePose=raw;
  // A new zoom requires a change in pose AND a 850 ms cooldown.
  if(lastZoomPose!==raw&&now-lastZoomAt>=ZOOM_COOLDOWN_MS){
   // zoom(factor): smaller camera distance means larger sculpture.
   window.sculptureGesture?.zoom(raw==='open'?.84:1.19);
   lastZoomAt=now;lastZoomPose=raw;
  }
 }
 if(raw==='neutral'&&now-candidateSince>500){stablePose='neutral';fistSince=null;fistPlayed=false}
 // A closed hand shrinks once. Only a continuous 1.5-second fist triggers vibration.
 if(raw==='closed'){
  if(fistSince===null)fistSince=now;
  if(!fistPlayed&&now-fistSince>=FIST_HOLD_MS){
   window.sculptureGesture?.play();fistPlayed=true;
  }
 }else{fistSince=null;fistPlayed=false}
 label.textContent=raw==='open'?'OPEN / ZOOM IN':raw==='closed'?'CLOSE / ZOOM OUT':'HAND / READY';
 if(raw==='open')setStatus('✋ 张开：放大一次 · 下次张合需间隔 0.85 秒');
 else if(raw==='closed')setStatus(fistPlayed?'✊ 握拳满 1.5 秒 · 已触发起振':`✊ 合手：缩小 · 持续握拳 ${(Math.min(1.5,(now-fistSince)/1000)).toFixed(1)} / 1.5 秒触发起振`);
 else setStatus('请张开或合拢手掌 · 张开放大 / 合拢缩小');
}
async function loop(){if(!active)return;loopId=requestAnimationFrame(loop);if(video.readyState<2)return;const t=performance.now();if(t-lastFrame<35)return;lastFrame=t;try{const f=faceDetector.detectForVideo(video,t);const h=handDetector.detectForVideo(video,t);draw(h.landmarks||[],f.detections||[]);track(h.landmarks||[],f.detections||[],t)}catch(err){setStatus('识别中断：'+err.message);resetTracking()}}
async function start(){btn.disabled=true;setStatus('正在申请摄像头权限…');try{
 if(!navigator.mediaDevices?.getUserMedia)throw Error('请使用 localhost 或 HTTPS 地址打开网页');
 stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}}});video.srcObject=stream;await video.play();
 setStatus('正在下载手势识别组件（首次需要网络）…');
 // The previously used 0.10.22 tag does not exist on the CDN. Try known published versions and mirrors.
 const candidates=[
  ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm','https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'],
  ['https://esm.sh/@mediapipe/tasks-vision@0.10.14','https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'],
  ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm','https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm']
 ];
 let vision=null,fileset=null,lastError=null;
 for(const [moduleUrl,wasmUrl] of candidates){
  try{
   setStatus('正在连接手势识别服务…');
   vision=await import(/* @vite-ignore */moduleUrl);
   fileset=await vision.FilesetResolver.forVisionTasks(wasmUrl);
   break;
  }catch(error){lastError=error;console.warn('手势识别加载地址不可用',moduleUrl,error);}
 }
 if(!vision||!fileset)throw Error('手势识别组件下载失败（已尝试多个地址）。请检查网络是否能访问 jsDelivr / esm.sh：'+(lastError?.message||''));
 const {HandLandmarker,FaceDetector}=vision;
 const handOptions={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.45};
 const faceOptions={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',delegate:'GPU'},runningMode:'VIDEO',minDetectionConfidence:.5};
 try{handDetector=await HandLandmarker.createFromOptions(fileset,handOptions);faceDetector=await FaceDetector.createFromOptions(fileset,faceOptions)}catch(e){handOptions.baseOptions.delegate='CPU';faceOptions.baseOptions.delegate='CPU';handDetector=await HandLandmarker.createFromOptions(fileset,handOptions);faceDetector=await FaceDetector.createFromOptions(fileset,faceOptions)}
 active=true;btn.textContent='关闭摄像头手势控制';label.textContent='SEARCHING';setStatus('摄像头已开启 · 等待单人脸部与手势');resetTracking();candidate='neutral';stablePose='neutral';lastZoomPose=null;fistSince=null;fistPlayed=false;missingSince=null;loop();
 }catch(err){stop();setStatus('无法启动：'+err.message+'。请确认摄像头权限与外部模型网络。');}finally{btn.disabled=false}}
function stop(){active=false;cancelAnimationFrame(loopId);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;resetTracking();candidate='neutral';stablePose='neutral';lastZoomPose=null;fistSince=null;fistPlayed=false;missingSince=null;label.textContent='CAM OFF';btn.textContent='开启摄像头手势控制'}
btn.addEventListener('click',()=>{if(active){stop();setStatus('摄像头已关闭')}else start()});window.addEventListener('pagehide',stop);
