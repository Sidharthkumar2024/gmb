import { API_BASE, tokenStore } from "./api";

// Download a file from an authed API endpoint. The browser can't send the
// bearer token on a plain <a href>, so we fetch with the Authorization header,
// turn the response into a Blob, and click a temporary object-URL link.
export async function downloadAuthed(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${tokenStore.getAccess() ?? ""}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
