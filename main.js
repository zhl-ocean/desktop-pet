const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let childWindow = null;
let alwaysOnTop = true;
let autoWander = true;
let companionEnabled = true;

const sprites = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'assets', 'sprites.json'), 'utf8')
);

const IDLE_ASPECT = sprites.idleSize.height / sprites.idleSize.width;
const RUN_ASPECT = sprites.runSize.height / sprites.runSize.width;
const BASE_PET_WIDTH = 148; // 默认更小，完整入框
const SIDE_PAD = 56; // 左右留白，防裁切 + 侧边气泡
const BUBBLE_SPACE = 86; // 顶部独立气泡槽
const BOTTOM_PAD = 18;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.2;
const CHILD_SCALE = 0.58; // 相对猫咪更小
let scale = 1;
let mode = 'idle'; // idle | run
let childState = 'idle'; // idle | chase

let behaviorTimer = null;
let walkTimer = null;
let settleTimer = null;
let userBusyUntil = 0;
let isWalking = false;
let facing = 1;
let walkStepMs = 125;

function petSize(forMode = mode) {
  const aspect = forMode === 'run' ? RUN_ASPECT : IDLE_ASPECT;
  const contentW = Math.round(
    BASE_PET_WIDTH * scale * (forMode === 'run' ? 1.4 : 1)
  );
  const contentH = Math.round(contentW * aspect);
  const width = contentW + SIDE_PAD * 2;
  const height = contentH + BUBBLE_SPACE + BOTTOM_PAD;
  return { width, height, contentW, contentH };
}

function childSize() {
  const pet = petSize('idle');
  const contentH = Math.round((pet.contentH || pet.height - BUBBLE_SPACE) * CHILD_SCALE);
  const hatPad = Math.round(48 * scale);
  const bubblePad = Math.round(32 * scale);
  const height = contentH + hatPad + bubblePad;
  const boyAspect =
    (sprites.boy?.idleSize?.width || 2) /
    (sprites.boy?.idleSize?.height || 3);
  const width = Math.round(contentH * boyAspect * 1.2);
  return { width: Math.max(90, width), height: Math.max(150, height) };
}

function now() {
  return Date.now();
}

function markUserBusy(ms = 4500) {
  userBusyUntil = Math.max(userBusyUntil, now() + ms);
  stopWalking(false);
}

function isUserBusy() {
  return now() < userBusyUntil;
}

function getWorkArea() {
  if (!mainWindow) return screen.getPrimaryDisplay().workArea;
  return screen.getDisplayMatching(mainWindow.getBounds()).workArea;
}

function clampToWorkArea(x, y, width, height) {
  const area = getWorkArea();
  return {
    x: Math.min(Math.max(area.x, Math.round(x)), area.x + area.width - width),
    y: Math.min(Math.max(area.y, Math.round(y)), area.y + area.height - height),
  };
}

function sendPetState(state, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const extra =
    state === 'walk' ? { stepMs: walkStepMs, ...payload } : payload;
  mainWindow.webContents.send('pet-state', {
    state,
    facing,
    mode,
    ...extra,
  });
  syncChild(state === 'walk' ? 'chase' : 'idle');
}

function sendChildState(state, extra = {}) {
  if (!childWindow || childWindow.isDestroyed()) return;
  // 静立在猫左侧时始终面向猫咪（朝右）；追赶时跟随猫的朝向
  const look =
    state === 'chase' || state === 'walk' ? facing : 1;
  const payload = {
    state,
    facing: look,
    ...extra,
  };
  if (state === 'chase' || state === 'walk') payload.stepMs = walkStepMs;
  childWindow.webContents.send('child-state', payload);
}

