import { GUI } from 'dat.gui';
import { mat4, vec3 } from 'gl-matrix';
import { Camera } from './camera';
import { Geometry } from './geometries/geometry';
import { SphereGeometry } from './geometries/sphere';
import { GLContext } from './gl';
import { PointLight } from './lights/lights';
import { PBRShader } from './shader/pbr-shader';
import { Texture, Texture2D } from './textures/texture';
import { Transform } from './transform';
import { UniformType } from './types';

interface GUIProperties {
    albedo: number[];
    pointLights: boolean;
    IBL: boolean;
    pointLightsDiffuseOnly: boolean;
    pointLightsSpecularOnly: boolean;
    IBLDiffuseOnly: boolean;
    IBLSpecularOnly: boolean;
    texture: false;
}

/**
 * Class representing the current application with its state.
 *
 * @class Application
 */
class Application {
    /**
     * Context used to draw to the canvas
     *
     * @private
     */
    private _context: GLContext;

    private _shader: PBRShader;
    private _geometry: Geometry;
    private _uniforms: Record<string, UniformType | Texture>;
    private _pointLights: Array<PointLight>;

    private _textureSpecular: Texture2D<HTMLElement> | null;
    private _textureDiffuse: Texture2D<HTMLElement> | null;
    private _textureBRDF: Texture2D<HTMLElement> | null;
    private _textureBaseColor: Texture2D<HTMLElement> | null;
    private _textureMetallic: Texture2D<HTMLElement> | null;
    private _textureNormal: Texture2D<HTMLElement> | null;
    private _textureRoughness: Texture2D<HTMLElement> | null;

    private _camera: Camera;

    /**
     * Object updated with the properties from the GUI
     *
     * @private
     */
    private _guiProperties: GUIProperties;

    constructor(canvas: HTMLCanvasElement) {
        this._context = new GLContext(canvas);
        this._camera = new Camera();

        this._pointLights = new Array<PointLight>();
        this._pointLights.push(new PointLight().setColorRGB(255, 255, 255).setIntensity(1.0).setPosition(-6.0, -6.0, 8.0));
        this._pointLights.push(new PointLight().setColorRGB(255, 255, 255).setIntensity(1.0).setPosition(-6.0, 6.0, 8.0));
        this._pointLights.push(new PointLight().setColorRGB(255, 255, 255).setIntensity(1.0).setPosition(6.0, -6.0, 8.0));
        this._pointLights.push(new PointLight().setColorRGB(255, 255, 255).setIntensity(1.0).setPosition(6.0, 6.0, 8.0));

        this._geometry = new SphereGeometry(0.12, 24, 24);
        this._uniforms = {
            'uMaterial.albedo': vec3.create(),
            'uMaterial.roughness': new Float32Array(1),
            'uMaterial.metalness': new Float32Array(1),
            'uModel.localToProjection': mat4.create(),
            'uModel.modelMatrix': mat4.create(),
            'uModel.cameraPosition': vec3.create(),
            'uPointLights.position[0]': new Float32Array(this._pointLights.length * 3),
            'uPointLights.color[0]': new Float32Array(this._pointLights.length * 3),
            'uPointLights.intensity[0]': new Float32Array(this._pointLights.length * 3),
        };

        this._shader = new PBRShader();
        this._shader.pointLightCount = this._pointLights.length;
        this._textureSpecular = null;
        this._textureDiffuse = null;
        this._textureBRDF = null;
        this._textureBaseColor = null;
        this._textureMetallic = null;
        this._textureNormal = null;
        this._textureRoughness = null;

        this._guiProperties = {
            albedo: [200, 200, 200],
            pointLights: true,
            IBL: false,
            pointLightsDiffuseOnly: false,
            pointLightsSpecularOnly: false,
            IBLDiffuseOnly: false,
            IBLSpecularOnly: false,
            texture: false,
        };

        this._createGUI();
    }

    /**
     * Initializes the application.
     */
    async init() {
        for (let i = 0; i < this._pointLights.length; i++) {
            let slot = this._uniforms['uPointLights.position[0]'] as Float32Array;
            slot[i * 3] = this._pointLights[i].positionWS[0];
            slot[i * 3 + 1] = this._pointLights[i].positionWS[1];
            slot[i * 3 + 2] = this._pointLights[i].positionWS[2];

            let slot1 = this._uniforms['uPointLights.color[0]'] as Float32Array;
            slot1[i * 3] = this._pointLights[i].color[0] / 255;
            slot1[i * 3 + 1] = this._pointLights[i].color[1] / 255;
            slot1[i * 3 + 2] = this._pointLights[i].color[2] / 255;

            let slot2 = this._uniforms['uPointLights.intensity[0]'] as Float32Array;
            slot2[i * 3] = this._pointLights[i].intensity;
        }

        this._context.uploadGeometry(this._geometry);
        this._context.compileProgram(this._shader);

        // Example showing how to load a texture and upload it to GPU.
        this._textureDiffuse = await Texture2D.load(
            'assets/env/Alexs_Apt_2k-diffuse-RGBM.png'
        );
        if (this._textureDiffuse !== null) {
            this._context.uploadTexture(this._textureDiffuse);
            this._uniforms['diffuseMap'] = this._textureDiffuse;
        }

        this._textureSpecular = await Texture2D.load(
            'assets/env/Alexs_Apt_2k-specular-RGBM.png'
        );
        if (this._textureSpecular !== null) {
            this._context.uploadTexture(this._textureSpecular);
            this._uniforms['specularMap'] = this._textureSpecular;
        }
        this._textureSpecular = await Texture2D.load(
            'assets/ggx-brdf-integrated.png'
        );
        if (this._textureBRDF !== null) {
            this._context.uploadTexture(this._textureBRDF);
            this._uniforms['brdfPreInt'] = this._textureBRDF;
        }
        this._textureBaseColor = await Texture2D.load(
            'assets/env/rustediron2/rustediron2_basecolor.png'
        );
        if (this._textureBaseColor !== null) {
            this._context.uploadTexture(this._textureBaseColor);
            this._uniforms['baseColorMap'] = this._textureBaseColor;
        }
        this._textureMetallic = await Texture2D.load(
            'assets/env/rustediron2/rustediron2_metallic.png'
        );
        if (this._textureMetallic !== null) {
            this._context.uploadTexture(this._textureMetallic);
            this._uniforms['metallicMap'] = this._textureMetallic;
        }
        this._textureNormal = await Texture2D.load(
            'assets/env/rustediron2/rustediron2_normal.png'
        );
        if (this._textureNormal !== null) {
            this._context.uploadTexture(this._textureNormal);
            this._uniforms['normalMap'] = this._textureNormal;
        }
        this._textureRoughness= await Texture2D.load(
            'assets/env/rustediron2/rustediron2_roughness.png'
        );
        if (this._textureRoughness !== null) {
            this._context.uploadTexture(this._textureRoughness);
            this._uniforms['roughnessMap'] = this._textureRoughness;
        }
    }

