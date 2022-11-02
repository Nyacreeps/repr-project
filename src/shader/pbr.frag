#define M_PI 3.141592

precision highp float;

in vec3 vPosWS;
in vec3 vNormalWS;
in vec2 vUv;

out vec4 outFragColor;

struct Material {
  vec3 albedo;
  float roughness;
  float metalness;
};

uniform Material uMaterial;

struct pointLights {
  vec3 color[POINT_LIGHT_COUNT];
  vec3 position[POINT_LIGHT_COUNT];
  vec3 intensity[POINT_LIGHT_COUNT];
};

uniform pointLights uPointLights;

struct Model {
  vec3 cameraPosition;
  mat4 modelMatrix;
  mat4 localToProjection;
};

uniform Model uModel;

struct Parameters {
  bool renderPointLights;
  bool renderIBL;
  bool renderPointLightsDiffuseOnly;
  bool renderPointLightsSpecularOnly;
  bool renderIBLDiffuseOnly;
  bool renderIBLSpecularOnly;
  bool renderTexture;
};

uniform Parameters uParameters;

uniform sampler2D diffuseMap;
uniform sampler2D specularMap;
uniform sampler2D brdfPreInt;
uniform sampler2D baseColorMap;
uniform sampler2D metallicMap;
uniform sampler2D normalMap;
uniform sampler2D roughnessMap;

// From three.js
vec4 sRGBToLinear(in vec4 value) {
  return vec4(mix(pow(value.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)),
                  value.rgb * 0.0773993808,
                  vec3(lessThanEqual(value.rgb, vec3(0.04045)))),
              value.a);
}

// From three.js
vec4 LinearTosRGB(in vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055),
                  value.rgb * 12.92,
                  vec3(lessThanEqual(value.rgb, vec3(0.0031308)))),
              value.a);
}

vec3 lambertianDiffuse() { return uMaterial.albedo / M_PI; }

float TrowbridgeReitz(vec3 n, vec3 h, float alpha) {
  alpha = alpha * alpha / 2.0;
  float alpha2 = pow(alpha, 2.0);
  return alpha2 /
         (M_PI *
          pow(pow(max(dot(n, h), 0.0), 2.0) * (alpha2 - 1.0) + 1.0, 2.0));
}

float SmithMasking(vec3 n, vec3 v, float k) {
  // taken from
  // https://google.github.io/filament/Filament.html#materialsystem/specularbrdf
  // seems to give better results
  k = k * k / 2.0;
  float ndotv = max(dot(n, v), 0.01);
  return (2.0 * ndotv) /
         (ndotv + sqrt(pow(k, 2.0) + (1.0 - pow(k, 2.0)) * pow(ndotv, 2.0)));
  // return max(dot(n, v), 0.01) / (max(dot(n, v), 0.01) * (1.0 - k) + k);
}

vec3 FresnelSchlick(vec3 n, vec3 v, vec3 f0) {
  return f0 + (1.0 - f0) * pow(1.0 - dot(n, v), 5.0);
}

vec3 CookTorranceSpecular(vec3 wo, vec3 wi, vec3 n, float roughness) {
  vec3 h = normalize(wi + wo);
  vec3 D = vec3(TrowbridgeReitz(n, h, max(roughness, 0.05)));
  vec3 G = vec3(SmithMasking(n, wo, max(roughness, 0.05)) *
                SmithMasking(n, wi, max(roughness, 0.05)));
  return D * G / max((4.0 * max(dot(wo, n), 0.0) * max(dot(wi, n), 0.0)), 0.01);
}

vec3 samplePointLight(int lightIndex, vec3 pos, vec3 wi) {
  vec3 lightColor = sRGBToLinear(vec4(uPointLights.color[lightIndex], 1.0)).rgb;
  vec3 lightPos = uPointLights.position[lightIndex];
  float lightIntensity = uPointLights.intensity[lightIndex][0];
  return lightColor * lightIntensity;
}

const float RECIPROCAL_PI = 0.31830988618;
const float RECIPROCAL_PI2 = 0.15915494;

vec2 cartesianToPolar(vec3 n) {
  vec2 uv;
  uv.x = atan(n.z, n.x) * RECIPROCAL_PI2 + 0.5;
  uv.y = asin(n.y) * RECIPROCAL_PI + 0.5;
  return uv;
}

vec3 fetchDiffuse(vec3 normal) {
  vec2 coords = cartesianToPolar(normal);
  vec4 colTexRGBm = texture(diffuseMap, vec2(coords.x, coords.y));
  return 6.0 * colTexRGBm.rgb * colTexRGBm.a;
}

