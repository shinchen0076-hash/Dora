export const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = (aPos + 1.0) * 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uMask;  // R: face, G: eyes
uniform vec2 uTexSize;
uniform vec4 uSrcRect;    // normalized: x,y,w,h (source crop)
uniform int uMode;        // 0 smooth,1 brighten,2 tone,3 detail
uniform float uAmt;       // 0..1

in vec2 vUv;
out vec4 outColor;

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6. * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1., 2./3., 1./3., 3.);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y);
}

vec3 sampleSrc(vec2 uv){
  vec2 suv = uSrcRect.xy + uv * uSrcRect.zw;
  return texture(uTex, suv).rgb;
}
float sampleFace(vec2 uv){
  return texture(uMask, uv).r;
}
float sampleEye(vec2 uv){
  return texture(uMask, uv).g;
}

vec3 bilateral(vec2 uv, float faceMask){
  // 9 taps bilateral-ish: 保邊平滑（非單純模糊）
  vec3 center = sampleSrc(uv);
  float sigmaS = mix(1.0, 3.0, uAmt);
  float sigmaR = mix(0.06, 0.16, uAmt);
  vec2 texel = 1.0 / uTexSize;

  vec3 sum = vec3(0.0);
  float wsum = 0.0;

  for(int y=-1; y<=1; y++){
    for(int x=-1; x<=1; x++){
      vec2 o = vec2(float(x), float(y));
      vec2 u2 = uv + o * texel * sigmaS;
      vec3 c2 = sampleSrc(u2);

      float ds = dot(o,o);
      float ws = exp(-ds / (2.0*sigmaS*sigmaS));
      float dr = length(c2 - center);
      float wr = exp(-(dr*dr) / (2.0*sigmaR*sigmaR));
      float w = ws * wr;
      sum += c2 * w;
      wsum += w;
    }
  }

  vec3 smooth = sum / max(wsum, 1e-6);
  // 只在 faceMask 範圍內混合，避免整張變糊
  return mix(center, smooth, faceMask);
}

vec3 brighten(vec3 c, float faceMask){
  // 透亮美白：中間調提升 + 輕微 gamma，避免過曝
  float amt = uAmt * faceMask;
  // midtone lift
  vec3 lifted = c + amt * (1.0 - c) * 0.18;
  // gamma < 1 = 變亮，但用小幅度
  float g = mix(1.0, 0.88, amt);
  vec3 gamma = pow(max(lifted, 0.0), vec3(g));
  // highlight compression
  vec3 comp = gamma / (gamma + vec3(0.25));
  return mix(c, comp, amt);
}

vec3 tone(vec3 c, float faceMask){
  // 膚色校正：HSV 微調（減紅/減黃）+ 降低過度飽和
  float amt = uAmt * faceMask;
  vec3 h = rgb2hsv(c);
  // 皮膚常落在橘紅區，微往中性移動
  // hue 以 0..1 表示，少量往 0.08（偏橘）靠攏，並降低飽和
  float target = 0.08;
  float dh = target - h.x;
  // 將差值 wrap 到 [-0.5,0.5]
  if (dh > 0.5) dh -= 1.0;
  if (dh < -0.5) dh += 1.0;
  h.x = fract(h.x + dh * 0.10 * amt);
  h.y = clamp(h.y * (1.0 - 0.18 * amt), 0.0, 1.0);
  vec3 outc = hsv2rgb(h);
  return mix(c, outc, amt);
}

vec3 detail(vec2 uv, float faceMask, float eyeMask){
  // 立體細節：對「非肌膚」做輕微 unsharp，避免噪點被放大
  vec3 c = sampleSrc(uv);
  vec2 texel = 1.0 / uTexSize;
  vec3 blur = (
    sampleSrc(uv + vec2(-1.0, 0.0) * texel) +
    sampleSrc(uv + vec2( 1.0, 0.0) * texel) +
    sampleSrc(uv + vec2(0.0,-1.0) * texel) +
    sampleSrc(uv + vec2(0.0, 1.0) * texel) +
    c
  ) / 5.0;

  vec3 hp = c - blur;
  float nonSkin = (1.0 - faceMask);
  float amt = uAmt * nonSkin;

  // 抑制噪點：對高頻能量做 soft-threshold
  float e = length(hp);
  float t = mix(0.015, 0.035, uAmt);
  float k = smoothstep(t, t*3.0, e);
  vec3 hp2 = hp * k;

  vec3 outc = c + hp2 * (0.9 * amt);

  // 眼周提亮（加分）：只在 eyeMask
  float eyeAmt = uAmt * eyeMask;
  outc = outc + eyeAmt * vec3(0.06);

  return clamp(outc, 0.0, 1.0);
}

void main(){
  vec3 c = sampleSrc(vUv);
  vec4 m = texture(uMask, vUv);
  float faceM = m.r;
  float eyeM  = m.g;

  if (uMode == 0){
    vec3 s = bilateral(vUv, faceM);
    outColor = vec4(s, 1.0);
  } else if (uMode == 1){
    vec3 b = brighten(c, faceM);
    outColor = vec4(b, 1.0);
  } else if (uMode == 2){
    vec3 t = tone(c, faceM);
    outColor = vec4(t, 1.0);
  } else {
    vec3 d = detail(vUv, faceM, eyeM);
    outColor = vec4(d, 1.0);
  }
}
`;
