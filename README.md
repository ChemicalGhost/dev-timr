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
# or
npx dev-timr npm run dev
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
| `dev-timr-setup` | Configure custom Supabase instance (self-hosting). |

---

## 🔒 Security & Self-Hosting

### Security Model

Dev-Timr uses enterprise-grade security:
- **GitHub OAuth** for authentication (no passwords)
- **Row Level Security (RLS)** on all database tables
- **AES-256-GCM encryption** for local token storage
- **PBKDF2 key derivation** (100,000 iterations) for encryption keys
- **JWT tokens** with 7-day expiration
- **Local file permissions** (0o600 on auth files)
- **HTTPS-only** API communication
- **Rate limiting** on local GUI server
- **Input validation** on all user inputs

All user data is isolated by Row Level Security policies. Users can only access their own sessions and team data for repositories they've contributed to.

### Shared Instance (Default)

By default, Dev-Timr uses a shared Supabase instance for easy collaboration:
- ✅ Zero configuration required
- ✅ Works with teams across organizations
- ✅ Protected by RLS policies
- ✅ Suitable for most users

### Self-Hosted Instance

For organizations requiring complete control:

```bash
# Run interactive setup
npx dev-timr-setup

# Or set environment variables
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
export GITHUB_CLIENT_ID=your-github-client-id
```

**Benefits of self-hosting:**
- Complete data control
- Custom compliance requirements
- Private network deployment
- Custom retention policies

See [SECURITY.md](SECURITY.md) for detailed self-hosting instructions, RLS policies, and security best practices.

---

## ❓ FAQ

**Q: Do I need a Supabase account?**
A: No! The shared instance is pre-configured. Just log in with GitHub. You can optionally self-host your own instance using `dev-timr-setup`.

**Q: Where is data stored?**
A: Data is securely stored in a Supabase PostgreSQL database with Row Level Security. By default, it uses the shared instance. You can configure your own instance via environment variables or the setup command.

**Q: Can I use it for private repos?**
A: Yes. The tool identifies repos by their git remote URL. Data is protected by RLS policies - you can only see your own data and team data for repos you've contributed to.

**Q: How secure is the shared instance?**
A: Very secure. Row Level Security ensures complete data isolation between users. Only authenticated users can access their own sessions and team data for repositories they've worked on. See [SECURITY.md](SECURITY.md) for details.

**Q: Can I rotate the credentials?**
A: Yes. The shared instance credentials are rotated periodically. For self-hosted instances, you have complete control over credential rotation.

---

**Created by Allan Bezagrebere (@chemicalGhost)**
