// Offline probe: block every outbound connection that is not loopback, so
// running the unit suite under it *proves* the suite makes no external network
// calls. It is the executable form of the rule in CONTRIBUTING.md
// ("Tests must be hermetic").
//
//   npm run test:offline --workspace=scripts     # from the repo root
//   just scripts-test-offline
//
// The suite must pass with this loaded. If it does not, a test is reaching the
// network and `hermeticity.test.ts` will usually have already flagged the
// offending file.
//
// Design notes:
// - Loopback is allowed through, both at the socket and the DNS layer, because
//   a hermetic test is *expected* to start a local http.createServer
//   (see smoke.test.ts) and because tsx's own loader uses an IPC channel.
// - Unix sockets / named pipes / numeric fds are never TCP and pass through.
// - Blocking is implemented by short-circuiting before the real connect, so a
//   blocked call fails fast with a BLOCKED-BY-HERMETICITY-PROBE error rather
//   than hanging until a timeout.

import net from "node:net";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";

const LOOPBACK = /^(127\.|::1$|localhost$|0:0:0:0:0:0:0:1$)/i;

function hostOf(opts) {
  // A bare string is a named pipe / unix socket path, or a numeric fd - both
  // local by definition. Windows named pipes look like \\.\pipe\name.
  if (typeof opts === "string") return /^[.\\/]/.test(opts) ? null : opts;
  if (typeof opts === "number") return null;
  if (opts && typeof opts === "object") {
    if (opts.path) return null; // IPC / unix socket - always local
    if (typeof opts.port === "number") return String(opts.host || "127.0.0.1");
    if (opts.host) return String(opts.host);
  }
  return null; // unix socket / unknown shape: let it through
}

function blocked(what, host) {
  return Object.assign(new Error(`BLOCKED-BY-HERMETICITY-PROBE: ${what} ${host}`), {
    code: "EBLOCKED",
  });
}

function block(what, orig) {
  return function (...args) {
    const host = hostOf(args[0]);
    if (host !== null && !LOOPBACK.test(host)) {
      const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
      if (cb) return cb(blocked(what, host));
      return Promise.reject(blocked(what, host));
    }
    return orig.apply(this, args);
  };
}

net.Socket.prototype.connect = block("tcp", net.Socket.prototype.connect);
net.connect = block("net.connect", net.connect);
net.createConnection = block("net.createConnection", net.createConnection);

const realLookup = dns.lookup.bind(dns);

const denyDns = (what) =>
  function (hostname, ...rest) {
    // Loopback still needs DNS ("127.0.0.1" resolution for server.listen).
    if (LOOPBACK.test(String(hostname))) return realLookup(hostname, ...rest);
    const cb = typeof rest[rest.length - 1] === "function" ? rest[rest.length - 1] : null;
    if (cb) return cb(blocked(what, hostname));
    return Promise.reject(blocked(what, hostname));
  };

dns.lookup = denyDns("dns.lookup");
dnsPromises.lookup = denyDns("dns/promises.lookup");
