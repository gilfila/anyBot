export function createClient(address, token = "") {
  const url = new URL(address);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Enter the server origin only, without a path or credentials.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      import.meta.env?.DEV &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1"
    )
  )
    throw new Error("Use an HTTPS server address.");
  return {
    origin: url.origin,
    async request(path, { method = "GET", body } = {}) {
      const response = await fetch(`${url.origin}/v1${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok) {
        const error = new Error(value.error || "Connection unavailable");
        error.status = response.status;
        throw error;
      }
      return value;
    },
    // Voice goes through the desktop, which holds the ElevenLabs key.
    async transcribe(blob) {
      const response = await fetch(`${url.origin}/v1/voice/transcribe`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": blob.type || "audio/webm" },
        body: blob,
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Transcription unavailable");
      return value.text || "";
    },
    async speak(text, employeeId) {
      const response = await fetch(`${url.origin}/v1/voice/speak`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ text, employeeId }),
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error || "Voice unavailable");
      }
      return { audio: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") || "audio/mpeg" };
    },
  };
}
