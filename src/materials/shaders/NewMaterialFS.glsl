uniform bool diffuseColorGrey;

#ifdef USE_PROJECTIVE_TEXTURING
uniform vec3 textureCameraPosition;
uniform mat4 textureCameraPreTransform; // Contains the rotation and the intrinsics of the camera, but not the translation
uniform mat4 textureCameraPostTransform;
uniform RadialDistortion uvDistortion;
varying vec4 vPositionWorld;
varying float vDistanceCamera;
uniform sampler2D map;
uniform sampler2D depthMap;
#endif

varying vec4 vColor;

void main() {
  vec4 finalColor = vColor;

  if (diffuseColorGrey) {
    finalColor.rgb = vec3(dot(vColor.rgb, vec3(0.333333)));
  }

#ifdef USE_PROJECTIVE_TEXTURING
  // Project the point in the texture image
  // p' = M' * (P - C')
  // p': uvw
  // M': textureCameraPreTransform
  // P : vPositionWorld
  // C': textureCameraPosition


  vec4 uvw = textureCameraPreTransform * ( vPositionWorld - vec4(textureCameraPosition, 0.0) );


  // For the shadowMapping, which is not distorted
  vec4 uvwNotDistorted = textureCameraPostTransform * uvw;
  uvwNotDistorted.xyz /= uvwNotDistorted.w;
  uvwNotDistorted.xyz = ( uvwNotDistorted.xyz + vec3(1.0) ) / 2.0;
  vec4 minDist4D = texture2D(depthMap, uvwNotDistorted.xy);
  float minDist = minDist4D.r;

  // ShadowMapping
  if ( (vDistanceCamera >= (minDist - EPSILON)) && (vDistanceCamera <= (minDist + EPSILON)) ) {

    // Don't texture if uvw.w < 0
    if (uvw.w > 0. && distort_radial(uvw, uvDistortion)) {

      uvw = textureCameraPostTransform * uvw;
      uvw.xyz /= uvw.w;

      // Normalization
      uvw.xyz = (uvw.xyz + vec3(1.0)) / 2.0;

      // If coordinates are valid, they will be between 0 and 1 after normalization
      // Test if coordinates are valid, so we can texture
      vec3 testBorder = min(uvw.xyz, 1. - uvw.xyz);

      if (all(greaterThan(testBorder,vec3(0.)))) {
        vec4 color = texture2D(map, uvw.xy);
        finalColor.rgb = mix(finalColor.rgb, color.rgb, color.a);
      }
    }
  }

  // if (minDist == 0.) {
  //   finalColor = vec4(1.,0.,0.,1.);
  // }
#endif

  gl_FragColor = finalColor;
}