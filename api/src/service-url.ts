/** Credential-bearing services use TLS; only local development may use plaintext loopback. */
export function validateServiceUrl(value: string, name: string, env: NodeJS.ProcessEnv, websocket = false): void {
  if (!URL.canParse(value)) throw new Error(`${name} is not a URL`);
  const url = new URL(value);
  const local = !env.RENDER_GIT_COMMIT && env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:" || (websocket && url.protocol === "wss:");
  const development = local && (url.protocol === "http:" || (websocket && url.protocol === "ws:"));
  if ((!secure && !development) || url.username || url.password || url.hash) {
    throw new Error(`${name} requires HTTPS${websocket ? " or WSS" : ""}, without URL credentials or a fragment (plaintext loopback is allowed only in development)`);
  }
}
