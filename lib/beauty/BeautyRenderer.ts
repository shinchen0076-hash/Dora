import { VERT, FRAG, VERT_WGL1, FRAG_WGL1 } from "./shaders";
import type { BeautyParams, FaceMask } from "./types";

type GL = WebGL2RenderingContext | WebGLRenderingContext;

function compile(gl: GL, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(info ?? "Shader compile error");
  }
  return s;
}

function link(gl: GL, vs: WebGLShader, fs: WebGLShader) {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(info ?? "Program link error");
  }
  return p;
}

export class BeautyRenderer {
  canvas: HTMLCanvasElement;
  gl: GL;
  program: WebGLProgram;

  vao: WebGLVertexArrayObject | null;
  tex: WebGLTexture;
  maskTex: WebGLTexture;

  loc: Record<string, WebGLUniformLocation>;
  isWebGL2: boolean;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    const gl2 = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
    const gl = gl2 ?? canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error("WebGL is not supported");
    this.gl = gl;
    this.isWebGL2 = !!gl2;
    const vs = compile(gl, gl.VERTEX_SHADER, this.isWebGL2 ? VERT : VERT_WGL1);
    const fs = compile(gl, gl.FRAGMENT_SHADER, this.isWebGL2 ? FRAG : FRAG_WGL1);
    this.program = link(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.vao = this.isWebGL2 ? (gl as WebGL2RenderingContext).createVertexArray()! : null;
    if (this.vao) (gl as WebGL2RenderingContext).bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.maskTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.loc = {
      uTex: gl.getUniformLocation(this.program, "uTex")!,
      uMask: gl.getUniformLocation(this.program, "uMask")!,
      uTexSize: gl.getUniformLocation(this.program, "uTexSize")!,
      uSrcRect: gl.getUniformLocation(this.program, "uSrcRect")!,
      uMode: gl.getUniformLocation(this.program, "uMode")!,
      uAmt: gl.getUniformLocation(this.program, "uAmt")!
    };

    this.setSize(width, height);
  }

  setSize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  uploadMask(mask: FaceMask) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, mask.canvas);
  }

  render(
    source: TexImageSource,
    sourceSize: { w: number; h: number },
    srcRectNorm: { x: number; y: number; w: number; h: number }, // 0..1
    params: BeautyParams,
    mask: FaceMask
  ) {
    const gl = this.gl;

    gl.useProgram(this.program);
    if (this.vao) (gl as WebGL2RenderingContext).bindVertexArray(this.vao);

    // source texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // mask texture
    this.uploadMask(mask);

    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform1i(this.loc.uMask, 1);
    gl.uniform2f(this.loc.uTexSize, sourceSize.w, sourceSize.h);
    gl.uniform4f(this.loc.uSrcRect, srcRectNorm.x, srcRectNorm.y, srcRectNorm.w, srcRectNorm.h);

    gl.uniform1f(this.loc.uAmt, params.intensity01);

    const modeMap: Record<string, number> = { smooth: 0, brighten: 1, tone: 2, detail: 3 };
    gl.uniform1i(this.loc.uMode, modeMap[params.mode] ?? 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}


