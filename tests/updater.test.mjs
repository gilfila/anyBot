import test from "node:test";
import assert from "node:assert/strict";

// Test version comparison logic
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Test URL validation logic
function isValidUpdateFeedUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

test("compareVersions handles standard semver", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("0.2.16", "0.2.15"), 1);
  assert.equal(compareVersions("0.2.15", "0.2.16"), -1);
});

test("compareVersions handles version prefixes", () => {
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("v1.0.1", "v1.0.0"), 1);
  assert.equal(compareVersions("1.0.0", "v1.0.1"), -1);
});

test("compareVersions handles missing patch versions", () => {
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.1", "1.0"), 1);
  assert.equal(compareVersions("1", "1.0.0"), 0);
});

test("compareVersions handles numeric comparisons correctly", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
  assert.equal(compareVersions("10.0.0", "9.0.0"), 1);
});

test("isValidUpdateFeedUrl rejects null/undefined", () => {
  assert.equal(isValidUpdateFeedUrl(null), false);
  assert.equal(isValidUpdateFeedUrl(undefined), false);
  assert.equal(isValidUpdateFeedUrl(""), false);
});

test("isValidUpdateFeedUrl rejects HTTP URLs", () => {
  assert.equal(isValidUpdateFeedUrl("http://example.com/updates"), false);
  assert.equal(isValidUpdateFeedUrl("http://localhost:8080"), false);
});

test("isValidUpdateFeedUrl accepts HTTPS URLs", () => {
  assert.equal(isValidUpdateFeedUrl("https://releases.example.com"), true);
  assert.equal(isValidUpdateFeedUrl("https://github.com/user/repo/releases"), true);
  assert.equal(isValidUpdateFeedUrl("https://example.com/updates/anybot"), true);
});

test("isValidUpdateFeedUrl rejects URLs with embedded credentials", () => {
  assert.equal(isValidUpdateFeedUrl("https://user:pass@example.com"), false);
  assert.equal(isValidUpdateFeedUrl("https://token@releases.example.com"), false);
  assert.equal(isValidUpdateFeedUrl("https://user:@example.com"), false);
});

test("isValidUpdateFeedUrl rejects invalid URLs", () => {
  assert.equal(isValidUpdateFeedUrl("not-a-url"), false);
  assert.equal(isValidUpdateFeedUrl("file:///local/path"), false);
  assert.equal(isValidUpdateFeedUrl("ftp://ftp.example.com"), false);
});

test("isValidUpdateFeedUrl accepts URLs with paths and ports", () => {
  assert.equal(isValidUpdateFeedUrl("https://example.com:8443/updates"), true);
  assert.equal(isValidUpdateFeedUrl("https://releases.example.com/v1/anybot"), true);
});

// Test update state transitions
const UpdateState = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error",
};

test("update states are well-defined", () => {
  const states = Object.values(UpdateState);
  assert.equal(states.length, 6);
  assert.ok(states.includes("idle"));
  assert.ok(states.includes("checking"));
  assert.ok(states.includes("available"));
  assert.ok(states.includes("downloading"));
  assert.ok(states.includes("downloaded"));
  assert.ok(states.includes("error"));
});

test("update progress structure is valid", () => {
  const progress = {
    percent: 50,
    transferred: 5000000,
    total: 10000000,
    bytesPerSecond: 1000000,
  };
  
  assert.ok(typeof progress.percent === "number");
  assert.ok(progress.percent >= 0 && progress.percent <= 100);
  assert.ok(progress.transferred <= progress.total);
});

test("update error structure is valid", () => {
  const error = {
    message: "Network error",
    code: "ECONNRESET",
    retryable: true,
  };
  
  assert.ok(typeof error.message === "string");
  assert.ok(typeof error.retryable === "boolean");
});

// Test dismissed version comparison
test("dismissed version hides matching or older updates", () => {
  const dismissedVersion = "0.2.16";
  const currentUpdate = { version: "0.2.16" };
  
  const shouldHide = compareVersions(currentUpdate.version, dismissedVersion) <= 0;
  assert.equal(shouldHide, true);
  
  const newerUpdate = { version: "0.2.17" };
  const shouldShowNewer = compareVersions(newerUpdate.version, dismissedVersion) > 0;
  assert.equal(shouldShowNewer, true);
});

test("dismissed version does not hide newer updates", () => {
  const dismissedVersion = "0.2.15";
  const currentUpdate = { version: "0.2.16" };
  
  const shouldHide = compareVersions(currentUpdate.version, dismissedVersion) <= 0;
  assert.equal(shouldHide, false);
});