function syncChild(nextState) {
  if (!companionEnabled) {
    if (childWindow && !childWindow.isDestroyed()) childWindow.hide();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!childWindow || childWindow.isDestroyed()) createChildWindow();

  childState = nextState || childState;
  const pet = mainWindow.getBounds();
  const { width, height } = childSize();
  const gap =
    childState === 'play' ||
    childState === 'reach' ||
    childState === 'act'
      ? Math.round(2 * scale)
      : Math.round(10 * scale);

  // 停下/互动：在猫咪左侧；追赶：跟在身后
  let x;
  if (childState === 'chase') {
    x = facing >= 0 ? pet.x - width - gap : pet.x + pet.width + gap;
  } else {
    x = pet.x - width - gap;
  }
  const y = pet.y + pet.height - height;
  const pos = clampToWorkArea(x, y, width, height);
  childWindow.setBounds({ x: pos.x, y: pos.y, width, height });
  childWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  if (!childWindow.isVisible()) childWindow.showInactive();
  sendChildState(childState);
}

function setMode(nextMode, anchor = 'bottom') {
  if (!mainWindow) return;
  if (mode === nextMode) {
    mode = nextMode;
    syncChild(isWalking ? 'chase' : 'idle');
    return;
  }
  const prev = mainWindow.getBounds();
  mode = nextMode;
  const { width, height } = petSize(mode);
  let x = prev.x + Math.round((prev.width - width) / 2);
  let y =
    anchor === 'bottom'
      ? prev.y + prev.height - height
      : prev.y + Math.round((prev.height - height) / 2);
  const pos = clampToWorkArea(x, y, width, height);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width, height });
  syncChild(isWalking ? 'chase' : 'idle');
}

function stopWalking(notify = true) {
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (isWalking) {
    isWalking = false;
    setMode('idle', 'bottom');
    if (notify) sendPetState('idle');
    else syncChild('idle');
  }
}

function pickRandomTarget(shortHop = false) {
  const { width, height } = petSize('run');
  const area = getWorkArea();
  const margin = 20;
  const bounds = mainWindow ? mainWindow.getBounds() : { x: area.x, y: area.y };
  const childW = childSize().width + 20;

  if (shortHop) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 200;
    return clampToWorkArea(
      bounds.x + Math.cos(angle) * dist,
      bounds.y + Math.sin(angle) * dist,
      width,
      height
    );
  }

  const x =
    area.x +
    margin +
    childW +
    Math.random() * Math.max(1, area.width - width - margin * 2 - childW);
  const y =
    area.y +
    margin +
    Math.random() * Math.max(1, area.height - height - margin * 2);
  return { x: Math.round(x), y: Math.round(y) };
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.fn;
  }
  return items[items.length - 1].fn;
}

function startWalkTo(target) {
  if (!mainWindow || isWalking) return;

  setMode('run', 'bottom');
  const bounds = mainWindow.getBounds();
  const startX = bounds.x;
  const startY = bounds.y;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const dist = Math.hypot(dx, dy);
  if (dist < 24) {
    stopWalking(false);
    beginSettleThenAct();
    return;
  }

  if (Math.abs(dx) > 8) {
    facing = dx >= 0 ? 1 : -1;
  }

  // 跑动时长与速度都随机：短冲刺 / 中距离 / 长巡逻
  const speed = randBetween(70, 175);
  walkStepMs = Math.round(Math.max(95, Math.min(150, 14000 / speed)));
  const durationRoll = Math.random();
  let duration;
  if (durationRoll < 0.3) {
    duration = randBetween(900, 1800); // 短跑
  } else if (durationRoll < 0.75) {
    duration = randBetween(1800, 4200); // 中跑
  } else {
    duration = randBetween(4200, 7500); // 长跑
  }
  // 仍受距离约束，避免瞬移感
  duration = Math.min(duration, Math.max(800, (dist / Math.max(40, speed * 0.55)) * 1000));

  isWalking = true;
  sendPetState('walk');
  const started = now();

  walkTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopWalking(false);
      return;
    }
    if (isUserBusy() || !autoWander) {
      stopWalking(true);
      scheduleNextBehavior();
      return;
    }

    const t = Math.min(1, (now() - started) / duration);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = startX + dx * e;
    const y = startY + dy * e;
    const { width, height } = mainWindow.getBounds();
    const pos = clampToWorkArea(x, y, width, height);
    mainWindow.setBounds({ x: pos.x, y: pos.y, width, height });
    syncChild('chase');

    if (t >= 1) {
      stopWalking(false);
      // 先短暂站定，再接随机互动，衔接更自然
      beginSettleThenAct();
    }
  }, 30);
}

