import { request } from "node:http";

const port = Number.parseInt(process.env.TAKEBOARD_PORTAL_PORT ?? "49200", 10);
const hostname = process.env.TAKEBOARD_PORTAL_HOSTNAME ?? "localhost";

await new Promise((resolve) => {
  const healthRequest = request(
    {
      host: "127.0.0.1",
      port,
      path: "/__portal/api/health",
      method: "GET",
      headers: { Host: hostname },
      timeout: 4_000,
    },
    (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const health = JSON.parse(body);
          if (response.statusCode !== 200 || health?.status !== "ok") process.exitCode = 1;
        } catch {
          process.exitCode = 1;
        }
        resolve();
      });
    },
  );
  healthRequest.on("timeout", () => healthRequest.destroy(new Error("health check timed out")));
  healthRequest.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    resolve();
  });
  healthRequest.end();
});
