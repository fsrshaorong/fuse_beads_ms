/** Static inverted-hull vertex shader with CSS-pixel extrusion after projection. */
export const PAINTERLY_OUTLINE_VERTEX = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform vec2 uOutlineViewport;
uniform float uOutlineWidth;

void main()
{
    #ifdef USE_INSTANCING
        // Empty pegboard slots are represented by zero-scale instances. Their
        // normal inverse is singular, and they must never produce a stray hull.
        vec3 instanceLengths = vec3(
            dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz),
            dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz),
            dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz)
        );
        if (min(instanceLengths.x, min(instanceLengths.y, instanceLengths.z)) < 0.000000000001)
        {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
    #endif

    #include <morphinstance_vertex>
    #include <batching_vertex>
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>

    // BackSide flips transformedNormal; reverse it to expand the outer shell.
    vec3 outwardNormal = -transformedNormal;
    outwardNormal /= max(length(outwardNormal), 0.00000001);
    vec4 clipNormal = projectionMatrix * vec4(outwardNormal, 0.0);
    vec2 screenNormal = (clipNormal.xy * gl_Position.w
        - gl_Position.xy * clipNormal.w) * uOutlineViewport;
    vec2 direction = screenNormal / max(length(screenNormal), 0.00000001);
    gl_Position.xy += direction * (2.0 * uOutlineWidth / uOutlineViewport) * gl_Position.w;

    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
}
`;

/** Emits the line color once through the renderer's existing output conversion. */
export const PAINTERLY_OUTLINE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

uniform vec3 uOutlineColor;
uniform float uOutlineOpacity;

void main()
{
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uOutlineColor, uOutlineOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
}
`;
