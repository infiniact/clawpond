import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PullProgress = {
  percent: number;
  status: string;
  layers_done: number;
  layers_total: number;
  current_layer: string | null;
};

export async function dockerPullImage(image: string) {
  return invoke("docker_pull_image", { image });
}

export async function dockerImageExists(image: string): Promise<boolean> {
  return invoke<boolean>("docker_image_exists", { image });
}

export async function listenPullProgress(cb: (p: PullProgress) => void) {
  return listen<PullProgress>("docker-pull-progress", (event) => cb(event.payload));
}
