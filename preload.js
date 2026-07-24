const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  drag: (dx, dy) => ipcRenderer.send('pet-drag', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet-drag-end'),
  userInteract: () => ipcRenderer.send('pet-user-interact'),
  wheelScale: (deltaY) => ipcRenderer.send('pet-wheel-scale', deltaY),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  getScale: () => ipcRenderer.invoke('get-scale'),
  getFlags: () => ipcRenderer.invoke('get-pet-flags'),
  getSprites: () => ipcRenderer.invoke('get-sprites'),
  onScaleChanged: (cb) => {
    const handler = (_e, scale) => cb(scale);
    ipcRenderer.on('scale-changed', handler);
    return () => ipcRenderer.removeListener('scale-changed', handler);
  },
  onPetState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pet-state', handler);
    return () => ipcRenderer.removeListener('pet-state', handler);
  },
});

contextBridge.exposeInMainWorld('childAPI', {
  getSprites: () => ipcRenderer.invoke('get-sprites'),
  onState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('child-state', handler);
    return () => ipcRenderer.removeListener('child-state', handler);
  },
});
