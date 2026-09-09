// Test-only transport: real local TCP forwarding with SSH-shaped arguments.
import { connect, createServer } from "node:net";

const [mode, ...args] = process.argv.slice(2);
for (const required of [
  "ControlPath=none",
  "ControlMaster=no",
  "ControlPersist=no",
  "ForkAfterAuthentication=no",
]) {
  if (!args.includes(required)) throw new Error(`Transport ownership option missing: ${required}`);
}
if (mode === "denied") {
  process.stderr.write("Permission denied (publickey).\n");
  process.exit(255);
}
if (mode === "silent") setInterval(() => {}, 1000);
else {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "-L") continue;
    const mapping = args[index + 1].split(":");
    if (mapping[0] !== "127.0.0.1" || mapping[2] !== "127.0.0.1") process.exit(2);
    const server = createServer((socket) => {
      const upstream = connect({ host: "127.0.0.1", port: Number(mapping[3]) });
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    server.on("error", () => {
      process.stderr.write("bind: Address already in use\n");
      process.exit(255);
    });
    server.listen({ host: "127.0.0.1", port: Number(mapping[1]) });
  }
}