vec3 fetchPrefilteredSpec(float roughness, vec3 r) {
  vec2 uv = cartesianToPolar(r);
  float l1 = floor(roughness * 5.0);
  float u1 = uv.x / pow(2.0, l1);
  float v1 = (uv.y / pow(2.0, l1 + 1.0)) + 1.0 - (1.0 / pow(2.0, l1));
  vec4 colTexRGBm1 = texture(specularMap, vec2(u1, v1));
  vec3 colTexRGB1 = 6.0 * colTexRGBm1.rgb * colTexRGBm1.a;
  float l2 = ceil(roughness * 5.0);
  float u2 = uv.x / pow(2.0, l2);
  float v2 = (uv.y / pow(2.0, l2 + 1.0)) + 1.0 - (1.0 / pow(2.0, l2));
  vec4 colTexRGBm2 = texture(specularMap, vec2(u2, v2));
  vec3 colTexRGB2 = 6.0 * colTexRGBm2.rgb * colTexRGBm2.a;
  return mix(colTexRGB1, colTexRGB2, roughness * 5.0 - l1);
}

void main() {
  vec3 wo = normalize(uModel.cameraPosition - vPosWS);
  vec3 normal = normalize(vNormalWS);
  vec3 f0 = mix(vec3(0.04), sRGBToLinear(vec4(uMaterial.albedo, 1.0)).rgb,
                uMaterial.metalness);

  if (uParameters.renderPointLights) {
    vec3 irradiance = vec3(0.0);
    for (int i = 0; i < POINT_LIGHT_COUNT; ++i) {
      vec3 wi = normalize(uPointLights.position[i] - vPosWS);
      vec3 h = normalize(wi + wo);
      vec3 kS = FresnelSchlick(wi, wo, f0);
      vec3 diffuseBRDFEval = (1.0 - uMaterial.metalness) * lambertianDiffuse();
      vec3 specularBRDFEval = CookTorranceSpecular(wo, wi, normal, uMaterial.roughness);
      if (uParameters.renderPointLightsDiffuseOnly) {
        irradiance += (diffuseBRDFEval)*samplePointLight(i, vPosWS, wi) *
                      max(dot(normal, wi), 0.01);
      } else if (uParameters.renderPointLightsSpecularOnly) {
        irradiance += (kS * specularBRDFEval) *
                      samplePointLight(i, vPosWS, wi) *
                      max(dot(normal, wi), 0.01);
      } else {
        irradiance += (kS * specularBRDFEval + (1.0 - kS) * diffuseBRDFEval) *
                      samplePointLight(i, vPosWS, wi) *
                      max(dot(normal, wi), 0.01);
      }
    }
    irradiance /= (irradiance + 1.0);
    outFragColor.rgba = LinearTosRGB(vec4(irradiance, 1.0));
  }

  if (uParameters.renderIBL) {
    vec3 reflected = reflect(-wo, normal);
    vec3 kS = FresnelSchlick(wo, normal, f0);
    vec3 diffuseBRDFEval = (1.0 - kS) * (1.0 - uMaterial.metalness) *
                           sRGBToLinear(vec4(uMaterial.albedo, 1.0)).rgb *
                           fetchDiffuse(normal);
    vec3 preFilteredSpec = fetchPrefilteredSpec(uMaterial.roughness, reflected);
    vec2 brdf =
        texture(brdfPreInt, vec2(dot(normal, -wo), uMaterial.roughness)).xy;
    vec3 specularBRDFEval = kS * preFilteredSpec * (kS * brdf.x + brdf.y);
    vec3 irradiance = vec3(0.0);
    if (uParameters.renderIBLDiffuseOnly) {
      irradiance = diffuseBRDFEval;
    } else if (uParameters.renderIBLSpecularOnly) {
      irradiance = specularBRDFEval;
    } else {
      irradiance = (diffuseBRDFEval + specularBRDFEval);
    }
    outFragColor = LinearTosRGB(vec4(irradiance, 1.0));
  }

  if (uParameters.renderTexture) {
    vec2 uvs = vUv;
    vec4 fetchedColor = texture(baseColorMap, uvs);
    vec4 fetchedMetalness = texture(metallicMap, uvs);
    vec4 fetchedNormal = texture(normalMap, uvs);
    vec4 fetchedRougness = texture(roughnessMap, uvs);

    f0 = mix(vec3(0.04), sRGBToLinear(fetchedColor).rgb,
             fetchedMetalness.r);

    vec3 irradiance = vec3(0.0);
    for (int i = 0; i < POINT_LIGHT_COUNT; ++i) {
      vec3 wi = normalize(uPointLights.position[i] - vPosWS);
      vec3 h = normalize(wi + wo);
      vec3 kS = FresnelSchlick(wi, wo, f0);
      vec3 diffuseBRDFEval = (1.0 - fetchedMetalness.r) * sRGBToLinear(fetchedColor).rgb;
      vec3 specularBRDFEval = CookTorranceSpecular(wo, wi, fetchedNormal.xyz, sqrt(fetchedRougness.r));
      irradiance += (kS * specularBRDFEval + (1.0 - kS) * diffuseBRDFEval) *
                    samplePointLight(i, vPosWS, wi) / 4.0 /* it's a bit bright in there*/*
                    max(dot(fetchedNormal.xyz, wi), 0.01);
    }
    irradiance /= (irradiance + 1.0);
    outFragColor.rgba = LinearTosRGB(vec4(irradiance, 1.0));
  }
}