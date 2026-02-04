export type BeautyMode = "smooth" | "brighten" | "tone" | "detail";

export type BeautyParams = {
  mode: BeautyMode;
  intensity01: number; // 0..1
};

export type FaceMask = {
  // maskCanvas 的 R: face, G: eyes
  canvas: HTMLCanvasElement;
  ready: boolean;
};
