# E1 – Equation 1

A top-down 2D racing game that runs in a web browser. Race alone against AI cars,
or with up to 10 friends online using a 6-character joining code.

---

## What's in this folder

```
e1-racing/
├── package.json        The project's "ID card": name, helper libraries, start command
├── server.js           The online "referee": joining codes, lobby, official race results
├── shared/             Rules used by BOTH the server and the browser
│   ├── tracks.js       The 5 track designs (road, grid, checkpoints, barriers)
│   ├── physics.js      How cars move (speed, braking, steering, drift, grass, bumps)
│   ├── race.js         Lap / checkpoint / position rules, and the 10 car colors
│   └── ai.js           The "brain" of the computer-controlled cars
└── public/             Everything the browser downloads
    ├── index.html      The page: main menu, offline setup, lobby, race, results
    ├── style.css       How everything looks
    └── js/
        ├── main.js     The "conductor": screens, buttons, online/offline messages
        ├── game.js     The race: drives your car, draws track & cars, smooth movement
        ├── offline.js  Play Offline: a mini referee running inside the browser
        ├── hud.js      Lap counter, position, times, leaderboard, mini-map, lights
        ├── input.js    Keyboard and phone touch buttons
        └── sound.js    Engine, countdown, crash and finish sounds (made by code)
```

---

## Play it on your computer

1. In VS Code: **Terminal → New Terminal**
2. Go into the game folder:
   ```
   cd C:\Users\ruchi\e1-racing
   ```
3. Start the server:
   ```
   npm start
   ```
   (If PowerShell says *"running scripts is disabled"*, use `npm.cmd start` instead.)
4. Open **http://localhost:3000** in your browser.
5. To stop the server, click in the terminal and press **Ctrl + C**.

### Play with friends on the same Wi-Fi
When the server starts, it prints a line like `Friends on your Wi-Fi: http://192.168.1.23:3000`.
Friends on the same Wi-Fi type that address into their browser. If Windows asks
whether Node.js may use the network, tick **Private networks** and click **Allow**.

### Controls
| Action | Keyboard | Phone |
|---|---|---|
| Accelerate | ↑ or W | GAS |
| Brake / reverse | ↓ or S | BRAKE |
| Steer | ← → or A D | ◀ ▶ |

---

## Get a permanent link (GitHub + Render, both free)

**GitHub** is a website that stores your project's code online (like Google Drive for code).
**Render** is a website that takes your code from GitHub and runs the server for you, 24/7,
with a permanent web address like `https://e1-racing.onrender.com`.

### Part A – Put the project on GitHub (one time)

1. Create a free account at **https://github.com/signup**.
2. Click the **+** (top right) → **New repository**.
   - Repository name: `e1-racing`
   - Choose **Public**
   - Do **not** tick "Add a README" (we already have one)
   - Click **Create repository**
3. Tell Git who you are (once per computer). In the VS Code terminal, inside `C:\Users\ruchi\e1-racing`:
   ```
   git config --global user.name "Your Name"
   git config --global user.email "your-github-email@example.com"
   ```
   *Tip:* to keep your real email private, use the "noreply" address GitHub shows at
   **Settings → Emails** (it looks like `12345678+yourname@users.noreply.github.com`).
4. Save a snapshot of the project (a "commit") and upload it ("push"):
   ```
   git add .
   git commit -m "First version of E1"
   git remote add origin https://github.com/YOUR-USERNAME/e1-racing.git
   git push -u origin main
   ```
   - `git add .` = choose all files to save
   - `git commit` = take the snapshot, with a short note
   - `git remote add` = tell Git where your GitHub project is (replace YOUR-USERNAME)
   - `git push` = upload. A browser window opens to sign in to GitHub the first time.

### Part B – Put it online with Render (one time)

1. Go to **https://render.com** and sign up with **"GitHub"** (easiest).
2. Click **New +** → **Web Service** → choose your `e1-racing` repository.
3. Fill in:
   - **Name:** `e1-racing` (this becomes your link: `https://e1-racing.onrender.com`; if the name is taken, pick another)
   - **Language/Runtime:** Node
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. Click **Create Web Service**. Wait a few minutes until it says **Live**.
5. Your permanent link is shown at the top. Send it to friends!

### Part C – Updating the game later

Whenever you change the game, run these three commands in the `e1-racing` folder:
```
git add .
git commit -m "Describe what you changed"
git push
```
Render notices the new upload and updates the live link automatically within a few
minutes. The link itself never changes.

### Free hosting limits (important!)
- **It falls asleep:** if nobody visits for about 15 minutes, the free server sleeps.
  The next visitor waits about **a minute** while it wakes up. After that it's fast.
  Tip: open the link yourself a minute before your friends join.
- **Games are reset when it sleeps or updates:** joining codes and lobbies are kept in
  the server's memory, so they disappear when the server sleeps, restarts, or you
  push an update. Just host a new game.
- **Monthly hours:** the free plan gives a limited number of running hours per month
  (enough for one small game like this).
- **Play Offline** works on the same link and needs no other players.
