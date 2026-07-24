(() => {
  const boy = document.getElementById('boy');
  const wrap = document.getElementById('wrap');
  const bubble = document.getElementById('bubble');

  let sprites = {
    idle: 'assets/boy/idle.png',
    run: [],
    acts: {},
  };
  /** @type {HTMLImageElement[]} */
  let runImages = [];
  let runTimer = null;
  let actTimer = null;
  let runFrame = 0;
  let facing = 1;
  let mode = 'idle'; // idle | chase | play | act
  let bubbleTimer = null;
  let shoutTimer = null;
  let idleActTimer = null;

  const CHASE_LINES = ['等等我！', '猫猫别跑～', '我来啦！', '慢一点嘛', '追上你！'];
  const CATCH_LINES = ['抓住你啦！', '一起休息～', '嘿嘿，摸一下', '好软的毛毛'];
  const PLAY_LINES = ['摸摸头～', '给你喝果汁？', '喵？……逗你的', '我们是好朋友！'];
  const ACT_LINES = {
    stretch: ['伸个懒腰～', '哈——舒服！', '骨头咔咔响'],
    yawn: ['哈欠……', '有点困了', '陪猫猫打个盹'],
    laugh: ['哈哈哈！', '好好玩！', '嘿嘿嘿～'],
    pet: ['摸摸毛毛～', '软软的！', '乖猫猫'],
    offer: ['给你喝果汁？', '分你一口～', '甜甜的哦'],
  };

  function asset(p) {
    if (!p) return sprites.idle;
    return p.startsWith('assets/') ? p : `assets/${p}`;
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function showBubble(text, ms = 1600) {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add('visible');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('visible');
    }, ms);
  }

  function preloadRun(paths) {
    runImages = paths.map((p) => {
      const img = new Image();
      img.src = asset(p);
      return img;
    });
  }

  function stopRun() {
    if (runTimer) {
      clearInterval(runTimer);
      runTimer = null;
    }
    clearTimeout(shoutTimer);
    shoutTimer = null;
  }

  function stopAct() {
    if (actTimer) {
      clearTimeout(actTimer);
      actTimer = null;
    }
  }

  function clearActClasses() {
    wrap.classList.remove('chase', 'idle-sway', 'cheer', 'reach', 'act-bob');
  }

  function scheduleLocalIdleAct() {
    clearTimeout(idleActTimer);
    idleActTimer = setTimeout(() => {
      if (mode === 'idle') {
        const keys = Object.keys(sprites.acts || {});
        if (keys.length) playAct(pick(keys));
      }
      scheduleLocalIdleAct();
    }, 5500 + Math.random() * 6500);
  }

  function showIdle() {
    mode = 'idle';
    stopRun();
    stopAct();
    clearActClasses();
    wrap.classList.add('idle-sway');
    boy.src = asset(sprites.idle);
    scheduleLocalIdleAct();
  }

  function paintRunFrame(i) {
    const img = runImages[i];
    if (img && img.complete && img.naturalWidth) {
      boy.src = img.src;
    } else if (sprites.run[i]) {
      boy.src = asset(sprites.run[i]);
    }
  }

  function scheduleChaseShout() {
    clearTimeout(shoutTimer);
    shoutTimer = setTimeout(() => {
      if (mode !== 'chase') return;
      if (Math.random() < 0.55) showBubble(pick(CHASE_LINES), 1400);
      scheduleChaseShout();
    }, 1800 + Math.random() * 2600);
  }

  function showChase(stepMs = 125) {
    if (mode === 'chase' && runTimer) return;
    mode = 'chase';
    stopRun();
    stopAct();
    clearTimeout(idleActTimer);
    clearActClasses();
    wrap.classList.add('chase');
    if (!sprites.run.length) {
      boy.src = asset(sprites.idle);
      return;
    }
    if (!runImages.length) preloadRun(sprites.run);
    runFrame = 0;
    paintRunFrame(0);
    const hold = Math.max(100, Math.min(150, stepMs));
    runTimer = setInterval(() => {
      runFrame = (runFrame + 1) % sprites.run.length;
      paintRunFrame(runFrame);
    }, hold);
    scheduleChaseShout();
  }

  function playAct(kind, line, holdMs = 1600) {
    const src = sprites.acts && sprites.acts[kind];
    mode = 'act';
    stopRun();
    stopAct();
    clearTimeout(idleActTimer);
    clearActClasses();
    wrap.classList.add('act-bob');
    if (src) boy.src = asset(src);
    else boy.src = asset(sprites.idle);
    showBubble(line || pick(ACT_LINES[kind] || PLAY_LINES), Math.min(1800, holdMs + 200));
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode === 'act') showIdle();
    }, holdMs);
  }

  function showPlay(kind = 'cheer', line) {
    // cheer/reach 优先用对应切图
    if (kind === 'reach' && sprites.acts?.pet) {
      playAct('pet', line || pick(PLAY_LINES), 1700);
      return;
    }
    if (kind === 'cheer' && sprites.acts?.laugh) {
      playAct('laugh', line || pick(CATCH_LINES), 1600);
      return;
    }
    mode = 'play';
    stopRun();
    stopAct();
    clearTimeout(idleActTimer);
    clearActClasses();
    boy.src = asset(sprites.idle);
    wrap.classList.add(kind === 'reach' ? 'reach' : 'cheer');
    showBubble(line || pick(kind === 'reach' ? PLAY_LINES : CATCH_LINES), 1800);
    actTimer = setTimeout(() => {
      if (mode === 'play') showIdle();
    }, 900);
  }

  function setFacing(next) {
    facing = next;
    wrap.classList.toggle('flip', facing < 0);
  }

  function applyState(payload) {
    if (typeof payload.facing === 'number') setFacing(payload.facing);
    if (payload.say && !payload.act) {
      showBubble(payload.say, payload.sayMs || 1600);
    }

    const state = payload.state;
    if (state === 'chase' || state === 'walk') {
      showChase(payload.stepMs || 125);
    } else if (payload.act && (state === 'act' || state === 'idle' || state === 'play' || state === 'reach' || state === 'cheer')) {
      playAct(payload.act, payload.say, payload.holdMs || 1600);
    } else if (state === 'play' || state === 'cheer') {
      showPlay('cheer', payload.say);
    } else if (state === 'reach') {
      showPlay('reach', payload.say);
    } else if (state === 'act') {
      // 仅同步位置，等带 act 的下一帧
      if (mode === 'chase') showIdle();
    } else {
      showIdle();
      if (payload.say) showBubble(payload.say, payload.sayMs || 1600);
    }
  }

  let pendingState = null;
  window.childAPI.onState((payload) => {
    if (!sprites.run.length && !(sprites.idle || '').length) {
      pendingState = payload;
      return;
    }
    applyState(payload);
  });

  window.childAPI.getSprites().then((s) => {
    if (s && s.boy) {
      sprites = {
        idle: s.boy.idle,
        run: s.boy.run || [],
        acts: s.boy.acts || {},
      };
      preloadRun(sprites.run);
      // 预加载动作帧
      Object.values(sprites.acts).forEach((p) => {
        const img = new Image();
        img.src = asset(p);
      });
      if (pendingState) {
        applyState(pendingState);
        pendingState = null;
      } else {
        showIdle();
      }
    }
  });

  showIdle();
})();
