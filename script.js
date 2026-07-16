

(function(){
  "use strict";

 
  const ARENA_SIZE = 45;
  const BOUND = ARENA_SIZE - 1;
  const COLOR = { cyan:0x05d9e8, magenta:0xff2e63, amber:0xffd23f, violet:0x7b2cbf, voidCol:0x0b0518 };
  const EYE_HEIGHT = 1.65;
  const PITCH_LIMIT = Math.PI/2 - 0.1;
  const MOUSE_SENS = 0.0022;
  const TOUCH_LOOK_SENS = 0.005;
  const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

 
  let scene, camera, renderer, clock;
  let gameState = 'start'; // start | playing | levelclear | gameover
  let score = 0, level = 1, lives = 3;
  let audioCtx = null;

  let yaw = 0, pitch = 0;
  let pointerLocked = false;
  let bobPhase = 0, bobAmp = 0;
  let lastMoveMag = 0, isSprintingNow = false;

  let vignetteEl = null, lockHintEl = null;

  const obstacles = [];
  const coins = [];
  const enemies = [];
  const effects = [];

  const player = {
    pos: new THREE.Vector3(0,0,0),
    radius: 0.6,
    speed: 9,
    sprintSpeed: 15,
    energy: 100,
    maxenergy: 100,
    invincibleTimer: 2.0,
    canSprint: true
  };

  const shake = { time:0, duration:0, strength:0 };

  const keys = {};
  let touchSprintActive = false;
  const joystick = { active:false, x:0, z:0, pointerId:null, cx:0, cy:0, maxR:46 };

 
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function randRange(min,max){ return min + Math.random()*(max-min); }
  function farEnough(x,z,list,minDist){
    for(let i=0;i<list.length;i++){
      if(Math.hypot(list[i].x-x, list[i].z-z) < minDist) return false;
    }
    return true;
  }
  function disposeMesh(obj){
    obj.traverse(function(child){
      if(child.geometry) child.geometry.dispose();
      if(child.material){
        if(Array.isArray(child.material)) child.material.forEach(m=>m.dispose());
        else child.material.dispose();
      }
    });
  }

 
  function createGroundTexture(){
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#08041a';
    ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = 'rgba(5,217,232,0.16)';
    ctx.lineWidth = 2;
    const step = 32;
    for(let i=0;i<=size;i+=step){
      ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(size,i); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(123,44,191,0.25)';
    ctx.lineWidth = 3;
    for(let i=0;i<=size;i+=step*4){
      ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(size,i); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ARENA_SIZE/4, ARENA_SIZE/4);
    return tex;
  }

  function createEnemyMesh(){
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color:COLOR.magenta, emissive:0x99042a, emissiveIntensity:0.8, roughness:0.3, metalness:0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.42,1.1,16), mat);
    body.position.y = 0.55; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5,16,16), mat);
    head.position.y = 1.25; head.castShadow = true;
    const eyeMat = new THREE.MeshBasicMaterial({ color:0xffffff });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8), eyeMat);
    eyeL.position.set(-0.18,1.3,0.42);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.18;
    group.add(body,head,eyeL,eyeR);
    group.userData.pulseMat = mat;
    return group;
  }

  function createObstacleMesh(radius,height){
    const mat = new THREE.MeshStandardMaterial({ color:0x241a3d, emissive:COLOR.violet, emissiveIntensity:0.28, roughness:0.75 });
    const geo = new THREE.CylinderGeometry(radius,radius,height,10);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color:COLOR.violet }));
    mesh.add(edges);
    return mesh;
  }

  function createCoinMesh(){
    const mat = new THREE.MeshStandardMaterial({ color:COLOR.amber, emissive:0xcc9900, emissiveIntensity:1.0, metalness:0.6, roughness:0.25 });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.4,0.14,8,16), mat);
    mesh.rotation.x = Math.PI/2;
    mesh.castShadow = true;
    return mesh;
  }

  function createBoundaryWalls(){
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:COLOR.cyan, transparent:true, opacity:0.10, side:THREE.DoubleSide });
    const h = 6, t = 0.6;
    const defs = [
      { x:0, z:-ARENA_SIZE, w:ARENA_SIZE*2, d:t },
      { x:0, z: ARENA_SIZE, w:ARENA_SIZE*2, d:t },
      { x:-ARENA_SIZE, z:0, w:t, d:ARENA_SIZE*2 },
      { x: ARENA_SIZE, z:0, w:t, d:ARENA_SIZE*2 }
    ];
    defs.forEach(function(p){
      const geo = new THREE.BoxGeometry(p.w,h,p.d);
      const wall = new THREE.Mesh(geo, mat);
      wall.position.set(p.x,h/2,p.z);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color:COLOR.cyan, transparent:true, opacity:0.5 }));
      wall.add(edges);
      group.add(wall);
    });
    return group;
  }

 
  function init(){
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR.voidCol);
    scene.fog = new THREE.FogExp2(COLOR.voidCol, 0.017);

    camera = new THREE.PerspectiveCamera(78, window.innerWidth/window.innerHeight, 0.1, 300);
    camera.position.set(0, EYE_HEIGHT, 10);
    camera.lookAt(0, EYE_HEIGHT, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene.add(new THREE.HemisphereLight(0x8888ff,0x120022,0.55));
    scene.add(new THREE.AmbientLight(0x221a44,0.35));

    const dirLight = new THREE.DirectionalLight(0xffffff,0.85);
    dirLight.position.set(22,38,12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048,2048);
    dirLight.shadow.camera.left = -ARENA_SIZE;
    dirLight.shadow.camera.right = ARENA_SIZE;
    dirLight.shadow.camera.top = ARENA_SIZE;
    dirLight.shadow.camera.bottom = -ARENA_SIZE;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 100;
    scene.add(dirLight);

    const groundMat = new THREE.MeshStandardMaterial({ map:createGroundTexture(), roughness:1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_SIZE*2, ARENA_SIZE*2), groundMat);
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    scene.add(ground);

    scene.add(createBoundaryWalls());

    clock = new THREE.Clock();
    vignetteEl = document.getElementById('vignette');
    lockHintEl = document.getElementById('lock-hint');

    setupInput();
    setupUIEvents();
    window.addEventListener('resize', onResize);

    animate();
  }

  function onResize(){
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

 
  function clearArenaObjects(){
    obstacles.forEach(function(o){ scene.remove(o.mesh); disposeMesh(o.mesh); });
    coins.forEach(function(c){ scene.remove(c.mesh); disposeMesh(c.mesh); });
    enemies.forEach(function(e){ scene.remove(e.mesh); disposeMesh(e.mesh); });
    obstacles.length = 0; coins.length = 0; enemies.length = 0;
  }

  function generateArena(lvl){
    clearArenaObjects();
    const placed = [{x:0,z:0}];

    const obstacleCount = Math.min(10 + lvl*2, 26);
    for(let i=0;i<obstacleCount;i++){
      let x=0,z=0,tries=0;
      do{
        x = randRange(-BOUND+3, BOUND-3);
        z = randRange(-BOUND+3, BOUND-3);
        tries++;
      } while((!farEnough(x,z,placed,7) || Math.hypot(x,z) < 10) && tries < 40);
      placed.push({x,z});
      const radius = randRange(1.2,2.4);
      const height = randRange(3,6);
      const mesh = createObstacleMesh(radius,height);
      mesh.position.set(x,height/2,z);
      scene.add(mesh);
      obstacles.push({ position: new THREE.Vector3(x,0,z), radius, mesh });
    }

    const coinCount = Math.min(8 + lvl*2, 24);
    for(let i=0;i<coinCount;i++){
      let x=0,z=0,tries=0;
      do{
        x = randRange(-BOUND+2, BOUND-2);
        z = randRange(-BOUND+2, BOUND-2);
        tries++;
      } while((!farEnough(x,z,placed,3) || Math.hypot(x,z) < 6) && tries < 40);
      placed.push({x,z});
      const mesh = createCoinMesh();
      mesh.position.set(x,1,z);
      scene.add(mesh);
      coins.push({ mesh, collected:false, phase: Math.random()*Math.PI*2 });
    }

    const enemyCount = Math.min(1 + Math.floor(lvl/2), 5);
    const baseSpeed = Math.min(4.5 + lvl*0.35, player.speed*1.35);
    for(let i=0;i<enemyCount;i++){
      let x=0,z=0,tries=0;
      do{
        x = randRange(-BOUND+2, BOUND-2);
        z = randRange(-BOUND+2, BOUND-2);
        tries++;
      } while(Math.hypot(x,z) < 18 && tries < 40);
      const mesh = createEnemyMesh();
      mesh.position.set(x,0,z);
      scene.add(mesh);
      enemies.push({
        pos: new THREE.Vector3(x,0,z), mesh, angle:0, id:i,
        speed: baseSpeed + Math.random()*0.6,
        material: mesh.userData.pulseMat
      });
    }

    player.pos.set(0,0,0);
    player.invincibleTimer = 2.0;
    yaw = 0; pitch = 0;
    bobPhase = 0; bobAmp = 0;
  }

 
  function setupInput(){
    window.addEventListener('keydown', function(e){
      keys[e.code] = true;
      if(e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', function(e){ keys[e.code] = false; });

    const gameCanvas = document.getElementById('game-canvas');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    const sprintBtn = document.getElementById('sprint-btn');
    const lookZone = document.getElementById('look-zone');

    if(IS_TOUCH){
      joyBase.style.display = 'block';
      sprintBtn.style.display = 'flex';
      lookZone.style.display = 'block';
    }

    joyBase.addEventListener('pointerdown', function(e){
      joystick.active = true;
      joystick.pointerId = e.pointerId;
      const r = joyBase.getBoundingClientRect();
      joystick.cx = r.left + r.width/2;
      joystick.cy = r.top + r.height/2;
      joyBase.setPointerCapture(e.pointerId);
      updateJoystickFromEvent(e);
    });
    joyBase.addEventListener('pointermove', function(e){
      if(joystick.active && e.pointerId === joystick.pointerId) updateJoystickFromEvent(e);
    });
    function endJoystick(e){
      if(joystick.pointerId !== null && e.pointerId !== joystick.pointerId) return;
      joystick.active = false; joystick.x = 0; joystick.z = 0; joystick.pointerId = null;
      joyKnob.style.transform = 'translate(-50%,-50%)';
    }
    joyBase.addEventListener('pointerup', endJoystick);
    joyBase.addEventListener('pointercancel', endJoystick);

    function updateJoystickFromEvent(e){
      let dx = e.clientX - joystick.cx;
      let dy = e.clientY - joystick.cy;
      const dist = Math.hypot(dx,dy);
      if(dist > joystick.maxR){ dx = dx/dist*joystick.maxR; dy = dy/dist*joystick.maxR; }
      joyKnob.style.transform = 'translate(' + (dx-26) + 'px,' + (dy-26) + 'px)';
      joystick.x = dx / joystick.maxR;
      joystick.z = dy / joystick.maxR;
    }

    sprintBtn.addEventListener('pointerdown', function(){ touchSprintActive = true; sprintBtn.classList.add('active'); });
    sprintBtn.addEventListener('pointerup', function(){ touchSprintActive = false; sprintBtn.classList.remove('active'); });
    sprintBtn.addEventListener('pointercancel', function(){ touchSprintActive = false; sprintBtn.classList.remove('active'); });

    if(!IS_TOUCH){
      gameCanvas.addEventListener('click', function(){
        if(gameState === 'playing' && document.pointerLockElement !== gameCanvas){
          gameCanvas.requestPointerLock();
        }
      });
      document.addEventListener('pointerlockchange', function(){
        pointerLocked = document.pointerLockElement === gameCanvas;
      });
      document.addEventListener('mousemove', function(e){
        if(!pointerLocked) return;
        yaw -= e.movementX * MOUSE_SENS;
        pitch -= e.movementY * MOUSE_SENS;
        pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      });
    } else {
      let lookPointerId = null, lastLookX = 0, lastLookY = 0;
      lookZone.addEventListener('pointerdown', function(e){
        lookPointerId = e.pointerId; lastLookX = e.clientX; lastLookY = e.clientY;
        lookZone.setPointerCapture(e.pointerId);
      });
      lookZone.addEventListener('pointermove', function(e){
        if(e.pointerId !== lookPointerId) return;
        const dx = e.clientX - lastLookX, dy = e.clientY - lastLookY;
        lastLookX = e.clientX; lastLookY = e.clientY;
        yaw -= dx * TOUCH_LOOK_SENS;
        pitch -= dy * TOUCH_LOOK_SENS;
        pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      });
      function endLook(e){ if(e.pointerId === lookPointerId) lookPointerId = null; }
      lookZone.addEventListener('pointerup', endLook);
      lookZone.addEventListener('pointercancel', endLook);
    }
  }

  function getRawInput(){
    let f=0, r=0;
    if(keys['KeyW']||keys['ArrowUp']) f += 1;
    if(keys['KeyS']||keys['ArrowDown']) f -= 1;
    if(keys['KeyD']||keys['ArrowRight']) r += 1;
    if(keys['KeyA']||keys['ArrowLeft']) r -= 1;
    if(joystick.active){
      f += clamp(-joystick.z, -1, 1);
      r += clamp(joystick.x, -1, 1);
    }
    return { f: clamp(f,-1,1), r: clamp(r,-1,1) };
  }
  function isSprintHeld(){
    return !!(keys['ShiftLeft'] || keys['ShiftRight'] || touchSprintActive);
  }

  
  function setupUIEvents(){
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', startGame);
  }

  function initAudioIfNeeded(){
    if(!audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep(freq, duration, type, startGain){
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(startGain != null ? startGain : 0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }
  function playCoinSound(){ beep(1046,0.12,'sine',0.2); setTimeout(function(){ beep(1568,0.1,'sine',0.15); },55); }
  function playCatchSound(){ beep(160,0.4,'sawtooth',0.3); }
  function playLevelUpSound(){
    [523,659,784,1046].forEach(function(f,i){
      setTimeout(function(){ beep(f,0.16,'triangle',0.2); }, i*90);
    });
  }

 
  function startGame(){
    score = 0; level = 1; lives = 3;
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    generateArena(1);
    gameState = 'playing';
    clock.getDelta();
    updateHUDText();
    initAudioIfNeeded();
    if(!IS_TOUCH){
      const gc = document.getElementById('game-canvas');
      if(gc.requestPointerLock) gc.requestPointerLock();
    }
    player.energy = player.maxenergy;
    player.canSprint = true;
  }

  function gameOver(){
    gameState = 'gameover';
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-level').textContent = level;
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('gameover-screen').classList.remove('hidden');
    if(document.exitPointerLock) document.exitPointerLock();
  }

  function onLevelComplete(){
    gameState = 'levelclear';
    const banner = document.getElementById('level-clear-banner');
    banner.classList.add('show');
    playLevelUpSound();
    setTimeout(function(){
      level += 1;
      generateArena(level);
      gameState = 'playing';
      banner.classList.remove('show');
      updateHUDText();
    }, 1700);
  }

  function onPlayerCaught(){
    lives -= 1;
    playCatchSound();
    triggerShake(0.4, 0.35);
    triggerVignetteFlash();
    player.invincibleTimer = 1.6;
    player.pos.set(0,0,0);
    enemies.forEach(function(en){
      const d = Math.hypot(en.pos.x, en.pos.z);
      if(d < 15){
        const ang = Math.atan2(en.pos.z, en.pos.x) || Math.random()*Math.PI*2;
        en.pos.x = Math.cos(ang) * 18;
        en.pos.z = Math.sin(ang) * 18;
      }
    });
    updateHUDText();
    if(lives <= 0) gameOver();
  }

  function triggerShake(duration, strength){
    shake.duration = duration; shake.time = duration; shake.strength = strength;
  }
  function triggerVignetteFlash(){
    if(!vignetteEl) return;
    vignetteEl.classList.add('flash');
    setTimeout(function(){ if(vignetteEl) vignetteEl.classList.remove('flash'); }, 380);
  }

  function updateHUDText(){
    document.getElementById('score-val').textContent = score;
    document.getElementById('level-val').textContent = level;
    document.getElementById('lives-val').textContent = '\u2764'.repeat(Math.max(lives,0)) || '-';
    document.getElementById('energy-fill').style.width = (player.energy/player.maxenergy*100) + '%';
  }


  function resolveObstacleCollision(pos, radius){
    for(let i=0;i<obstacles.length;i++){
      const o = obstacles[i];
      const dx = pos.x - o.position.x;
      const dz = pos.z - o.position.z;
      const distSq = dx*dx + dz*dz;
      const minDist = radius + o.radius;
      if(distSq < minDist*minDist && distSq > 0.0001){
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        pos.x += (dx/dist) * overlap;
        pos.z += (dz/dist) * overlap;
      }
    }
  }

  
  function updatePlayer(delta){
    const inp = getRawInput();

    
    const forward2D = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right2D = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const moveVec = forward2D.multiplyScalar(inp.f).add(right2D.multiplyScalar(inp.r));
    const rawMag = moveVec.length();
    if(rawMag > 1) moveVec.normalize();
    lastMoveMag = Math.min(rawMag, 1);


    if (player.energy <= 0) {
        player.canSprint = false;
    }


    if (!player.canSprint && player.energy >= player.maxenergy) {
        player.canSprint = true;
    }

    const sprinting =
        isSprintHeld() &&
        player.canSprint &&
        player.energy > 0 &&
        lastMoveMag > 0.1;

    isSprintingNow = sprinting;
    const curSpeed = sprinting ? player.sprintSpeed : player.speed;

    if (sprinting) {
        player.energy = Math.max(0, player.energy - 40 * delta);
    } else {
        player.energy = Math.min(player.maxenergy, player.energy + 20 * delta);
    }

    if(lastMoveMag > 0.05){
      const move = moveVec.clone().multiplyScalar(curSpeed*delta);
      const newPos = player.pos.clone().add(move);
      newPos.x = clamp(newPos.x, -BOUND, BOUND);
      newPos.z = clamp(newPos.z, -BOUND, BOUND);
      resolveObstacleCollision(newPos, player.radius);
      player.pos.copy(newPos);
    }

    if(player.invincibleTimer > 0) player.invincibleTimer -= delta;
    if(vignetteEl) vignetteEl.classList.toggle('invincible', player.invincibleTimer > 0);
  }

 
  function updateEnemies(delta){
    for(let i=0;i<enemies.length;i++){
      const enemy = enemies[i];
      const toPlayer = new THREE.Vector3(player.pos.x - enemy.pos.x, 0, player.pos.z - enemy.pos.z);
      toPlayer.normalize();

      const avoid = new THREE.Vector3();
      for(let j=0;j<obstacles.length;j++){
        const obs = obstacles[j];
        const dx = enemy.pos.x - obs.position.x;
        const dz = enemy.pos.z - obs.position.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        const avoidRange = obs.radius + 2.5;
        if(d < avoidRange && d > 0.001){
          const strength = (avoidRange - d) / avoidRange;
          avoid.x += (dx/d) * strength;
          avoid.z += (dz/d) * strength;
        }
      }

      const desired = toPlayer.clone().add(avoid.multiplyScalar(1.4));
      if(desired.lengthSq() > 0.0001) desired.normalize();

      const move = desired.multiplyScalar(enemy.speed * delta);
      const newPos = enemy.pos.clone().add(move);
      newPos.x = clamp(newPos.x, -BOUND, BOUND);
      newPos.z = clamp(newPos.z, -BOUND, BOUND);
      resolveObstacleCollision(newPos, 0.55);
      enemy.pos.copy(newPos);
      enemy.mesh.position.set(enemy.pos.x, 0, enemy.pos.z);

      const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
      let diff = (targetAngle - enemy.angle) % (Math.PI*2);
      if(diff > Math.PI) diff -= Math.PI*2;
      if(diff < -Math.PI) diff += Math.PI*2;
      enemy.angle += diff * Math.min(1, delta*6);
      enemy.mesh.rotation.y = enemy.angle;

      if(enemy.material){
        enemy.material.emissiveIntensity = 0.6 + Math.sin(performance.now()*0.006 + enemy.id) * 0.3;
      }
    }
  }

 
  function updateCoins(delta){
    for(let i=0;i<coins.length;i++){
      const c = coins[i];
      if(c.collected) continue;
      c.mesh.rotation.z += delta*2;
      c.mesh.position.y = 1 + Math.sin(performance.now()*0.003 + c.phase) * 0.15;
    }
  }

  function spawnBurst(pos){
    const geo = new THREE.SphereGeometry(0.3,8,8);
    const mat = new THREE.MeshBasicMaterial({ color:COLOR.amber, transparent:true, opacity:0.9 });
    const mesh = new THREE.Mesh(geo,mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    effects.push({ mesh, life:0.5, maxLife:0.5 });
  }

  function updateEffects(delta){
    for(let i=effects.length-1;i>=0;i--){
      const e = effects[i];
      e.life -= delta;
      const t = 1 - e.life/e.maxLife;
      e.mesh.scale.setScalar(1 + t*3);
      e.mesh.material.opacity = Math.max(0, 1-t);
      if(e.life <= 0){
        scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        effects.splice(i,1);
      }
    }
  }

  
  function checkCollisions(){
    for(let i=0;i<coins.length;i++){
      const c = coins[i];
      if(c.collected) continue;
      const dx = player.pos.x - c.mesh.position.x;
      const dz = player.pos.z - c.mesh.position.z;
      if(dx*dx + dz*dz < 1.2*1.2){
        c.collected = true;
        c.mesh.visible = false;
        score += 10 * level;
        spawnBurst(c.mesh.position.clone());
        playCoinSound();
        updateHUDText();
      }
    }

    if(player.invincibleTimer <= 0){
      for(let i=0;i<enemies.length;i++){
        const enemy = enemies[i];
        const dx = player.pos.x - enemy.pos.x;
        const dz = player.pos.z - enemy.pos.z;
        if(dx*dx + dz*dz < 1.3*1.3){
          onPlayerCaught();
          break;
        }
      }
    }

    if(gameState === 'playing' && coins.length > 0 && coins.every(function(c){ return c.collected; })){
      onLevelComplete();
    }
  }

  
  function updateCameraFPS(delta){
    camera.rotation.set(pitch, yaw, 0, 'YXZ');

    const moving = lastMoveMag > 0.1;
    const bobSpeed = isSprintingNow ? 15 : 9.5;
    if(moving) bobPhase += delta*bobSpeed;
    const targetAmp = moving ? 0.055 : 0;
    bobAmp += (targetAmp - bobAmp) * Math.min(1, delta*8);
    const bobY = Math.abs(Math.sin(bobPhase)) * bobAmp;
    const bobX = Math.cos(bobPhase*0.5) * bobAmp * 0.5;

    let shakeX=0, shakeY=0, shakeZ=0, shakeRoll=0;
    if(shake.time > 0){
      shake.time -= delta;
      const s = shake.strength * Math.max(0, shake.time/shake.duration);
      shakeX = (Math.random()-0.5)*s;
      shakeY = (Math.random()-0.5)*s;
      shakeZ = (Math.random()-0.5)*s;
      shakeRoll = (Math.random()-0.5)*s*0.4;
    }

    camera.position.set(player.pos.x + bobX + shakeX, EYE_HEIGHT + bobY + shakeY, player.pos.z + shakeZ);
    camera.rotation.z += shakeRoll;

    if(lockHintEl){
      const show = gameState === 'playing' && !IS_TOUCH && !pointerLocked;
      lockHintEl.style.display = show ? 'block' : 'none';
    }
  }

  
  const minimapCanvas = document.getElementById('minimap-canvas');
  const minimapCtx = minimapCanvas.getContext('2d');
  const MM_SIZE = 160;
  const MM_VIEW_RADIUS = 30;
  const MM_SCALE = (MM_SIZE/2 - 4) / MM_VIEW_RADIUS;

  function worldToMap(wx,wz){
    return { x: MM_SIZE/2 + (wx - player.pos.x)*MM_SCALE, y: MM_SIZE/2 + (wz - player.pos.z)*MM_SCALE };
  }

  function updateMinimap(){
    minimapCtx.clearRect(0,0,MM_SIZE,MM_SIZE);
    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(MM_SIZE/2, MM_SIZE/2, MM_SIZE/2-2, 0, Math.PI*2);
    minimapCtx.clip();
    minimapCtx.fillStyle = 'rgba(8,4,20,0.9)';
    minimapCtx.fillRect(0,0,MM_SIZE,MM_SIZE);

    minimapCtx.fillStyle = 'rgba(123,44,191,0.55)';
    obstacles.forEach(function(o){
      const p = worldToMap(o.position.x, o.position.z);
      minimapCtx.beginPath();
      minimapCtx.arc(p.x,p.y, Math.max(2,o.radius*MM_SCALE), 0, Math.PI*2);
      minimapCtx.fill();
    });

    minimapCtx.fillStyle = '#ffd23f';
    coins.forEach(function(c){
      if(c.collected) return;
      const p = worldToMap(c.mesh.position.x, c.mesh.position.z);
      minimapCtx.beginPath();
      minimapCtx.arc(p.x,p.y,3,0,Math.PI*2);
      minimapCtx.fill();
    });

    minimapCtx.fillStyle = '#ff2e63';
    enemies.forEach(function(e){
      const p = worldToMap(e.pos.x, e.pos.z);
      minimapCtx.beginPath();
      minimapCtx.arc(p.x,p.y,4,0,Math.PI*2);
      minimapCtx.fill();
    });

    minimapCtx.save();
    minimapCtx.translate(MM_SIZE/2, MM_SIZE/2);
    minimapCtx.rotate(yaw);
    minimapCtx.fillStyle = '#05d9e8';
    minimapCtx.beginPath();
    minimapCtx.moveTo(0,-7);
    minimapCtx.lineTo(5,6);
    minimapCtx.lineTo(-5,6);
    minimapCtx.closePath();
    minimapCtx.fill();
    minimapCtx.restore();

    minimapCtx.restore();
  }

 
  function animate(){
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if(gameState === 'playing' || gameState === 'levelclear'){
      if(gameState === 'playing'){
        updatePlayer(delta);
        updateEnemies(delta);
        checkCollisions();
      }
      updateCoins(delta);
      updateEffects(delta);
      updateCameraFPS(delta);
      updateMinimap();
      updateHUDText();
    }

    renderer.render(scene, camera);
  }

  init();
})();