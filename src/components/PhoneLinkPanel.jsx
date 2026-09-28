import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, RefreshCw, Smartphone } from "lucide-react";
import { Modal } from "./Modal.jsx";
import { issueAge } from "../lib/diagnostics.js";
import "./phone-link.css";

const CONNECTION_TEXT = {
  online: ["ok", "Ready for your phone"],
  connecting: ["warn", "Connecting…"],
  offline: ["warn", "Reconnecting…"],
  starting: ["warn", "Starting…"],
  unconfigured: ["off", "Phone connections aren't available in this version yet"],
  error: ["off", "Phone connections couldn't start"],
};

// Settings → Your phone. Pairing is one QR code; the phone then reaches this
// computer through an end-to-end encrypted relay (runtime/phone-link.mjs).
export function PhoneLinkPanel() {
  const [status, setStatus] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const load = () =>
    window.anybot
      ?.request("phone.status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const timer = setInterval(load, pairing ? 1500 : 6000);
    return () => clearInterval(timer);
  }, [Boolean(pairing)]);
  useEffect(() => {
    if (!pairing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  // Step 1 is getting the app: a QR code for the APK on the latest release,
  // offered only when a release carries it. People with a phone already
  // connected start at step 2.
  const [app, setApp] = useState(null);
  const [step, setStep] = useState("connect");
  const showCode = async ({ fresh = true } = {}) => {
    setError("");
    try {
      const [next, download] = await Promise.all([
        window.anybot.request("phone.pair"),
        fresh ? window.anybot.request("phone.app").catch(() => null) : Promise.resolve(app),
      ]);
      const qr = await QRCode.toDataURL(next.link, { errorCorrectionLevel: "M", margin: 1, width: 640 });
      if (fresh) {
        const appQr = download?.available
          ? await QRCode.toDataURL(download.url, { errorCorrectionLevel: "M", margin: 1, width: 640 })
          : null;
        setApp(download ? { ...download, qr: appQr } : null);
        setStep(appQr && !devices.length ? "app" : "connect");
      }
      setPairing({ ...next, qr });
      setNow(Date.now());
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const close = () => {
    if (!paired) window.anybot?.request("phone.cancelPairing").catch(() => {});
    setPairing(null);
  };

  const devices = status?.devices || [];
  const paired = pairing && status?.justPaired && devices.find((d) => d.id === status.justPaired);
  const remaining = pairing ? Math.max(0, pairing.expiresAt - now) : 0;
  const [tone, text] = CONNECTION_TEXT[status?.connection] || CONNECTION_TEXT.starting;
  const available = status && !["unconfigured", "error"].includes(status.connection);

  return (
    <section className="phone-link" aria-labelledby="phone-link-title">
      <h2 id="phone-link-title" className="settings-section-title">
        Your phone
      </h2>
      <div className="settings-card phone-link-card">
        <span className="phone-link-icon" aria-hidden="true">
          <Smartphone size={22} />
        </span>
        <div>
          <h3>Use Any Bot on your phone</h3>
          <p>
            Message your team, send work, and check progress from anywhere. Scan one code and you're done. Your phone and
            this computer talk through an encrypted link, so nothing else can read it.
          </p>
          <p className={`phone-link-status is-${tone}`}>
            <span aria-hidden="true" />
            {status?.connection === "error" && status.error ? `${text}: ${status.error}` : text}
          </p>
        </div>
        <button type="button" className="primary" onClick={() => showCode()} disabled={!available}>
          <Smartphone size={15} />
          Connect a phone
        </button>
      </div>
      {error && !pairing && (
        <p className="phone-link-error" role="alert">
          {error}
        </p>
      )}
      {devices.length > 0 && (
        <ul className="phone-link-devices" aria-label="Connected phones">
          {devices.map((device) => (
            <li key={device.id}>
              <Smartphone size={16} aria-hidden="true" />
              <div>
                <strong>{device.name}</strong>
                <small>{device.connected ? "Connected now" : `Last seen ${issueAge(new Date(device.seen).toISOString())}`}</small>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => window.anybot.request("phone.remove", { id: device.id }).then(load)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {pairing && (
        <Modal title={paired ? "Phone connected" : "Connect a phone"} onClose={close}>
          <div className="phone-pair">
            {paired ? (
              <div className="phone-paired" role="status">
                <span className="phone-paired-mark" aria-hidden="true">
                  <Check size={28} />
                </span>
                <strong>{paired.name} is connected.</strong>
                <p>Your team is in your pocket now. You can close this window.</p>
                <button type="button" className="primary" onClick={close}>
                  Done
                </button>
              </div>
            ) : step === "app" && app?.qr ? (
              <>
                <p className="phone-step-label">Step 1 of 2: get the app</p>
                <img className="phone-qr" src={app.qr} alt="QR code for downloading the Any Bot Android app" />
                <ol className="phone-steps">
                  <li>Point your Android phone's camera at this code and open the link.</li>
                  <li>
                    Open the downloaded <strong>AnyBot-phone.apk</strong>. If Android asks, allow installing apps from your
                    browser.
                  </li>
                </ol>
                <div className="phone-step-actions">
                  <button type="button" className="primary" onClick={() => setStep("connect")}>
                    I have the app
                  </button>
                </div>
              </>
            ) : remaining > 0 ? (
              <>
                {app?.qr && <p className="phone-step-label">Step 2 of 2: connect</p>}
                <img className="phone-qr" src={pairing.qr} alt="QR code for connecting your phone" />
                <ol className="phone-steps">
                  <li>
                    Open the Any Bot app on your phone and tap <strong>Scan QR code</strong>.
                  </li>
                  <li>Point your phone at this code.</li>
                </ol>
                {app?.qr && (
                  <div className="phone-step-actions">
                    <button type="button" className="secondary" onClick={() => setStep("app")}>
                      I need the app
                    </button>
                  </div>
                )}
                <p className="phone-expiry">
                  Works once, for {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")} more.
                  {status?.connection !== "online" && " Waiting for the connection…"}
                </p>
              </>
            ) : (
              <div className="phone-paired">
                <strong>This code expired.</strong>
                <button type="button" className="primary" onClick={() => showCode({ fresh: false })}>
                  <RefreshCw size={15} />
                  Show a new code
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
