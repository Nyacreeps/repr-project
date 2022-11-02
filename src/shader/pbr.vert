precision highp float;

in vec3 in_position;
in vec3 in_normal;
in vec2 in_uv;

/**
 * Varyings.
 */

out vec3 vNormalWS;
out vec3 vPosWS;
out vec2 vUv;

/**
 * Uniforms List
 */

struct Model
{
  vec3 cameraPosition;
  mat4 modelMatrix;
  mat4 localToProjection;
};

uniform Model uModel;

void
main()
{
  vNormalWS = in_normal;
  vUv = in_uv;
  vec4 positionLocal = vec4(in_position, 1.0);
  vPosWS = (uModel.modelMatrix * positionLocal).xyz;
  gl_Position = uModel.localToProjection * uModel.modelMatrix * positionLocal;
}
