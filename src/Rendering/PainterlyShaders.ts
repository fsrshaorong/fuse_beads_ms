/**
 * Static port of ToyRoomScene-CuoAGneb.js (reference shader assemble-painterly-v6).
 * The brush is sampled at t = 0 and geometry deformation is absent. Fragment
 * operations otherwise retain the source order, constants and normal convention.
 */
export const PAINTERLY_VERTEX_DECLARATIONS = /* glsl */ `
varying vec2 vPainterUv;
varying vec3 vPainterWorldPosition;
`;

/** Accounts for Three batching/instances while ordinary meshes match source Wd. */
export const PAINTERLY_VERTEX_POSITION = /* glsl */ `
#include <project_vertex>
vPainterUv = uv;
vec4 painterPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
    painterPosition = batchingMatrix * painterPosition;
#endif
#ifdef USE_INSTANCING
    painterPosition = instanceMatrix * painterPosition;
#endif
vPainterWorldPosition = (modelMatrix * painterPosition).xyz;
`;

/** Source Kd; only its now-unused time uniform has been removed. */
export const PAINTERLY_FRAGMENT_DECLARATIONS = /* glsl */ `
uniform sampler2D uPainterBrushTexture;
uniform sampler2D uPainterLightTexture;
uniform sampler2D uPainterShadowTexture;
uniform float uPainterBrushEnabled;
uniform float uPainterRealtimeShadowsEnabled;
uniform float uPainterDualTextureEnabled;
uniform float uPainterDesaturationEnabled;
uniform float uPainterMinimumBlackEnabled;
uniform float uPainterFadeToToneEnabled;
uniform float uPainterBrushScale;
uniform float uPainterBrushStrength;
uniform float uPainterSurfaceTextureWeight;
uniform float uPainterToneWeight;
uniform float uPainterShadowStrength;
uniform float uPainterShadowThreshold;
uniform float uPainterShadowSoftness;
uniform float uPainterDesaturation;
uniform float uPainterMinimumBlack;
uniform float uPainterToneStrength;
uniform float uPainterFocusHeight;
uniform vec3 uPainterToneColor;
uniform vec3 uPainterLightTint;
uniform vec3 uPainterShadowTint;
uniform float uPainterLightTextureColorize;
uniform float uPainterShadowTextureColorize;
varying vec2 vPainterUv;
varying vec3 vPainterWorldPosition;

float PainterLuminance(vec3 color)
{
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 PainterWorldTexture(
    sampler2D painterTexture,
    vec3 worldPosition,
    vec3 worldNormal
)
{
    vec3 blendWeight = abs(worldNormal);
    blendWeight = max(blendWeight, vec3(0.0001));
    blendWeight /= blendWeight.x + blendWeight.y + blendWeight.z;
    float textureScale = 0.18;
    vec3 sampleX = texture2D(
        painterTexture,
        worldPosition.yz * textureScale + vec2(0.19, 0.07)
    ).rgb;
    vec3 sampleY = texture2D(
        painterTexture,
        worldPosition.xz * textureScale + vec2(0.43, 0.31)
    ).rgb;
    vec3 sampleZ = texture2D(
        painterTexture,
        worldPosition.xy * textureScale + vec2(0.71, 0.13)
    ).rgb;

    return sampleX * blendWeight.x
        + sampleY * blendWeight.y
        + sampleZ * blendWeight.z;
}
`;

/** Source qd at t = 0: authored UV brush, with no temporal coordinate offset. */
export const PAINTERLY_BRUSH_FRAGMENT = /* glsl */ `
#include <map_fragment>
vec2 painterBrushUv = vPainterUv * uPainterBrushScale;
vec3 painterBrushSample = texture2D(
    uPainterBrushTexture,
    painterBrushUv
).rgb;
float painterBrushLuminance = PainterLuminance(painterBrushSample);
vec3 painterBrushedDiffuse = diffuseColor.rgb
    * mix(0.72, 1.24, painterBrushLuminance);
diffuseColor.rgb = mix(
    diffuseColor.rgb,
    painterBrushedDiffuse,
    uPainterBrushEnabled * uPainterBrushStrength
);
`;

/**
 * Source Jd without an artistic modification. In particular, dual-texture output
 * replaces physical lighting fully, and triplanar weights use the source's view
 * normal. Three alone performs the later tone mapping and output conversion.
 */
export const PAINTERLY_LIGHT_FRAGMENT = /* glsl */ `
float painterShadowAttenuation = getShadowMask();
float painterShadowEdge = max(uPainterShadowSoftness, 0.0001);
float painterLitMask = smoothstep(
    uPainterShadowThreshold - painterShadowEdge,
    uPainterShadowThreshold + painterShadowEdge,
    painterShadowAttenuation
);
painterLitMask = mix(
    1.0,
    painterLitMask,
    uPainterRealtimeShadowsEnabled
);

vec3 painterLightTexture = PainterWorldTexture(
    uPainterLightTexture,
    vPainterWorldPosition,
    normal
);
vec3 painterShadowTexture = PainterWorldTexture(
    uPainterShadowTexture,
    vPainterWorldPosition,
    normal
);
float painterLightTextureLuminance = PainterLuminance(painterLightTexture);
float painterShadowTextureLuminance = PainterLuminance(painterShadowTexture);
vec3 painterLightTextureColored = mix(
    painterLightTexture,
    vec3(painterLightTextureLuminance) * uPainterLightTint,
    uPainterLightTextureColorize
);
vec3 painterShadowTextureColored = mix(
    painterShadowTexture,
    vec3(painterShadowTextureLuminance) * uPainterShadowTint,
    uPainterShadowTextureColorize
);
vec3 painterLightColor = mix(
    diffuseColor.rgb * (0.92 + PainterLuminance(painterLightTexture) * 0.2),
    painterLightTextureColored * 1.34,
    uPainterSurfaceTextureWeight
);
vec3 painterShadowColor = mix(
    diffuseColor.rgb * uPainterShadowTint * 1.08,
    painterShadowTextureColored * 1.42,
    uPainterSurfaceTextureWeight
);
vec3 painterTextureColor = mix(
    painterShadowColor,
    painterLightColor,
    painterLitMask
);
float painterShadowMix = (1.0 - painterLitMask) * uPainterShadowStrength;
painterTextureColor = mix(
    painterLightColor,
    painterTextureColor,
    painterShadowMix
);
outgoingLight = mix(
    outgoingLight,
    painterTextureColor,
    uPainterDualTextureEnabled
);

float painterGroundMask = 1.0 - smoothstep(
    uPainterFocusHeight - 0.28,
    uPainterFocusHeight + 0.28,
    vPainterWorldPosition.y
);
painterGroundMask *= uPainterToneWeight;
float painterOutputLuminance = PainterLuminance(outgoingLight);
vec3 painterGray = vec3(painterOutputLuminance);
outgoingLight = mix(
    outgoingLight,
    painterGray,
    painterGroundMask
        * uPainterDesaturationEnabled
        * uPainterDesaturation
);
vec3 painterBlackRemapped = vec3(uPainterMinimumBlack)
    + outgoingLight * (1.0 - uPainterMinimumBlack);
outgoingLight = mix(
    outgoingLight,
    painterBlackRemapped,
    painterGroundMask * uPainterMinimumBlackEnabled
);
outgoingLight = mix(
    outgoingLight,
    uPainterToneColor,
    painterGroundMask
        * uPainterFadeToToneEnabled
        * uPainterToneStrength
);

#include <opaque_fragment>
`;
