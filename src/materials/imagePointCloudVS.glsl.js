import { default as RadialDistortion } from '../cameras/distortions/RadialDistortion';

export default /* glsl */`
${RadialDistortion.chunks.radial_shaders}
#ifdef USE_MAP4
    #undef USE_MAP
    varying highp vec3 vPosition;
    varying float vValid;
#endif

#ifdef USE_COLOR
    varying vec3 vColor;
#endif

uniform float size;

#ifdef USE_MAP4
    uniform vec3 uvwViewPosition;
    uniform mat4 uvwViewPreTrans;
    uniform mat4 uvwViewPostTrans;
    uniform RadialDistortion uvDistortion;
    uniform bool viewDisto;
    uniform bool viewExtrapol;
    uniform float viewSlope;
#endif


varying vec4 debugColor;

void main() {
    debugColor = vec4(0.);
    #ifdef USE_COLOR
        vColor.xyz = color.xyz;
    #endif

    #ifdef USE_MAP4
        vPosition = position;
        bool paintDebug = true;
        // "uvwPreTransform * m" is equal to :
        // "camera.preProjectionMatrix * camera.matrixWorldInverse * modelMatrix"
        // but more stable when both the texturing and viewing cameras have large
        // coordinate values
        mat4 m = modelMatrix;
        m[3].xyz -= uvwViewPosition;
        vec4 uvw = uvwViewPreTrans * m * vec4(vPosition, 1.);

	{
		vec2 v = uvw.xy/uvw.w - uvDistortion.C;
		float r = dot(v, v)/uvDistortion.R.w;
		debugColor = vec4(vec3(1.), fract(clamp(r*r*r*r*r,0.,1.)));
	}
        if(viewDisto) paintDebug = distort_radial(uvw, uvDistortion, viewExtrapol, viewSlope);
        gl_Position = uvwViewPostTrans * uvw;
        
        vValid = paintDebug ? 1. : 0.;
    #else 
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #endif

    if(size > 0.){
        gl_PointSize = size;
    }
    else{
        gl_PointSize = clamp(-size/gl_Position.w, 3.0, 10.0);
    }
}
`;
