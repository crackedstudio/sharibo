# Running the e2e suite on a schedule (testnet canary)

There's no CI for this repo by policy (see README — verification stays
local). `scripts/e2e.ts` doubles as the equivalent of a nightly build: it
exercises the full flow against live Stellar testnet infrastructure, so it
fails loudly when the testnet resets, an RPC endpoint changes behavior, or a
dependency update breaks proof encoding. Scheduling it nightly turns that
into an early warning instead of a surprise the next time someone runs it
by hand.

## The foreground-run constraint (authoritative)

**Run `npm run e2e` / `scripts/e2e.ts` in the foreground** when debugging or
when validating a new canary schedule. Do not wrap the script in tooling that
backgrounds the Node process in a way that leaves child HTTP clients stuck
without progress — that failure mode was hit once during the original build
(investigation recorded historically in [NOTES.md](../NOTES.md) Phase 4).

What we know from that investigation:

- Backgrounding via **one particular agent tool's process wrapper** caused
  friendbot/Horizon HTTP calls to hang past their timeouts, while identical
  **foreground** runs succeeded.
- That is **not** the same as "no controlling terminal." A fully detached
  `curl` (nohup, stdin from `/dev/null`, disowned) completed normally in the
  same environment — cron, `launchd`, and systemd timers typically match
  that detached pattern, not the problematic wrapper.

**Still: verify on your own machine before trusting a nightly schedule.**
Run the recipe manually once (`launchctl start` / `run-parts` equivalent /
`systemctl start --wait`) and confirm the log looks like a normal run, not
a hang. If your run *does* hang under the scheduler, do not add a timeout
that silently backgrounds the script further — instead compare against a
plain foreground `npm run e2e` and report the difference; something about
your scheduler's process environment differs from both cases above.

For HTTP client choice in `e2e.ts` (native `fetch` vs `curl`), see the
historical note in NOTES.md Phase 4; the canary constraint is about **process
backgrounding**, not which HTTP API the script uses.

## macOS: `launchd`

Create `~/Library/LaunchAgents/org.sharibo.e2e-canary.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.sharibo.e2e-canary</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>run</string>
    <string>e2e</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/absolute/path/to/sharibo</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>/absolute/path/to/sharibo/scratch/canary/canary.log</string>
  <key>StandardErrorPath</key>
  <string>/absolute/path/to/sharibo/scratch/canary/canary.log</string>
</dict>
</plist>
```

```bash
mkdir -p scratch/canary
launchctl load ~/Library/LaunchAgents/org.sharibo.e2e-canary.plist

# Run it once immediately to verify before waiting for 3am:
launchctl start org.sharibo.e2e-canary
tail -f scratch/canary/canary.log
```

`launchd` always runs jobs with no controlling terminal — this is the
"scheduled, non-interactive" environment the constraint above was checked
against.

## Linux: `cron`

```bash
mkdir -p scratch/canary
crontab -e
```

Add (adjust the path; cron's `PATH` is minimal, so use full paths or source
your shell profile first):

```cron
0 3 * * * cd /absolute/path/to/sharibo && /usr/bin/env bash -lc 'npm run e2e' >> scratch/canary/canary.log 2>&1
```

`bash -lc` loads your login profile so `npm`/`node` resolve the same way
they do in an interactive shell — cron's own environment is deliberately
minimal and won't have your normal `PATH`.

## Linux: `systemd` timer

`~/.config/systemd/user/sharibo-canary.service`:

```ini
[Unit]
Description=Sharibo e2e testnet canary

[Service]
Type=oneshot
WorkingDirectory=/absolute/path/to/sharibo
ExecStart=/usr/bin/env npm run e2e
StandardOutput=append:/absolute/path/to/sharibo/scratch/canary/canary.log
StandardError=append:/absolute/path/to/sharibo/scratch/canary/canary.log
```

`~/.config/systemd/user/sharibo-canary.timer`:

```ini
[Unit]
Description=Run the Sharibo e2e canary nightly

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
mkdir -p scratch/canary
systemctl --user daemon-reload
systemctl --user enable --now sharibo-canary.timer

# Run it once immediately to verify, without waiting for the timer:
systemctl --user start --wait sharibo-canary.service
cat scratch/canary/canary.log
```

## Verifying the schedule actually works

Don't trust the config alone — confirm two consecutive scheduled firings
(not two manual `npm run e2e` calls) produced a log each:

```bash
ls -la scratch/canary/
```

For `launchd`/`systemd`, `Persistent=true` / the default `launchd` behavior
means a missed run (machine asleep) catches up on wake rather than silently
skipping — worth knowing if you're canarying a laptop rather than a server.

## Friendbot quota etiquette

Each full e2e run calls friendbot 7 times (5 members + admin/recipient
funding across rounds). Friendbot rate-limits per source IP.

- **Nightly is fine.** One run a day is well within any reasonable quota.
- **Every 5 minutes is not.** Running this on a tight interval "to catch
  problems faster" will get your IP throttled or blocked, taking down your
  own ability to run the suite at all — including manually, when you
  actually need to debug something.
- If you want faster feedback than nightly, prefer running it by hand when
  you're actively working on something that could break the flow, rather
  than tightening the schedule.

## Reading a failure log: the three common causes

**1. Testnet reset** (see the companion `e2e.ts` testnet-reset check, if
that's landed) — the log stops right after `main()` starts, with a message
naming the contract id and pointing at README "3. Contract" for redeploy
steps, rather than a raw stack trace:

```
Sharibo e2e — full private round on Stellar testnet

Contract CB64... was not found, but RPC (...) reports healthy.
This usually means the Stellar testnet was reset...
```

Action: redeploy per README, update `.env`, done — not a real regression.

**2. RPC flake** — the log gets partway through (some numbered steps
printed), then dies with a `TIMEOUT after 30000ms: <call label>` or a raw
network error from a single RPC call, with no `ASSERTION FAILED` anywhere:

```
3. Funding from all 5 members...
   [1/5] funded from GABC...
   [2/5] funded from GXYZ...
Error: TIMEOUT after 30000ms: fund(member 2)
```

Action: usually transient — re-run. If it repeats across two+ scheduled
nights, escalate; the RPC endpoint may be degraded rather than momentarily
slow.

**3. Real regression** — the log reaches an `ASSERTION FAILED:` with a
specific, meaningful message (a proof rejected that should have been
accepted, a balance that doesn't match, a replay that wasn't rejected):

```
6. Claiming the pot to the fresh recipient...
Error: ASSERTION FAILED: recipient should have received exactly the pot (got delta 0)
```

Action: this is the canary doing its job — something in the circuit,
contract, or client actually broke. Bisect recent changes; don't just
re-run and hope.
