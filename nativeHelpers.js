const { exec } = require("child_process");

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function detectDisplays() {
  const out = await run("xrandr --query");
  return out
    .split("\n")
    .filter(l => l.includes(" connected"))
    .map(l => {
      const name = l.split(" ")[0];
      const geo = l.match(/\d+x\d+\+\d+\+\d+/);
      return { name, geometry: geo ? geo[0] : null };
    });
}

async function moveWindowToDisplay(title, display) {
  if (!display) return;
  const x = display.geometry.split("+")[1];
  await run(`wmctrl -a "${title}"`);
  await run(`wmctrl -r :ACTIVE: -e 0,${x},0,-1,-1`);
}

function launchApp(cmd, args = []) {
  const { spawn } = require("child_process");
  const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

module.exports = { detectDisplays, moveWindowToDisplay, launchApp };
