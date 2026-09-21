import React, { useEffect, useState } from "react";

export function MobileAccess() {
  const [status, setStatus] = useState(null),
    [pair, setPair] = useState(null),
    [role, setRole] = useState("contributor"),
    [memberId, setMemberId] = useState("owner"),
    [newMember, setNewMember] = useState({ id: "", name: "", role: "member" }),
    [error, setError] = useState("");
  async function load() {
    try {
      const next = await window.anybot.request("mobile.status");
      setStatus(next);
      if (
        next.members?.length &&
        !next.members.some((member) => member.id === memberId)
      )
        setMemberId(next.members[0].id);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (window.anybot) load();
  }, []);
  return (
    <div className="settings-card">
      <div>
        <h3>Mobile companion</h3>
        <p>
          {status?.enabled
            ? "Pair devices with explicit device and human roles. Each human identity can be revoked and limited to invited conversations."
            : "Mobile access is off. Configure mobile-access.json with a trusted TLS certificate and restart the app before connecting a phone."}
        </p>
        {status?.url && <code>{status.url}</code>}
        {(error || status?.error) && (
          <p role="alert">{error || status.error}</p>
        )}
        {status?.enabled && (
          <>
            <label>
              New device role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="viewer">Viewer — read only</option>
                <option value="contributor">Contributor — send work</option>
                <option value="operator">Operator — send and cancel</option>
              </select>
            </label>
            <label>
              Human member ID <span className="optional">optional</span>
              {status.members?.length ? (
                <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  {status.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={memberId}
                  maxLength={80}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="owner or a configured member ID"
                />
              )}
              <span className="field-hint">
                {status.members?.length
                  ? "Choose a configured human identity for this device."
                  : "This must match a member configured in mobile-access.json when a member list is enabled."}
              </span>
            </label>
            <button
              className="primary"
              onClick={async () => {
                try {
                  setPair(await window.anybot.request("mobile.pair", { role, memberId }));
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Create connection code
            </button>
            {pair && (
              <p>
                Code: <strong>{pair.code}</strong> · expires{" "}
                {new Date(pair.expiresAt).toLocaleTimeString()}. Single use.
              </p>
            )}
            <button className="secondary" onClick={load}>
              Refresh devices
            </button>
            {status.devices.map((d) => (
              <p key={d.id}>
                {d.name} · session expires{" "}
                {new Date(d.expiresAt).toLocaleString()}{" "}
                <button
                  className="secondary"
                  onClick={async () => {
                    await window.anybot.request("mobile.revoke", { id: d.id });
                    await load();
                  }}
                >
                  Revoke device
                </button>
                </p>
            ))}
            {status.enabled && (
              <div className="member-admin">
                <strong>Human members</strong>
                <p className="field-hint">
                  Members can be invited to shared conversations. Removing one
                  immediately revokes their active mobile sessions.
                </p>
                {!status.members?.length && (
                  <p className="field-hint">Only the local owner is configured. Add a member to enable shared human access.</p>
                )}
                {status.members.map((member) => (
                  <p key={member.id}>
                    {member.name} ({member.id}) · {member.role}
                    {member.role !== "owner" && (
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await window.anybot.request("mobile.member.remove", { id: member.id });
                            await load();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </p>
                ))}
                <div className="member-form">
                  <input
                    value={newMember.id}
                    maxLength={160}
                    placeholder="member id"
                    onChange={(e) => setNewMember((current) => ({ ...current, id: e.target.value }))}
                  />
                  <input
                    value={newMember.name}
                    maxLength={60}
                    placeholder="display name"
                    onChange={(e) => setNewMember((current) => ({ ...current, name: e.target.value }))}
                  />
                  <select
                    value={newMember.role}
                    onChange={(e) => setNewMember((current) => ({ ...current, role: e.target.value }))}
                  >
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    className="secondary"
                    disabled={!newMember.id.trim()}
                    onClick={async () => {
                      try {
                        await window.anybot.request("mobile.member.add", newMember);
                        setNewMember({ id: "", name: "", role: "member" });
                        await load();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Add member
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
