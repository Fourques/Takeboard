export type ConnectionDisplay = {
  kind: "local" | "ssh" | "https" | "portal";
  address: string;
  name?: string | undefined;
  instanceId?: string | undefined;
};

// Display metadata only. Never use a URL fragment to authorize native commands,
// service control, filesystem access or an application session.
export function parseConnectionDisplay(value: string | null): ConnectionDisplay | null {
  if (!value || value.length > 4096) return null;
  try {
    const item = JSON.parse(value);
    if (
      !item ||
      !["local", "ssh", "https", "portal"].includes(item.kind) ||
      typeof item.address !== "string" ||
      item.address.length > 2048 ||
      [...item.address].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      (item.name !== undefined && (typeof item.name !== "string" || item.name.length > 100)) ||
      (item.instanceId !== undefined &&
        (typeof item.instanceId !== "string" || item.instanceId.length > 200))
    )
      return null;
    return { kind: item.kind, address: item.address, name: item.name, instanceId: item.instanceId };
  } catch {
    return null;
  }
}

export function readConnectionDisplay(): ConnectionDisplay | null {
  try {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const raw = hash.get("tb-device");
    const value = parseConnectionDisplay(raw);
    if (value) {
      try {
        sessionStorage.setItem("takeboard.connection-display", JSON.stringify(value));
      } catch {
        return value;
      }
      hash.delete("tb-device");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${hash.size ? `#${hash}` : ""}`,
      );
      return value;
    }
    return parseConnectionDisplay(sessionStorage.getItem("takeboard.connection-display"));
  } catch {
    return null;
  }
}