    /**
     * Called at every loop, before the [[Application.render]] method.
     */
    update() {
        /** Empty. */
    }

    /**
     * Called when the canvas size changes.
     */
    resize() {
        this._context.resize();
    }

    /**
     * Called at every loop, after the [[Application.update]] method.
     */
    render() {
        this._context.clear();
        this._context.setDepthTest(true);
        // this._context.setCulling(WebGL2RenderingContext.BACK);

        const aspect =
            this._context.gl.drawingBufferWidth /
            this._context.gl.drawingBufferHeight;

        const camera = this._camera;
        vec3.set(camera.transform.position, 0.0, 0.0, 2.0);

        camera.setParameters(aspect);
        camera.update();

        const props = this._guiProperties;

        // Set the color from the GUI into the uniform list.
        vec3.set(
            this._uniforms['uMaterial.albedo'] as vec3,
            props.albedo[0] / 255,
            props.albedo[1] / 255,
            props.albedo[2] / 255
        );
        this._uniforms['uParameters.renderPointLights'] = props.pointLights;
        this._uniforms['uParameters.renderIBL'] = props.IBL;
        this._uniforms['uParameters.renderPointLightsDiffuseOnly'] = props.pointLightsDiffuseOnly;
        this._uniforms['uParameters.renderPointLightsSpecularOnly'] = props.pointLightsSpecularOnly;
        this._uniforms['uParameters.renderIBLDiffuseOnly'] = props.IBLDiffuseOnly;
        this._uniforms['uParameters.renderIBLSpecularOnly'] = props.IBLSpecularOnly;
        this._uniforms['uParameters.renderTexture'] = props.texture;
        // Sets the viewProjection matrix.
        // **Note**: if you want to modify the position of the geometry, you will
        // need to take the matrix of the mesh into account here.
        mat4.copy(
            this._uniforms['uModel.localToProjection'] as mat4,
            camera.localToProjection
        );

        vec3.set(this._uniforms['uModel.cameraPosition'] as vec3,
            this._camera.transform.position[0],
            this._camera.transform.position[1],
            this._camera.transform.position[2]
        );

        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                let transform: Transform = new Transform();
                vec3.set(transform.position, (i - 2) / 3, (j - 2) / 3, -0.0);
                mat4.copy(this._uniforms['uModel.modelMatrix'] as mat4, transform.combine());
                let roughness = this._uniforms['uMaterial.roughness'] as Float32Array;
                roughness[0] = 0.05 + i * 0.232;
                let metalness = this._uniforms['uMaterial.metalness'] as Float32Array;
                metalness[0] = 0.0 + j * 0.24;
                this._context.draw(this._geometry, this._shader, this._uniforms);
            }
        }
    }

    /**
     * Creates a GUI floating on the upper right side of the page.
     *
     * ## Note
     *
     * You are free to do whatever you want with this GUI. It's useful to have
     * parameters you can dynamically change to see what happens.
     *
     *
     * @private
     */
    private _createGUI(): GUI {
        const gui = new GUI();
        gui.addColor(this._guiProperties, 'albedo');
        gui.add(this._guiProperties, 'pointLights', true);
        gui.add(this._guiProperties, 'IBL', false);
        gui.add(this._guiProperties, 'pointLightsDiffuseOnly', false);
        gui.add(this._guiProperties, 'pointLightsSpecularOnly', false);
        gui.add(this._guiProperties, 'IBLDiffuseOnly', false);
        gui.add(this._guiProperties, 'IBLSpecularOnly', false);
        gui.add(this._guiProperties, 'texture', false);
        return gui;
    }
}

const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
const app = new Application(canvas as HTMLCanvasElement);
app.init();

function animate() {
    app.update();
    app.render();
    window.requestAnimationFrame(animate);
}
animate();

/**
 * Handles resize.
 */

const resizeObserver = new ResizeObserver((entries) => {
    if (entries.length > 0) {
        const entry = entries[0];
        canvas.width = window.devicePixelRatio * entry.contentRect.width;
        canvas.height = window.devicePixelRatio * entry.contentRect.height;
        app.resize();
    }
});

resizeObserver.observe(canvas);