function beginSettleThenAct() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setMode('idle', 'bottom');
  sendPetState('pause');
  if (companionEnabled) syncChild('idle');
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || isUserBusy() || isWalking) {
      scheduleNextBehavior(idleWait());
      return;
    }
    beginRandomIdleAction();
  }, randBetween(700, 1400));
}

function beginRandomIdleAction() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const actions = [
    { w: 16, fn: () => beginBuddyCatch() },
    { w: 14, fn: () => beginBuddyPet() },
    { w: 12, fn: () => beginBuddyOffer() },
    { w: 14, fn: () => beginButterfly() },
    { w: 12, fn: () => beginDaydream() },
    { w: 12, fn: () => beginSleepy() },
    { w: 12, fn: () => beginStretch() },
    { w: 8, fn: () => beginPause() },
  ];
  const pool = companionEnabled
    ? actions
    : actions.filter(
        (a) =>
          a.fn !== beginBuddyCatch &&
          a.fn !== beginBuddyPet &&
          a.fn !== beginBuddyOffer
      );
  pickWeighted(pool)();
}

function idleWait() {
  // 停下后停留 5~11 秒再进入下一轮
  return randBetween(5000, 11000);
}

function sendBoyAct(act, say, holdMs = 1700) {
  if (!companionEnabled) return;
  childState = 'act';
  syncChild('act');
  sendChildState('act', { act, say, holdMs });
}

function beginPause() {
  setMode('idle', 'bottom');
  sendPetState('pause');
  if (companionEnabled) {
    // 停下时人物也随机做个小动作
    const acts = ['stretch', 'yawn', 'laugh'];
    const act = acts[Math.floor(Math.random() * acts.length)];
    sendBoyAct(act);
  } else {
    syncChild('idle');
  }
  scheduleNextBehavior(idleWait());
}

function beginSleepy() {
  setMode('idle', 'bottom');
  sendPetState('sleepy');
  if (companionEnabled) {
    sendBoyAct(
      'yawn',
      Math.random() < 0.5 ? '哈欠……猫猫困了' : '我也想睡…',
      1900
    );
  }
  scheduleNextBehavior(idleWait());
}

function beginStretch() {
  setMode('idle', 'bottom');
  sendPetState('stretch');
  if (companionEnabled) {
    sendBoyAct('stretch', '一起伸懒腰～', 1800);
  }
  scheduleNextBehavior(idleWait());
}

function beginButterfly() {
  setMode('idle', 'bottom');
  sendPetState('butterfly');
  if (companionEnabled) {
    sendBoyAct(
      'laugh',
      ['蝴蝶！', '好好看！', '哈哈抓蝴蝶～'][Math.floor(Math.random() * 3)],
      1800
    );
  }
  scheduleNextBehavior(idleWait());
}

function beginBuddyCatch() {
  if (!mainWindow || !companionEnabled) {
    beginButterfly();
    return;
  }
  setMode('idle', 'bottom');
  childState = 'play';
  syncChild('play');
  sendChildState('act', {
    act: 'laugh',
    say: ['抓住你啦！', '嘿嘿追上了', '哈哈哈！'][Math.floor(Math.random() * 3)],
    holdMs: 1800,
  });
  sendPetState('buddy');
  scheduleNextBehavior(idleWait());
}

