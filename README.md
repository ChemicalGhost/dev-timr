# dev-timr ⏱️

**Smart Development Time Tracker & CLI Wrapper**  
*Collaborative time tracking for engineering teams. Zero friction, simplified.*

[![npm version](https://img.shields.io/npm/v/dev-timr.svg)](https://www.npmjs.com/package/dev-timr)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

`dev-timr` wraps your existing development commands (like `npm run dev`) to automatically track time, visualize your daily activity, and sync data with your team via GitHub Login.

---

## 🚀 Quick Start (No Install Required)

You can run `dev-timr` directly using `npx` without installing it globally.

### 1. 🔐 One-Time Login
Link your GitHub account to enable cloud sync and team stats.
```bash
npx dev-timr login
```

### 2. ⏱️ Start Tracking
Simply put `npx dev-timr` in front of your usual command.
```bash
npx dev-timr "npm run dev"
```
*   **Prompt:** You'll be asked to name your task (e.g., "Fixing Auth Bug").
*   **GUI:** A beautiful dashboard opens in your browser showing real-time stats.
*   **Sync:** Your time is automatically synced to the cloud.

---

## 🛠️ Setting Up in a Project

To make it easier for your whole team to track time, install it as a dev dependency in your project.

### Method 1: Auto-Setup (Recommended)
Calculates dependency & wraps your `dev` script automatically.

```bash
# 1. Install dependency
npm install --save-dev dev-timr

# 2. Run setup script
npx dev-timr-init
```

### Method 2: Manual Setup
1.  **Install:**
    ```bash
    npm install --save-dev dev-timr
    ```

2.  **Edit `package.json`:**
    Modify your start/dev scripts to use `dev-timr`.

    ```json
    "scripts": {
      "dev": "dev-timr \"next dev\"",
      "start": "dev-timr \"node server.js\""
    }
    ```

3.  **Run as usual:**
    ```bash
    npm run dev
    ```
    *Now everyone on the team who runs `npm run dev` will automatically track their time!*

---

## 📊 Features

### 👥 Team Collaboration
See what your team is working on.
*   **CLI:** Run `npx dev-timr stats` to see a leaderboard of time spent on the current repo.
*   **GUI:** In the web dashboard, toggle to **Team View** to see hours by contributor.

### 📈 Task Analytics
*   Input a task name when you start.
*   Visualize time spent per task (e.g., "Bug Fixes" vs "Features") in the dashboard.
*   Smart history remembers your recent tasks for quick selection.

### ⚡ Offline Support
No internet? No problem.
*   `dev-timr` queues your sessions locally.
*   Shows a "Sync Pending" indicator in the GUI.
*   Automatically uploads everything once you're back online.

### 🔄 Migration
Used the old local-only version? Migrate your data to the cloud:
```bash
npx dev-timr migrate
```

---

## 🖥️ CLI Reference

| Command | Description |
| :--- | :--- |
| `dev-timr "cmd"` | Runs `cmd` and tracks time. Opens GUI. |
| `dev-timr login` | Log in via GitHub Device Flow. |
| `dev-timr logout` | Log out and clear local credentials. |
| `dev-timr stats` | View stats for the current repository in terminal. |
| `dev-timr stats --me` | View only your personal stats. |
| `dev-timr migrate` | Upload local `.dev-clock.json` data to cloud. |

---

## ❓ FAQ

**Q: Do I need a Supabase account?**  
A: No! The tool is pre-configured. Just log in with GitHub.

**Q: Where is data stored?**  
A: Data is securely stored in a Supabase PostgreSQL database, associated with your GitHub ID and Repository URL.

**Q: Can I use it for private repos?**  
A: Yes. The tool identifies repos by their git remote URL hash/owner. Data is visible to anyone authenticated who knows the repo name (or you can request a private instance setup).

---

**Created by Allan Bezagrebere (@chemicalGhost)**
