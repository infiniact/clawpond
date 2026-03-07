/**
 * Open a URL in a new Tauri webview window (in-app browser).
 */
export async function openUrlInWindow(url: string, title?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_url_in_window", {
    url,
    title: title || new URL(url).hostname,
  });
}
