const { app, BrowserWindow } = require("electron");

let window;

app.whenReady().then(() => {
  window = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true
    },
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    transparent: true
  });

  window.loadFile(__dirname + "/templates/whiteboard.html");
});

app.on("window-all-closed", () => {
  setTimeout(() => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  }, 1000);
});
