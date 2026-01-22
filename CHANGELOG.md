# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-01-22

### Fixed
- Timer now correctly stops when the server disconnects instead of continuing to count
- Added "Session Ended" indicator when connection is lost

---

## [2.0.0] - 2026-01-20

### Added
- **Cloud Collaboration**: Sync time tracking data via Supabase backend
- **GitHub OAuth Login**: Authenticate with `dev-timr login` using GitHub Device Flow
- **Team Statistics**: View team leaderboards and contributions with `dev-timr stats`
- **Task Naming**: Associate task names with sessions; smart history for quick selection
- **Offline Support**: Queue sessions locally when offline, auto-sync when back online
- **Migration Command**: Transfer existing `.dev-clock.json` data to cloud with `dev-timr migrate`
- **Self-Hosting**: Configure custom Supabase instance with `dev-timr-setup`
- **Picture-in-Picture Mode**: Compact circular timer overlay for minimal screen usage
- **UI Customization**: Background colors, glassmorphism blur, card darkness settings
- **Pause/Resume**: Pause timer without stopping the session

### Security
- AES-256-GCM encryption for local token storage
- PBKDF2 key derivation (100,000 iterations)
- Row Level Security (RLS) on all database tables
- Shell command injection protection via input validation
- Rate limiting on local GUI server

---

## [1.0.0] - 2026-01-11

### Added
- Initial public release
- Automatic time tracking when wrapping dev commands
- Web-based GUI with real-time timer
- Daily activity charts
- Local storage in `.dev-clock.json`
- `dev-timr-init` for easy project setup
