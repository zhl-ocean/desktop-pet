(() => {
  const pet = document.getElementById('pet');
  const petWrap = document.getElementById('pet-wrap');
  const petSprite = document.getElementById('pet-sprite');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const fx = document.getElementById('fx');

  const LINES = [
    '摸我干嘛，本喵正在思考宇宙。',
    '再点一下，我就……再躺会儿。',
    '今天也是被rua的一天呢。',
    '有小鱼干吗？没有就继续躺。',
    '你的屏幕也太亮了吧！',
    '本王允许你工作，但不准摸鱼……等等。',
    '跳一下就累了，需要充电。',
    '别卷了，来陪我发呆。',
    '喵？刚才那个邮件可以明天再回。',
    '我不是懒，我是在节能模式。',
    '你点我，是想听我说晚安吗？',
    '尾巴很蓬吧？不许嫉妒。',
  ];

  const WALK_LINES = [
    '巡逻中，闲人退散～',
    '去那边看看有没有小鱼干。',
    '四条腿全速前进！',
    '桌面好大，本喵要探索！',
  ];

  const DAYDREAM_LINES = [
    '……发呆中，请勿打扰。',
    '在想今晚吃什么罐头。',
    '盯着鼠标看，它会自己跑吗？',
    'Zzz…哦不，我没睡。',
    '工作？那是人类的事。',
  ];

  const BUTTERFLY_LINES = [
    '蝴蝶！站住！',
    '差点就抓到了～',
    '本喵的捕猎本能觉醒了！',
    '飞太快了，下次一定！',
  ];

  const BUDDY_LINES = [
    '被小孩追上啦……行吧，摸摸。',
    '哼，算你跑得快。',
    '好啦好啦，一起歇会儿。',
    '小爪子给我揉揉～',
  ];

  const BUDDY_PET_LINES = [
    '轻一点，本喵的发型会乱。',
    '嗯……继续，就一下。',
    '果汁？本喵只要小鱼干。',
    '你的手暖暖的。',
  ];

  const ACTIONS = [
    {
      name: 'jump',
      className: 'jump',
      fx: '',
      lines: ['起飞失败，原地起飞！', '看我优雅一跃——扑通。', '跳完了，继续躺平。'],
    },
    {
      name: 'happy',
      className: 'happy sparkle',
      fx: '✨',
      lines: ['哼哼，被夸了就开心。', '蓝眼睛暴击！', '开心到想打个滚。'],
    },
    {
      name: 'wiggle',
      className: 'wiggle',
      fx: '',
      lines: ['甩甩毛，霉运走开。', '尾巴舞时间到！', '别看，我在练平衡。'],
    },
    {
      name: 'sleepy',
      className: 'sleepy',
      fx: '💤',
      useBlinkFrame: true,
      lines: ['Zzz…五分钟就好。', '别吵，本喵在开会。', '困了，但还能卖个萌。'],
    },
    {
      name: 'squash',
      className: 'squash sparkle',
      fx: '❤️',
      lines: ['被你按成猫饼了。', '软软的，可以捏一下下。', 'rua完记得负责。'],
    },
    {
      name: 'butterfly',
      className: '',
      fx: '',
      playButterfly: true,
      lines: BUTTERFLY_LINES,
    },
  ];

  let sprites = {
    idle: 'assets/cat.png',
    blink: 'assets/cat-blink.png',
    run: [],
    butterfly: [],
    blinkSeq: [],
  };

  let actionIndex = 0;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let bubbleTimer = null;
  let animating = false;
  let autoState = 'idle';
  let blinkTimer = null;
  let idleActionTimer = null;
  let runTimer = null;
  let seqTimer = null;
  let runFrame = 0;
  let facing = 1;

  function asset(p) {
    if (!p) return sprites.idle;
    return p.startsWith('assets/') ? p : `assets/${p}`;
  }

  function pickLine(preferred) {
    if (preferred && preferred.length) {
      return preferred[Math.floor(Math.random() * preferred.length)];
    }
    return LINES[Math.floor(Math.random() * LINES.length)];
  }

  function showBubble(text, ms = 2400) {
    bubbleText.textContent = text;
    // 固定在窗口上角侧边，避开正脸中心
    const putLeft = facing > 0;
    bubble.classList.toggle('left-side', putLeft);
    bubble.classList.remove('hidden');
    bubble.classList.add('visible');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('visible');
      bubble.classList.add('hidden');
    }, ms);
  }

  function clearMotionClasses() {
    petWrap.classList.remove(
      'jump',
      'wiggle',
      'squash',
      'happy',
      'sleepy',
      'sparkle',
      'walk',
      'daydream',
      'pause-bob'
    );
    fx.textContent = '';
    fx.innerHTML = '';
  }

  function setFacing(next) {
    facing = next;
    petSprite.classList.toggle('flip', facing < 0);
  }

  function stopRunFrames() {
    if (runTimer) {
      clearInterval(runTimer);
      runTimer = null;
    }
  }

  function stopSeq() {
    if (seqTimer) {
      clearTimeout(seqTimer);
      seqTimer = null;
    }
  }

  function showIdle() {
    stopRunFrames();
    stopSeq();
    pet.src = asset(sprites.idle);
  }

  function startRunFrames(stepMs = 125) {
    stopRunFrames();
    stopSeq();
    const frames = (sprites.run || []).map(asset);
    if (!frames.length) {
      pet.src = asset(sprites.idle);
      return;
    }
    runFrame = 0;
    pet.src = frames[0];
    const hold = Math.max(90, Math.min(160, stepMs));
    runTimer = setInterval(() => {
      runFrame = (runFrame + 1) % frames.length;
      pet.src = frames[runFrame];
    }, hold);
  }

  function playFrameSequence(frames, opts = {}) {
    return new Promise((resolve) => {
      stopRunFrames();
      stopSeq();
      const list = frames.map(asset).filter(Boolean);
      if (!list.length) {
        resolve();
        return;
      }
      const hold = opts.hold || 120;
      const pingPong = !!opts.pingPong;
      let order = list.slice();
      if (pingPong && list.length > 1) {
        order = list.concat(list.slice(1, -1).reverse());
      }
      let i = 0;
      const tick = () => {
        pet.src = order[i];
        i += 1;
        if (i >= order.length) {
          seqTimer = null;
          resolve();
          return;
        }
        seqTimer = setTimeout(tick, hold);
      };
      tick();
    });
  }

  async function playBlinkDetailed() {
    if (dragging || autoState === 'walk' || animating) return;
    const seq = sprites.blinkSeq || [];
    if (seq.length >= 2) {
      await playFrameSequence(seq, { hold: 120, pingPong: true });
      if (autoState !== 'walk' && !dragging) pet.src = asset(sprites.idle);
      return;
    }
    // fallback 单帧闭眼
    pet.src = asset(sprites.blink || sprites.idle);
    await new Promise((r) => setTimeout(r, 280));
    if (autoState !== 'walk' && !dragging) pet.src = asset(sprites.idle);
  }

  async function playButterfly() {
    const frames = sprites.butterfly || [];
    if (!frames.length) return;
    showBubble(pickLine(BUTTERFLY_LINES), 3200);
    // 先顿一下再开抓，结尾多停一帧，整体更慢更自然
    await new Promise((r) => setTimeout(r, 280));
    await playFrameSequence(frames, { hold: 320, pingPong: true });
    await new Promise((r) => setTimeout(r, 360));
    await playBlinkDetailed();
    await new Promise((r) => setTimeout(r, 200));
    if (!dragging && autoState !== 'walk') pet.src = asset(sprites.idle);
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (autoState === 'walk') return;
    const wait = autoState === 'daydream' ? 4200 + Math.random() * 2800 : 2200 + Math.random() * 3000;
    blinkTimer = setTimeout(async () => {
      if (!dragging && autoState !== 'walk' && !animating) {
        await playBlinkDetailed();
      }
      scheduleBlink();
    }, wait);
  }

  function scheduleIdleAction() {
    clearTimeout(idleActionTimer);
    if (autoState === 'walk' || !autoWanderLike()) return;
    idleActionTimer = setTimeout(async () => {
      if (dragging || animating || autoState === 'walk') {
        scheduleIdleAction();
        return;
      }
      if (autoState === 'idle' || autoState === 'pause') {
        const roll = Math.random();
        if (roll < 0.55) {
          animating = true;
          autoState = 'butterfly';
          clearMotionClasses();
          await playButterfly();
          animating = false;
          autoState = 'idle';
          showIdle();
        } else {
          await playBlinkDetailed();
        }
      }
      scheduleIdleAction();
    }, 5000 + Math.random() * 7000);
  }

  function autoWanderLike() {
    // 本地只做调度；真正开关由主进程暂停 walk 状态即可
    return true;
  }

  function playAction() {
    if (animating) return;
    window.petAPI.userInteract();
    stopRunFrames();
    stopSeq();
    showIdle();

    const action = ACTIONS[actionIndex % ACTIONS.length];
    actionIndex += 1;
    animating = true;
    autoState = 'interact';
    clearMotionClasses();

    (async () => {
      if (action.playButterfly) {
        await playButterfly();
        animating = false;
        autoState = 'idle';
        showIdle();
        scheduleBlink();
        scheduleIdleAction();
        return;
      }

      void petWrap.offsetWidth;
      action.className.split(/\s+/).forEach((c) => c && petWrap.classList.add(c));
      if (action.useBlinkFrame) {
        pet.src = asset(sprites.blink);
      }
      if (action.fx) fx.textContent = action.fx;
      if (action.name === 'happy' || action.name === 'jump') {
        playBlinkDetailed();
      }
      showBubble(pickLine(action.lines));

      const onEnd = () => {
        petWrap.removeEventListener('animationend', onEnd);
        clearTimeout(fallback);
        clearMotionClasses();
        showIdle();
        fx.textContent = '';
        animating = false;
        autoState = 'idle';
        scheduleBlink();
        scheduleIdleAction();
      };
      const fallback = setTimeout(onEnd, 1400);
      if (action.className) petWrap.addEventListener('animationend', onEnd);
      else onEnd();
    })();
  }

  function applyAutoState(payload) {
    if (animating || dragging) return;
    const { state } = payload;
    autoState = state;
    if (typeof payload.facing === 'number') setFacing(payload.facing);

    if (state === 'walk') {
      clearMotionClasses();
      petWrap.classList.add('walk');
      startRunFrames(payload.stepMs || 125);
      if (Math.random() < 0.4) showBubble(pickLine(WALK_LINES), 1600);
      clearTimeout(blinkTimer);
      clearTimeout(idleActionTimer);
      return;
    }

    if (state === 'daydream') {
      clearMotionClasses();
      stopRunFrames();
      petWrap.classList.add('daydream');
      pet.src = asset(sprites.blink);
      // 发呆标记放头顶，不再盖住嘴巴
      fx.innerHTML = '<span class="dream-zzz">Zzz</span>';
      showBubble(pickLine(DAYDREAM_LINES), 2600);
      scheduleBlink();
      scheduleIdleAction();
      return;
    }

    if (state === 'pause') {
      clearMotionClasses();
      stopRunFrames();
      showIdle();
      petWrap.classList.add('pause-bob');
      playBlinkDetailed();
      scheduleBlink();
      scheduleIdleAction();
      return;
    }

    if (state === 'buddy') {
      clearMotionClasses();
      stopRunFrames();
      showIdle();
      petWrap.classList.add('happy');
      fx.textContent = '❤️';
      showBubble(pickLine(BUDDY_LINES), 2200);
      playBlinkDetailed();
      setTimeout(() => {
        if (autoState === 'buddy') {
          clearMotionClasses();
          fx.textContent = '';
          showIdle();
        }
      }, 1400);
      scheduleBlink();
      return;
    }

    if (state === 'buddy-pet') {
      clearMotionClasses();
      stopRunFrames();
      showIdle();
      petWrap.classList.add('wiggle');
      fx.textContent = '✨';
      showBubble(pickLine(BUDDY_PET_LINES), 2600);
      setTimeout(() => {
        if (autoState === 'buddy-pet') {
          clearMotionClasses();
          fx.textContent = '';
          showIdle();
        }
      }, 1300);
      scheduleBlink();
      return;
    }

    if (state === 'sleepy') {
      clearMotionClasses();
      stopRunFrames();
      petWrap.classList.add('sleepy', 'daydream');
      pet.src = asset(sprites.blink);
      fx.innerHTML = '<span class="dream-zzz">Zzz</span>';
      showBubble(pickLine(['Zzz…五分钟就好。', '别吵，本喵在开会。', '困了，先眯一会儿。']), 2800);
      scheduleBlink();
      return;
    }

    if (state === 'stretch') {
      clearMotionClasses();
      stopRunFrames();
      showIdle();
      petWrap.classList.add('wiggle');
      fx.textContent = '✨';
      showBubble(pickLine(['伸个懒腰～', '骨头咔咔响。', '活动一下爪爪。']), 2400);
      setTimeout(() => {
        if (autoState === 'stretch') {
          clearMotionClasses();
          fx.textContent = '';
          showIdle();
        }
      }, 1300);
      scheduleBlink();
      scheduleIdleAction();
      return;
    }

    if (state === 'butterfly') {
      clearMotionClasses();
      stopRunFrames();
      clearTimeout(blinkTimer);
      clearTimeout(idleActionTimer);
      (async () => {
        animating = true;
        await playButterfly();
        animating = false;
        if (autoState === 'butterfly') {
          autoState = 'idle';
          showIdle();
          scheduleBlink();
          scheduleIdleAction();
        }
      })();
      return;
    }

    clearMotionClasses();
    stopRunFrames();
    showIdle();
    scheduleBlink();
    scheduleIdleAction();
  }

  pet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    lastX = e.screenX;
    lastY = e.screenY;
    stopRunFrames();
    stopSeq();
    showIdle();
    clearMotionClasses();
    pet.setPointerCapture(e.pointerId);
  });

  pet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    if (!moved && Math.hypot(dx, dy) > 3) moved = true;
    if (moved) {
      window.petAPI.drag(dx, dy);
      lastX = e.screenX;
      lastY = e.screenY;
    }
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try {
      pet.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    if (moved) {
      window.petAPI.dragEnd();
      autoState = 'idle';
      scheduleBlink();
      scheduleIdleAction();
    } else {
      playAction();
    }
  }

  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);

  petSprite.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.petAPI.showContextMenu();
  });

  window.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      window.petAPI.wheelScale(e.deltaY);
    },
    { passive: false }
  );

  window.petAPI.getSprites().then((s) => {
    if (s) {
      sprites = {
        idle: s.idle,
        blink: s.blink,
        run: s.run || [],
        butterfly: s.butterfly || [],
        blinkSeq: s.blinkSeq || [],
      };
      showIdle();
    }
  });

  window.petAPI.onPetState(applyAutoState);
  scheduleBlink();
  scheduleIdleAction();

  setTimeout(() => {
    showBubble('嗨，我是你的桌面布偶猫～');
    playBlinkDetailed();
  }, 400);
})();