function beginBuddyPet() {
  if (!mainWindow || !companionEnabled) {
    beginPause();
    return;
  }
  setMode('idle', 'bottom');
  childState = 'reach';
  syncChild('reach');
  sendChildState('act', {
    act: 'pet',
    say: ['摸摸毛毛～', '软软的！', '乖猫猫'][Math.floor(Math.random() * 3)],
    holdMs: 1900,
  });
  sendPetState('buddy-pet');
  scheduleNextBehavior(idleWait());
}

function beginBuddyOffer() {
  if (!mainWindow || !companionEnabled) {
    beginPause();
    return;
  }
  setMode('idle', 'bottom');
  childState = 'reach';
  syncChild('reach');
  sendChildState('act', {
    act: 'offer',
    say: ['给你喝果汁？', '分你一口～', '甜甜的哦'][Math.floor(Math.random() * 3)],
    holdMs: 2000,
  });
  sendPetState('buddy-pet');
  scheduleNextBehavior(idleWait());
}

function beginDaydream() {
  if (!mainWindow) return;
  setMode('idle', 'bottom');
  sendPetState('daydream');
  if (companionEnabled) {
    sendBoyAct(
      Math.random() < 0.6 ? 'yawn' : 'stretch',
      Math.random() < 0.5 ? '嘘，猫猫在发呆…' : '安静陪着～',
      2000
    );
  }
  scheduleNextBehavior(idleWait());
}

function clearBehaviorTimer() {
  if (behaviorTimer) {
    clearTimeout(behaviorTimer);
    behaviorTimer = null;
  }
}

function scheduleNextBehavior(delay) {
  clearBehaviorTimer();
  if (!autoWander) return;

  // 默认停下等待 5~11 秒
  const wait = typeof delay === 'number' ? delay : idleWait();

  behaviorTimer = setTimeout(() => {
    behaviorTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!autoWander || isUserBusy() || isWalking) {
      scheduleNextBehavior(randBetween(5000, 8000));
      return;
    }

    const roll = Math.random();
    if (roll < 0.55) {
      startWalkTo(pickRandomTarget(Math.random() < 0.75));
    } else {
      beginRandomIdleAction();
    }
  }, wait);
}

function setAutoWander(enabled) {
  autoWander = enabled;
  if (!autoWander) {
    clearBehaviorTimer();
    stopWalking(true);
    sendPetState('idle');
  } else {
    scheduleNextBehavior(1000);
  }
}

function createChildWindow() {
  if (childWindow && !childWindow.isDestroyed()) return;
  const { width, height } = childSize();
  childWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  childWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  childWindow.setIgnoreMouseEvents(true, { forward: true });
  childWindow.loadFile('child.html');
  childWindow.once('ready-to-show', () => {
    if (companionEnabled) {
      syncChild('idle');
      childWindow.showInactive();
    }
  });
  childWindow.on('closed', () => {
    childWindow = null;
  });
}

function createWindow() {
  const { width, height } = petSize('idle');
  const display = screen.getPrimaryDisplay().workArea;
  const x = Math.round(display.x + display.width - width - 80);
  const y = Math.round(display.y + display.height - height - 40);

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    createChildWindow();
    sendPetState('idle');
    scheduleNextBehavior(2200);
  });

  mainWindow.on('move', () => {
    if (!isWalking) syncChild(childState);
  });

  mainWindow.on('closed', () => {
    clearBehaviorTimer();
    stopWalking(false);
    if (childWindow && !childWindow.isDestroyed()) childWindow.close();
    mainWindow = null;
  });
}

function applyScale(nextScale, anchor) {
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  if (!mainWindow) return;

  const { width, height } = petSize();
  const bounds = mainWindow.getBounds();
  let x = bounds.x;
  let y = bounds.y;

  if (anchor === 'center') {
    x = Math.round(bounds.x + (bounds.width - width) / 2);
    y = Math.round(bounds.y + (bounds.height - height) / 2);
  } else if (anchor === 'bottom') {
    x = Math.round(bounds.x + (bounds.width - width) / 2);
    y = bounds.y + bounds.height - height;
  }

  const pos = clampToWorkArea(x, y, width, height);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width, height });
  mainWindow.webContents.send('scale-changed', scale);
  syncChild(isWalking ? 'chase' : 'idle');
}

