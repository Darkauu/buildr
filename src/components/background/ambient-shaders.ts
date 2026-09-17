/**
 * Shaders for the ambient background field.
 *
 * The field is a domain-warped fbm — a slow tonal drift rather than a pattern —
 * with two deliberate references to the subject: horizontal contour bands that
 * read as deposited layers, and a faint extrusion smear that leans in the
 * direction of scroll.
 *
 * Written against GLSL ES 1.00: fixed loop bounds, no `break` on a uniform, no
 * dynamic indexing outside the loop counter.
 */

export const ambientVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ambientFragmentShader = /* glsl */ `
  precision highp float;

  #define MAX_BANDS 4

  varying vec2 vUv;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uScroll;
  uniform float uVelocity;
  uniform float uIntensity;

  uniform float uBandCount;
  uniform float uBandEdge[MAX_BANDS];
  uniform vec3 uBandBase[MAX_BANDS];
  uniform vec3 uBandShade[MAX_BANDS];
  uniform vec3 uBandGlow[MAX_BANDS];

  // Ashima / Gustavson simplex noise (2D).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Three octaves, not four: the fourth is invisible at this contrast and the
  // field is evaluated three times per pixel.
  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      total += snoise(p) * amplitude;
      p *= 2.02;
      amplitude *= 0.5;
    }
    return total;
  }

  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 fragment = gl_FragCoord.xy;
    // 0 at the top of the viewport, 1 at the bottom — matches the band edges,
    // which come from getBoundingClientRect().
    float screenY = 1.0 - fragment.y / uResolution.y;

    // Aspect-corrected, origin-centred field coordinates.
    vec2 p = (fragment - 0.5 * uResolution) / uResolution.y;

    float t = uTime * 0.035;
    // Scroll pulls the field vertically; velocity stretches it along the travel.
    p.y += uScroll * 1.15;
    p.y *= 1.0 + abs(uVelocity) * 0.12;

    vec2 warp = vec2(
      fbm(p * 1.25 + vec2(t, -t * 0.7)),
      fbm(p * 1.25 + vec2(5.2 - t * 0.8, 1.3 + t))
    );
    float field = fbm(p * 1.55 + warp * 0.85 + vec2(0.0, t * 0.5));
    field = field * 0.5 + 0.5;

    // Deposited layers: horizontal lines, displaced by the field the way a
    // printed wall ripples. Horizontal on purpose — iso-contours of the noise
    // read as topography, which is the wrong reference entirely.
    float layerCoord = p.y * 26.0 + field * 2.6;
    float contour = abs(fract(layerCoord) - 0.5);
    float layers = smoothstep(0.34, 0.5, contour);

    // Pick this pixel's band. No break: every band is folded in with a step mask.
    vec3 base = uBandBase[0];
    vec3 shade = uBandShade[0];
    vec3 glow = uBandGlow[0];
    for (int i = 0; i < MAX_BANDS; i++) {
      // NOTE: 'active' is a reserved word in GLSL — do not rename this back.
      float inRange = step(float(i), uBandCount - 1.0);
      float mask = step(uBandEdge[i], screenY) * inRange;
      base = mix(base, uBandBase[i], mask);
      shade = mix(shade, uBandShade[i], mask);
      glow = mix(glow, uBandGlow[i], mask);
    }

    // The shade is a neighbour of the base, so these mix amounts can be large
    // while the band still reads as one colour.
    vec3 color = base;
    color = mix(color, shade, smoothstep(0.30, 0.95, field) * 0.62 * uIntensity);
    color = mix(color, glow, smoothstep(0.74, 1.0, field) * 0.07 * uIntensity);
    color = mix(color, shade, layers * 0.3 * uIntensity);

    // Barely-there vignette keeps the centre of the page the brightest area.
    float radius = length((vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0));
    color = mix(color, shade, smoothstep(0.5, 1.15, radius) * 0.4);

    // Film grain, so the flat areas never band on wide gradients.
    color += (grain(fragment + uTime) - 0.5) * 0.009;

    // No colour-space conversion on the way out: the palette went in as sRGB
    // and was blended as sRGB, matching the CSS colours this field stands in for.
    gl_FragColor = vec4(color, 1.0);
  }
`;
