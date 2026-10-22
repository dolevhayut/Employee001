import net from "node:net";

/** The address to probe for a bind address: wildcard and localhost binds are reachable on 127.0.0.1. */
function probeHost(bind) {
  return !bind || bind === "0.0.0.0" || bind === "::" || bind === "localhost" ? "127.0.0.1" : bind;
}

/**
 * Whether something already accepts connections on the port. A connect probe
 * catches the common first-run clash (another dev server on 3000) before the
 * server dies with a raw EADDRINUSE stack.
 */
export function isPortInUse(port, bind = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host: probeHost(bind) });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The first free port at or after `from`, or null after `attempts` tries. */
export async function findFreePort(from, bind = "127.0.0.1", attempts = 20) {
  for (let port = Number(from); port < Number(from) + attempts && port <= 65535; port += 1) {
    if (!(await isPortInUse(port, bind))) return port;
  }
  return null;
}