function snapToEdges() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const threshold = 36;
  let { x, y, width, height } = bounds;

  if (x - display.x <= threshold) x = display.x;
  else if (display.x + display.width - (x + width) <= threshold) {
    x = display.x + display.width - width;
  }

  if (y - display.y <= threshold) y = display.y;
  else if (display.y + display.height - (y + height) <= threshold) {
    y = display.y + display.height - height;
  }

  const pos = clampToWorkArea(x, y, width, height);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width, height });
  syncChild('idle');
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: '调整大小',
      submenu: [
        { label: '很小 (50%)', click: () => applyScale(0.5, 'bottom') },
        { label: '较小 (75%)', click: () => applyScale(0.75, 'bottom') },
        { label: '默认', click: () => applyScale(1, 'bottom') },
        { label: '较大 (125%)', click: () => applyScale(1.25, 'bottom') },
        { label: '很大 (160%)', click: () => applyScale(1.6, 'bottom') },
        { type: 'separator' },
        { label: '放大一点', click: () => applyScale(scale + 0.1, 'bottom') },
        { label: '缩小一点', click: () => applyScale(scale - 0.1, 'bottom') },
      ],
    },
    {
      label: autoWander ? '停止自主走动' : '开启自主走动',
      click: () => setAutoWander(!autoWander),
    },
    {
      label: companionEnabled ? '隐藏陪伴小人' : '显示陪伴小人',
      click: () => {
        companionEnabled = !companionEnabled;
        if (!companionEnabled) {
          if (childWindow && !childWindow.isDestroyed()) childWindow.hide();
        } else {
          syncChild(isWalking ? 'chase' : 'idle');
        }
      },
    },
    {
      label: alwaysOnTop ? '取消置顶' : '窗口置顶',
      click: () => {
        alwaysOnTop = !alwaysOnTop;
        if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
        if (childWindow && !childWindow.isDestroyed()) {
          childWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => app.quit(),
    },
  ]);
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('pet-drag', (_event, { dx, dy }) => {
    if (!mainWindow) return;
    markUserBusy(5000);
    setMode('idle', 'bottom');
    const b = mainWindow.getBounds();
    const pos = clampToWorkArea(b.x + dx, b.y + dy, b.width, b.height);
    mainWindow.setBounds({
      x: pos.x,
      y: pos.y,
      width: b.width,
      height: b.height,
    });
    syncChild('idle');
  });

  ipcMain.on('pet-drag-end', () => {
    snapToEdges();
    markUserBusy(3500);
    scheduleNextBehavior(3500);
  });

  ipcMain.on('pet-user-interact', () => {
    markUserBusy(5000);
    setMode('idle', 'bottom');
    if (companionEnabled) {
      childState = 'play';
      syncChild('play');
      sendChildState('act', {
        act: 'laugh',
        say: ['点到猫猫啦！', '我也要玩！', '嘿嘿～'][
          Math.floor(Math.random() * 3)
        ],
        holdMs: 1600,
      });
    }
    scheduleNextBehavior(5000);
  });

  ipcMain.on('pet-wheel-scale', (_event, deltaY) => {
    const step = deltaY > 0 ? -0.08 : 0.08;
    applyScale(scale + step, 'bottom');
  });

  ipcMain.on('show-context-menu', () => {
    markUserBusy(2000);
    buildContextMenu().popup({ window: mainWindow });
  });

  ipcMain.handle('get-scale', () => scale);
  ipcMain.handle('get-pet-flags', () => ({
    alwaysOnTop,
    autoWander,
    companionEnabled,
  }));
  ipcMain.handle('get-sprites', () => sprites);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
