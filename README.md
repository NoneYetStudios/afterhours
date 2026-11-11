# After Hours — STF Arcade

A polished retro-modern office maze survival arcade game inspired by classic 1980s titles like *Night Stalker*. You are the last employee trapped inside STF Corporate Headquarters after everyone else went home. Automated systems have malfunctioned and the building has become increasingly hostile.

Zero build steps. Zero npm/Node dependencies. Pure HTML5 Canvas, Web Audio API, and native CSS on the client, with a lightweight PHP + SQLite backend for the global leaderboard (and an automatic browser Local Development Mode fallback).

---

## 🎮 How to Run Locally

### Option A: Standard PHP Server (Recommended for full leaderboard)
```bash
php -S localhost:8000
```
Open <http://localhost:8000/>. PHP 7.4+ with `pdo_sqlite` enabled will run the production global leaderboard automatically.

### Option B: Local Development Mode (Zero PHP Required)
Open `index.html` directly in any web browser or serve with any simple HTTP server (Python, VSCode Live Server, etc.):
```bash
python -m http.server 8000
```
The game will automatically detect that PHP APIs are not present, activate **Local Development Mode**, display `"Local leaderboard active."`, and store scores in `localStorage` without any error popups.

---

## 🕹️ Controls

| Action | Desktop | Mobile / Touch |
|---|---|---|
| **Move** | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or Arrows | Floating virtual stick on left half of screen |
| **Aim** | Mouse cursor | Auto-aims at closest enemy; drag the button to aim manually |
| **Shoot** | Hold Left Click or <kbd>Space</kbd> | Hold the `STAPLE` virtual button |
| **Pause** | <kbd>P</kbd> or <kbd>Esc</kbd> | `❚❚` Pause chip in top HUD |
| **Sound / Voice** | <kbd>M</kbd> (Audio) / <kbd>V</kbd> (Voice) | `SND` and `VOX` chips in top HUD |

---

## 🏢 Gameplay & Core Systems

- **The Staple Gun:** You never lose the stapler, only the staples. Ammunition is scarce and displayed at all times.
- **Staple Refills (+18):** Highly visible, glowing refills spawn periodically throughout the office. A directional indicator points you to safety when running critically low.
- **Pickups:**
  - **Coffee:** +250 bonus score and temporary speed boost.
  - **Donut:** Restores +30 health.
- **Scoring:** Survival time (10 pts/sec), enemy eliminations, and pickup collection.

### Hostile Assets
1. **Compliance Bot (HP: 4-6, 100 pts):** Relentless basic patroller that follows company policy and the player.
2. **Security Drone (HP: 2-3, 200 pts):** Faster unit that strafes and charges a deadly projectile attack.

### Rare Elite Encounters
- **Executive Vice President (HP: 15, 1,000 pts):** Spawns after 90s. Heavy silver chassis with executive golden badge and briefcase. Chases relentlessly.
- **HR Director (HP: 12, 1,500 pts):** Spawns after 120s. Heavy purple drone firing 3-shot projectile bursts with enhanced tracking.
- **The Janitor (HP: 25, 2,000 pts):** Neutral special event spawning after 180s. Wanders through hallways with mop and bucket, pushing through crowds and damaging hostile units in his path.
- **The CEO (HP: 100, 10,000 pts):** Endgame encounter eligible after 10 minutes. Giant suit silhouette, power tie, and briefcase. Periodically summons compliance bots to the meeting.

---

## 👔 STF Arcade Personality & Polish

- **82+ Title Subtitles:** Random corporate subtitle under the logo on every load (*"Mandatory Overtime"*, *"The Meeting Could Have Been An Email"*, *"Leveraging Core Competencies"*, etc.).
- **102+ Corporate Tips:** Attract-screen style corporate tip cards on the Title, Leaderboard, and Game Over screens.
- **53+ Replay Action Buttons:** Dynamic button variations (*"OVERTIME AGAIN"*, *"SWIPE BADGE AGAIN"*, *"CLOCK BACK IN"*, *"MAXIMIZE SHAREHOLDER VALUE"*, etc.).
- **Procedural Speech Synthesis:** Integrated Web Audio SFX + speech narration with 26+ announcements and an ultra-rare 1-in-100 easter egg line (*"Why are you still here?"*).
- **Early 1980s Retro Pulse Soundtrack:** Synthesized Web Audio ping/pong pulse that builds tension through speed, not pitch.

---

## 🚀 Jethost / Production Deployment Guide

Deploying to **Jethost** (or any standard cPanel / Apache / PHP web host):

### 1. What to Upload
Upload the contents of the `afterhours` directory to your web root or sub-directory (e.g., `public_html/afterhours/`):

```text
/
├── index.html
├── .htaccess             <-- Main Apache protection rules
├── README.md
├── assets/
│   └── favicon.svg
├── css/
│   └── style.css
├── js/
│   ├── config.js         <-- Configurable constants (ARCADE_URL, APIs)
│   ├── lore.js           <-- Lore, tips, subtitles, voice registry
│   ├── map.js            <-- Map collision, rooms, pathfinding
│   ├── audio.js          <-- Web Audio synth & speech synthesis
│   ├── input.js          <-- Keyboard, mouse, touch stick handlers
│   ├── game.js           <-- Simulation, enemies, elite encounters, rendering
│   └── ui.js             <-- Menus, dual-mode leaderboard, game over
├── api/
│   ├── db.php            <-- PDO SQLite connection & table creation
│   ├── leaderboard.php   <-- GET top 25 scores
│   └── submit_score.php  <-- POST score submission & validation
└── data/
    ├── .htaccess         <-- Denies all direct web access to database
    └── .gitkeep
```

### 2. File Permissions
Ensure the `data/` folder has write permissions for PHP (typically `755` or `775` on shared hosting like Jethost). The SQLite database (`data/leaderboard.sqlite`) will automatically be initialized on the first score submission or view.

### 3. Configure the Back Button
In `js/config.js`, set `ARCADE_URL` to your main STF Arcade hub:
```javascript
AH.CONFIG = {
  ARCADE_URL: 'https://arcade.stabthefinger.com',
  ...
};
```

---

## 🔒 Security & Leaderboard Features

- Both Apache 2.4 (`mod_authz_core`) and Apache 2.2 syntax supported in `.htaccess` files.
- `data/.htaccess` completely denies direct web access to the `data/` folder and SQLite database files.
- Root `.htaccess` blocks dotfiles, prevents directory indexing, and protects against direct `.sqlite`/`.db`/`.log` downloads.
- `submit_score.php` features:
  - 1-12 character name sanitization.
  - Plausibility checks on score vs. survival time.
  - SHA-256 IP rate limiting (minimum 3 seconds between submissions).
  - Case-insensitive duplicate handling (one entry per employee, keeping their highest score).
  - Keeps database size bounded to top 500 records.
