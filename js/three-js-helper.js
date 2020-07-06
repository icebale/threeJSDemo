var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj
} : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj
};
THREE.FBXLoader = function () {
    var fbxTree;
    var connections;
    var sceneGraph;

    function FBXLoader(manager) {
        THREE.Loader.call(this, manager)
    }

    FBXLoader.prototype = Object.assign(Object.create(THREE.Loader.prototype), {
        constructor: FBXLoader, load: function load(url, onLoad, onProgress, onError) {
            var self = this;
            var path = self.path === '' ? THREE.LoaderUtils.extractUrlBase(url) : self.path;
            var loader = new THREE.FileLoader(this.manager);
            loader.setPath(self.path);
            loader.setResponseType('arraybuffer');
            loader.load(url, function (buffer) {
                try {
                    onLoad(self.parse(buffer, path))
                } catch (error) {
                    setTimeout(function () {
                        if (onError) onError(error);
                        self.manager.itemError(url)
                    }, 0)
                }
            }, onProgress, onError)
        }, parse: function parse(FBXBuffer, path) {
            if (isFbxFormatBinary(FBXBuffer)) {
                fbxTree = new BinaryParser().parse(FBXBuffer)
            } else {
                var FBXText = convertArrayBufferToString(FBXBuffer);
                if (!isFbxFormatASCII(FBXText)) {
                    throw new Error('THREE.FBXLoader: Unknown format.')
                }
                if (getFbxVersion(FBXText) < 7000) {
                    throw new Error('THREE.FBXLoader: FBX version not supported, FileVersion: ' + getFbxVersion(FBXText))
                }
                fbxTree = new TextParser().parse(FBXText)
            }
            var textureLoader = new THREE.TextureLoader(this.manager).setPath(this.resourcePath || path).setCrossOrigin(this.crossOrigin);
            return new FBXTreeParser(textureLoader, this.manager).parse(fbxTree)
        }
    });

    function FBXTreeParser(textureLoader, manager) {
        this.textureLoader = textureLoader;
        this.manager = manager
    }

    FBXTreeParser.prototype = {
        constructor: FBXTreeParser, parse: function parse() {
            connections = this.parseConnections();
            var images = this.parseImages();
            var textures = this.parseTextures(images);
            var materials = this.parseMaterials(textures);
            var deformers = this.parseDeformers();
            var geometryMap = new GeometryParser().parse(deformers);
            this.parseScene(deformers, geometryMap, materials);
            return sceneGraph
        }, parseConnections: function parseConnections() {
            var connectionMap = new Map();
            if ('Connections' in fbxTree) {
                var rawConnections = fbxTree.Connections.connections;
                rawConnections.forEach(function (rawConnection) {
                    var fromID = rawConnection[0];
                    var toID = rawConnection[1];
                    var relationship = rawConnection[2];
                    if (!connectionMap.has(fromID)) {
                        connectionMap.set(fromID, {parents: [], children: []})
                    }
                    var parentRelationship = {ID: toID, relationship: relationship};
                    connectionMap.get(fromID).parents.push(parentRelationship);
                    if (!connectionMap.has(toID)) {
                        connectionMap.set(toID, {parents: [], children: []})
                    }
                    var childRelationship = {ID: fromID, relationship: relationship};
                    connectionMap.get(toID).children.push(childRelationship)
                })
            }
            return connectionMap
        }, parseImages: function parseImages() {
            var images = {};
            var blobs = {};
            if ('Video' in fbxTree.Objects) {
                var videoNodes = fbxTree.Objects.Video;
                for (var nodeID in videoNodes) {
                    var videoNode = videoNodes[nodeID];
                    var id = parseInt(nodeID);
                    images[id] = videoNode.RelativeFilename || videoNode.Filename;
                    if ('Content' in videoNode) {
                        var arrayBufferContent = videoNode.Content instanceof ArrayBuffer && videoNode.Content.byteLength > 0;
                        var base64Content = typeof videoNode.Content === 'string' && videoNode.Content !== '';
                        if (arrayBufferContent || base64Content) {
                            var image = this.parseImage(videoNodes[nodeID]);
                            blobs[videoNode.RelativeFilename || videoNode.Filename] = image
                        }
                    }
                }
            }
            for (var id in images) {
                var filename = images[id];
                if (blobs[filename] !== undefined) images[id] = blobs[filename]; else images[id] = images[id].split('\\').pop()
            }
            return images
        }, parseImage: function parseImage(videoNode) {
            var content = videoNode.Content;
            var fileName = videoNode.RelativeFilename || videoNode.Filename;
            var extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
            var type;
            switch (extension) {
                case'bmp':
                    type = 'image/bmp';
                    break;
                case'jpg':
                case'jpeg':
                    type = 'image/jpeg';
                    break;
                case'png':
                    type = 'image/png';
                    break;
                case'tif':
                    type = 'image/tiff';
                    break;
                case'tga':
                    if (this.manager.getHandler('.tga') === null) {
                        console.warn('FBXLoader: TGA loader not found, skipping ', fileName)
                    }
                    type = 'image/tga';
                    break;
                default:
                    console.warn('FBXLoader: Image type "' + extension + '" is not supported.');
                    return
            }
            if (typeof content === 'string') {
                return 'data:' + type + ';base64,' + content
            } else {
                var array = new Uint8Array(content);
                return window.URL.createObjectURL(new Blob([array], {type: type}))
            }
        }, parseTextures: function parseTextures(images) {
            var textureMap = new Map();
            if ('Texture' in fbxTree.Objects) {
                var textureNodes = fbxTree.Objects.Texture;
                for (var nodeID in textureNodes) {
                    var texture = this.parseTexture(textureNodes[nodeID], images);
                    textureMap.set(parseInt(nodeID), texture)
                }
            }
            return textureMap
        }, parseTexture: function parseTexture(textureNode, images) {
            var texture = this.loadTexture(textureNode, images);
            texture.ID = textureNode.id;
            texture.name = textureNode.attrName;
            var wrapModeU = textureNode.WrapModeU;
            var wrapModeV = textureNode.WrapModeV;
            var valueU = wrapModeU !== undefined ? wrapModeU.value : 0;
            var valueV = wrapModeV !== undefined ? wrapModeV.value : 0;
            texture.wrapS = valueU === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
            texture.wrapT = valueV === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
            if ('Scaling' in textureNode) {
                var values = textureNode.Scaling.value;
                texture.repeat.x = values[0];
                texture.repeat.y = values[1]
            }
            return texture
        }, loadTexture: function loadTexture(textureNode, images) {
            var fileName;
            var currentPath = this.textureLoader.path;
            var children = connections.get(textureNode.id).children;
            if (children !== undefined && children.length > 0 && images[children[0].ID] !== undefined) {
                fileName = images[children[0].ID];
                if (fileName.indexOf('blob:') === 0 || fileName.indexOf('data:') === 0) {
                    this.textureLoader.setPath(undefined)
                }
            }
            var texture;
            var extension = textureNode.FileName.slice(-3).toLowerCase();
            if (extension === 'tga') {
                var loader = this.manager.getHandler('.tga');
                if (loader === null) {
                    console.warn('FBXLoader: TGA loader not found, creating placeholder texture for', textureNode.RelativeFilename);
                    texture = new THREE.Texture()
                } else {
                    texture = loader.load(fileName)
                }
            } else if (extension === 'psd') {
                console.warn('FBXLoader: PSD textures are not supported, creating placeholder texture for', textureNode.RelativeFilename);
                texture = new THREE.Texture()
            } else {
                texture = this.textureLoader.load(fileName)
            }
            this.textureLoader.setPath(currentPath);
            return texture
        }, parseMaterials: function parseMaterials(textureMap) {
            var materialMap = new Map();
            if ('Material' in fbxTree.Objects) {
                var materialNodes = fbxTree.Objects.Material;
                for (var nodeID in materialNodes) {
                    var material = this.parseMaterial(materialNodes[nodeID], textureMap);
                    if (material !== null) materialMap.set(parseInt(nodeID), material)
                }
            }
            return materialMap
        }, parseMaterial: function parseMaterial(materialNode, textureMap) {
            var ID = materialNode.id;
            var name = materialNode.attrName;
            var type = materialNode.ShadingModel;
            if ((typeof type === 'undefined' ? 'undefined' : _typeof(type)) === 'object') {
                type = type.value
            }
            if (!connections.has(ID)) return null;
            var parameters = this.parseParameters(materialNode, textureMap, ID);
            var material;
            switch (type.toLowerCase()) {
                case'phong':
                    material = new THREE.MeshPhongMaterial();
                    break;
                case'lambert':
                    material = new THREE.MeshLambertMaterial();
                    break;
                default:
                    console.warn('THREE.FBXLoader: unknown material type "%s". Defaulting to MeshPhongMaterial.', type);
                    material = new THREE.MeshPhongMaterial();
                    break
            }
            material.setValues(parameters);
            material.name = name;
            return material
        }, parseParameters: function parseParameters(materialNode, textureMap, ID) {
            var parameters = {};
            if (materialNode.BumpFactor) {
                parameters.bumpScale = materialNode.BumpFactor.value
            }
            if (materialNode.Diffuse) {
                parameters.color = new THREE.Color().fromArray(materialNode.Diffuse.value)
            } else if (materialNode.DiffuseColor && materialNode.DiffuseColor.type === 'Color') {
                parameters.color = new THREE.Color().fromArray(materialNode.DiffuseColor.value)
            }
            if (materialNode.DisplacementFactor) {
                parameters.displacementScale = materialNode.DisplacementFactor.value
            }
            if (materialNode.Emissive) {
                parameters.emissive = new THREE.Color().fromArray(materialNode.Emissive.value)
            } else if (materialNode.EmissiveColor && materialNode.EmissiveColor.type === 'Color') {
                parameters.emissive = new THREE.Color().fromArray(materialNode.EmissiveColor.value)
            }
            if (materialNode.EmissiveFactor) {
                parameters.emissiveIntensity = parseFloat(materialNode.EmissiveFactor.value)
            }
            if (materialNode.Opacity) {
                parameters.opacity = parseFloat(materialNode.Opacity.value)
            }
            if (parameters.opacity < 1.0) {
                parameters.transparent = true
            }
            if (materialNode.ReflectionFactor) {
                parameters.reflectivity = materialNode.ReflectionFactor.value
            }
            if (materialNode.Shininess) {
                parameters.shininess = materialNode.Shininess.value
            }
            if (materialNode.Specular) {
                parameters.specular = new THREE.Color().fromArray(materialNode.Specular.value)
            } else if (materialNode.SpecularColor && materialNode.SpecularColor.type === 'Color') {
                parameters.specular = new THREE.Color().fromArray(materialNode.SpecularColor.value)
            }
            var self = this;
            connections.get(ID).children.forEach(function (child) {
                var type = child.relationship;
                switch (type) {
                    case'Bump':
                        parameters.bumpMap = self.getTexture(textureMap, child.ID);
                        break;
                    case'Maya|TEX_ao_map':
                        parameters.aoMap = self.getTexture(textureMap, child.ID);
                        break;
                    case'DiffuseColor':
                    case'Maya|TEX_color_map':
                        parameters.map = self.getTexture(textureMap, child.ID);
                        parameters.map.encoding = THREE.sRGBEncoding;
                        break;
                    case'DisplacementColor':
                        parameters.displacementMap = self.getTexture(textureMap, child.ID);
                        break;
                    case'EmissiveColor':
                        parameters.emissiveMap = self.getTexture(textureMap, child.ID);
                        parameters.emissiveMap.encoding = THREE.sRGBEncoding;
                        break;
                    case'NormalMap':
                    case'Maya|TEX_normal_map':
                        parameters.normalMap = self.getTexture(textureMap, child.ID);
                        break;
                    case'ReflectionColor':
                        parameters.envMap = self.getTexture(textureMap, child.ID);
                        parameters.envMap.mapping = THREE.EquirectangularReflectionMapping;
                        parameters.envMap.encoding = THREE.sRGBEncoding;
                        break;
                    case'SpecularColor':
                        parameters.specularMap = self.getTexture(textureMap, child.ID);
                        parameters.specularMap.encoding = THREE.sRGBEncoding;
                        break;
                    case'TransparentColor':
                        parameters.alphaMap = self.getTexture(textureMap, child.ID);
                        parameters.transparent = true;
                        break;
                    case'AmbientColor':
                    case'ShininessExponent':
                    case'SpecularFactor':
                    case'VectorDisplacementColor':
                    default:
                        console.warn('THREE.FBXLoader: %s map is not supported in three.js, skipping texture.', type);
                        break
                }
            });
            return parameters
        }, getTexture: function getTexture(textureMap, id) {
            if ('LayeredTexture' in fbxTree.Objects && id in fbxTree.Objects.LayeredTexture) {
                console.warn('THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer.');
                id = connections.get(id).children[0].ID
            }
            return textureMap.get(id)
        }, parseDeformers: function parseDeformers() {
            var skeletons = {};
            var morphTargets = {};
            if ('Deformer' in fbxTree.Objects) {
                var DeformerNodes = fbxTree.Objects.Deformer;
                for (var nodeID in DeformerNodes) {
                    var deformerNode = DeformerNodes[nodeID];
                    var relationships = connections.get(parseInt(nodeID));
                    if (deformerNode.attrType === 'Skin') {
                        var skeleton = this.parseSkeleton(relationships, DeformerNodes);
                        skeleton.ID = nodeID;
                        if (relationships.parents.length > 1) console.warn('THREE.FBXLoader: skeleton attached to more than one geometry is not supported.');
                        skeleton.geometryID = relationships.parents[0].ID;
                        skeletons[nodeID] = skeleton
                    } else if (deformerNode.attrType === 'BlendShape') {
                        var morphTarget = {id: nodeID};
                        morphTarget.rawTargets = this.parseMorphTargets(relationships, DeformerNodes);
                        morphTarget.id = nodeID;
                        if (relationships.parents.length > 1) console.warn('THREE.FBXLoader: morph target attached to more than one geometry is not supported.');
                        morphTargets[nodeID] = morphTarget
                    }
                }
            }
            return {skeletons: skeletons, morphTargets: morphTargets}
        }, parseSkeleton: function parseSkeleton(relationships, deformerNodes) {
            var rawBones = [];
            relationships.children.forEach(function (child) {
                var boneNode = deformerNodes[child.ID];
                if (boneNode.attrType !== 'Cluster') return;
                var rawBone = {
                    ID: child.ID,
                    indices: [],
                    weights: [],
                    transformLink: new THREE.Matrix4().fromArray(boneNode.TransformLink.a)
                };
                if ('Indexes' in boneNode) {
                    rawBone.indices = boneNode.Indexes.a;
                    rawBone.weights = boneNode.Weights.a
                }
                rawBones.push(rawBone)
            });
            return {rawBones: rawBones, bones: []}
        }, parseMorphTargets: function parseMorphTargets(relationships, deformerNodes) {
            var rawMorphTargets = [];
            for (var i = 0; i < relationships.children.length; i++) {
                var child = relationships.children[i];
                var morphTargetNode = deformerNodes[child.ID];
                var rawMorphTarget = {
                    name: morphTargetNode.attrName,
                    initialWeight: morphTargetNode.DeformPercent,
                    id: morphTargetNode.id,
                    fullWeights: morphTargetNode.FullWeights.a
                };
                if (morphTargetNode.attrType !== 'BlendShapeChannel') return;
                rawMorphTarget.geoID = connections.get(parseInt(child.ID)).children.filter(function (child) {
                    return child.relationship === undefined
                })[0].ID;
                rawMorphTargets.push(rawMorphTarget)
            }
            return rawMorphTargets
        }, parseScene: function parseScene(deformers, geometryMap, materialMap) {
            sceneGraph = new THREE.Group();
            var modelMap = this.parseModels(deformers.skeletons, geometryMap, materialMap);
            var modelNodes = fbxTree.Objects.Model;
            var self = this;
            modelMap.forEach(function (model) {
                var modelNode = modelNodes[model.ID];
                self.setLookAtProperties(model, modelNode);
                var parentConnections = connections.get(model.ID).parents;
                parentConnections.forEach(function (connection) {
                    var parent = modelMap.get(connection.ID);
                    if (parent !== undefined) parent.add(model)
                });
                if (model.parent === null) {
                    sceneGraph.add(model)
                }
            });
            this.bindSkeleton(deformers.skeletons, geometryMap, modelMap);
            this.createAmbientLight();
            this.setupMorphMaterials();
            sceneGraph.traverse(function (node) {
                if (node.userData.transformData) {
                    if (node.parent) node.userData.transformData.parentMatrixWorld = node.parent.matrix;
                    var transform = generateTransform(node.userData.transformData);
                    node.applyMatrix4(transform)
                }
            });
            var animations = new AnimationParser().parse();
            if (sceneGraph.children.length === 1 && sceneGraph.children[0].isGroup) {
                sceneGraph.children[0].animations = animations;
                sceneGraph = sceneGraph.children[0]
            }
            sceneGraph.animations = animations
        }, parseModels: function parseModels(skeletons, geometryMap, materialMap) {
            var modelMap = new Map();
            var modelNodes = fbxTree.Objects.Model;
            for (var nodeID in modelNodes) {
                var id = parseInt(nodeID);
                var node = modelNodes[nodeID];
                var relationships = connections.get(id);
                var model = this.buildSkeleton(relationships, skeletons, id, node.attrName);
                if (!model) {
                    switch (node.attrType) {
                        case'Camera':
                            model = this.createCamera(relationships);
                            break;
                        case'Light':
                            model = this.createLight(relationships);
                            break;
                        case'Mesh':
                            model = this.createMesh(relationships, geometryMap, materialMap);
                            break;
                        case'NurbsCurve':
                            model = this.createCurve(relationships, geometryMap);
                            break;
                        case'LimbNode':
                        case'Root':
                            model = new THREE.Bone();
                            break;
                        case'Null':
                        default:
                            model = new THREE.Group();
                            break
                    }
                    model.name = node.attrName ? THREE.PropertyBinding.sanitizeNodeName(node.attrName) : '';
                    model.ID = id
                }
                this.getTransformData(model, node);
                modelMap.set(id, model)
            }
            return modelMap
        }, buildSkeleton: function buildSkeleton(relationships, skeletons, id, name) {
            var bone = null;
            relationships.parents.forEach(function (parent) {
                for (var ID in skeletons) {
                    var skeleton = skeletons[ID];
                    skeleton.rawBones.forEach(function (rawBone, i) {
                        if (rawBone.ID === parent.ID) {
                            var subBone = bone;
                            bone = new THREE.Bone();
                            bone.matrixWorld.copy(rawBone.transformLink);
                            bone.name = name ? THREE.PropertyBinding.sanitizeNodeName(name) : '';
                            bone.ID = id;
                            skeleton.bones[i] = bone;
                            if (subBone !== null) {
                                bone.add(subBone)
                            }
                        }
                    })
                }
            });
            return bone
        }, createCamera: function createCamera(relationships) {
            var model;
            var cameraAttribute;
            relationships.children.forEach(function (child) {
                var attr = fbxTree.Objects.NodeAttribute[child.ID];
                if (attr !== undefined) {
                    cameraAttribute = attr
                }
            });
            if (cameraAttribute === undefined) {
                model = new THREE.Object3D()
            } else {
                var type = 0;
                if (cameraAttribute.CameraProjectionType !== undefined && cameraAttribute.CameraProjectionType.value === 1) {
                    type = 1
                }
                var nearClippingPlane = 1;
                if (cameraAttribute.NearPlane !== undefined) {
                    nearClippingPlane = cameraAttribute.NearPlane.value / 1000
                }
                var farClippingPlane = 1000;
                if (cameraAttribute.FarPlane !== undefined) {
                    farClippingPlane = cameraAttribute.FarPlane.value / 1000
                }
                var width = window.innerWidth;
                var height = window.innerHeight;
                if (cameraAttribute.AspectWidth !== undefined && cameraAttribute.AspectHeight !== undefined) {
                    width = cameraAttribute.AspectWidth.value;
                    height = cameraAttribute.AspectHeight.value
                }
                var aspect = width / height;
                var fov = 45;
                if (cameraAttribute.FieldOfView !== undefined) {
                    fov = cameraAttribute.FieldOfView.value
                }
                var focalLength = cameraAttribute.FocalLength ? cameraAttribute.FocalLength.value : null;
                switch (type) {
                    case 0:
                        model = new THREE.PerspectiveCamera(fov, aspect, nearClippingPlane, farClippingPlane);
                        if (focalLength !== null) model.setFocalLength(focalLength);
                        break;
                    case 1:
                        model = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, nearClippingPlane, farClippingPlane);
                        break;
                    default:
                        console.warn('THREE.FBXLoader: Unknown camera type ' + type + '.');
                        model = new THREE.Object3D();
                        break
                }
            }
            return model
        }, createLight: function createLight(relationships) {
            var model;
            var lightAttribute;
            relationships.children.forEach(function (child) {
                var attr = fbxTree.Objects.NodeAttribute[child.ID];
                if (attr !== undefined) {
                    lightAttribute = attr
                }
            });
            if (lightAttribute === undefined) {
                model = new THREE.Object3D()
            } else {
                var type;
                if (lightAttribute.LightType === undefined) {
                    type = 0
                } else {
                    type = lightAttribute.LightType.value
                }
                var color = 0xffffff;
                if (lightAttribute.Color !== undefined) {
                    color = new THREE.Color().fromArray(lightAttribute.Color.value)
                }
                var intensity = lightAttribute.Intensity === undefined ? 1 : lightAttribute.Intensity.value / 100;
                if (lightAttribute.CastLightOnObject !== undefined && lightAttribute.CastLightOnObject.value === 0) {
                    intensity = 0
                }
                var distance = 0;
                if (lightAttribute.FarAttenuationEnd !== undefined) {
                    if (lightAttribute.EnableFarAttenuation !== undefined && lightAttribute.EnableFarAttenuation.value === 0) {
                        distance = 0
                    } else {
                        distance = lightAttribute.FarAttenuationEnd.value
                    }
                }
                var decay = 1;
                switch (type) {
                    case 0:
                        model = new THREE.PointLight(color, intensity, distance, decay);
                        break;
                    case 1:
                        model = new THREE.DirectionalLight(color, intensity);
                        break;
                    case 2:
                        var angle = Math.PI / 3;
                        if (lightAttribute.InnerAngle !== undefined) {
                            angle = THREE.MathUtils.degToRad(lightAttribute.InnerAngle.value)
                        }
                        var penumbra = 0;
                        if (lightAttribute.OuterAngle !== undefined) {
                            penumbra = THREE.MathUtils.degToRad(lightAttribute.OuterAngle.value);
                            penumbra = Math.max(penumbra, 1)
                        }
                        model = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
                        break;
                    default:
                        console.warn('THREE.FBXLoader: Unknown light type ' + lightAttribute.LightType.value + ', defaulting to a THREE.PointLight.');
                        model = new THREE.PointLight(color, intensity);
                        break
                }
                if (lightAttribute.CastShadows !== undefined && lightAttribute.CastShadows.value === 1) {
                    model.castShadow = true
                }
            }
            return model
        }, createMesh: function createMesh(relationships, geometryMap, materialMap) {
            var model;
            var geometry = null;
            var material = null;
            var materials = [];
            relationships.children.forEach(function (child) {
                if (geometryMap.has(child.ID)) {
                    geometry = geometryMap.get(child.ID)
                }
                if (materialMap.has(child.ID)) {
                    materials.push(materialMap.get(child.ID))
                }
            });
            if (materials.length > 1) {
                material = materials
            } else if (materials.length > 0) {
                material = materials[0]
            } else {
                material = new THREE.MeshPhongMaterial({color: 0xcccccc});
                materials.push(material)
            }
            if ('color' in geometry.attributes) {
                materials.forEach(function (material) {
                    material.vertexColors = true
                })
            }
            if (geometry.FBX_Deformer) {
                materials.forEach(function (material) {
                    material.skinning = true
                });
                model = new THREE.SkinnedMesh(geometry, material);
                model.normalizeSkinWeights()
            } else {
                model = new THREE.Mesh(geometry, material)
            }
            return model
        }, createCurve: function createCurve(relationships, geometryMap) {
            var geometry = relationships.children.reduce(function (geo, child) {
                if (geometryMap.has(child.ID)) geo = geometryMap.get(child.ID);
                return geo
            }, null);
            var material = new THREE.LineBasicMaterial({color: 0x3300ff, linewidth: 1});
            return new THREE.Line(geometry, material)
        }, getTransformData: function getTransformData(model, modelNode) {
            var transformData = {};
            if ('InheritType' in modelNode) transformData.inheritType = parseInt(modelNode.InheritType.value);
            if ('RotationOrder' in modelNode) transformData.eulerOrder = getEulerOrder(modelNode.RotationOrder.value); else transformData.eulerOrder = 'ZYX';
            if ('Lcl_Translation' in modelNode) transformData.translation = modelNode.Lcl_Translation.value;
            if ('PreRotation' in modelNode) transformData.preRotation = modelNode.PreRotation.value;
            if ('Lcl_Rotation' in modelNode) transformData.rotation = modelNode.Lcl_Rotation.value;
            if ('PostRotation' in modelNode) transformData.postRotation = modelNode.PostRotation.value;
            if ('Lcl_Scaling' in modelNode) transformData.scale = modelNode.Lcl_Scaling.value;
            if ('ScalingOffset' in modelNode) transformData.scalingOffset = modelNode.ScalingOffset.value;
            if ('ScalingPivot' in modelNode) transformData.scalingPivot = modelNode.ScalingPivot.value;
            if ('RotationOffset' in modelNode) transformData.rotationOffset = modelNode.RotationOffset.value;
            if ('RotationPivot' in modelNode) transformData.rotationPivot = modelNode.RotationPivot.value;
            model.userData.transformData = transformData
        }, setLookAtProperties: function setLookAtProperties(model, modelNode) {
            if ('LookAtProperty' in modelNode) {
                var children = connections.get(model.ID).children;
                children.forEach(function (child) {
                    if (child.relationship === 'LookAtProperty') {
                        var lookAtTarget = fbxTree.Objects.Model[child.ID];
                        if ('Lcl_Translation' in lookAtTarget) {
                            var pos = lookAtTarget.Lcl_Translation.value;
                            if (model.target !== undefined) {
                                model.target.position.fromArray(pos);
                                sceneGraph.add(model.target)
                            } else {
                                model.lookAt(new THREE.Vector3().fromArray(pos))
                            }
                        }
                    }
                })
            }
        }, bindSkeleton: function bindSkeleton(skeletons, geometryMap, modelMap) {
            var bindMatrices = this.parsePoseNodes();
            for (var ID in skeletons) {
                var skeleton = skeletons[ID];
                var parents = connections.get(parseInt(skeleton.ID)).parents;
                parents.forEach(function (parent) {
                    if (geometryMap.has(parent.ID)) {
                        var geoID = parent.ID;
                        var geoRelationships = connections.get(geoID);
                        geoRelationships.parents.forEach(function (geoConnParent) {
                            if (modelMap.has(geoConnParent.ID)) {
                                var model = modelMap.get(geoConnParent.ID);
                                model.bind(new THREE.Skeleton(skeleton.bones), bindMatrices[geoConnParent.ID])
                            }
                        })
                    }
                })
            }
        }, parsePoseNodes: function parsePoseNodes() {
            var bindMatrices = {};
            if ('Pose' in fbxTree.Objects) {
                var BindPoseNode = fbxTree.Objects.Pose;
                for (var nodeID in BindPoseNode) {
                    if (BindPoseNode[nodeID].attrType === 'BindPose') {
                        var poseNodes = BindPoseNode[nodeID].PoseNode;
                        if (Array.isArray(poseNodes)) {
                            poseNodes.forEach(function (poseNode) {
                                bindMatrices[poseNode.Node] = new THREE.Matrix4().fromArray(poseNode.Matrix.a)
                            })
                        } else {
                            bindMatrices[poseNodes.Node] = new THREE.Matrix4().fromArray(poseNodes.Matrix.a)
                        }
                    }
                }
            }
            return bindMatrices
        }, createAmbientLight: function createAmbientLight() {
            if ('GlobalSettings' in fbxTree && 'AmbientColor' in fbxTree.GlobalSettings) {
                var ambientColor = fbxTree.GlobalSettings.AmbientColor.value;
                var r = ambientColor[0];
                var g = ambientColor[1];
                var b = ambientColor[2];
                if (r !== 0 || g !== 0 || b !== 0) {
                    var color = new THREE.Color(r, g, b);
                    sceneGraph.add(new THREE.AmbientLight(color, 1))
                }
            }
        }, setupMorphMaterials: function setupMorphMaterials() {
            var self = this;
            sceneGraph.traverse(function (child) {
                if (child.isMesh) {
                    if (child.geometry.morphAttributes.position && child.geometry.morphAttributes.position.length) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(function (material, i) {
                                self.setupMorphMaterial(child, material, i)
                            })
                        } else {
                            self.setupMorphMaterial(child, child.material)
                        }
                    }
                }
            })
        }, setupMorphMaterial: function setupMorphMaterial(child, material, index) {
            var uuid = child.uuid;
            var matUuid = material.uuid;
            var sharedMat = false;
            sceneGraph.traverse(function (node) {
                if (node.isMesh) {
                    if (Array.isArray(node.material)) {
                        node.material.forEach(function (mat) {
                            if (mat.uuid === matUuid && node.uuid !== uuid) sharedMat = true
                        })
                    } else if (node.material.uuid === matUuid && node.uuid !== uuid) sharedMat = true
                }
            });
            if (sharedMat === true) {
                var clonedMat = material.clone();
                clonedMat.morphTargets = true;
                if (index === undefined) child.material = clonedMat; else child.material[index] = clonedMat
            } else material.morphTargets = true
        }
    };

    function GeometryParser() {
    }

    GeometryParser.prototype = {
        constructor: GeometryParser,
        parse: function parse(deformers) {
            var geometryMap = new Map();
            if ('Geometry' in fbxTree.Objects) {
                var geoNodes = fbxTree.Objects.Geometry;
                for (var nodeID in geoNodes) {
                    var relationships = connections.get(parseInt(nodeID));
                    var geo = this.parseGeometry(relationships, geoNodes[nodeID], deformers);
                    geometryMap.set(parseInt(nodeID), geo)
                }
            }
            return geometryMap
        },
        parseGeometry: function parseGeometry(relationships, geoNode, deformers) {
            switch (geoNode.attrType) {
                case'Mesh':
                    return this.parseMeshGeometry(relationships, geoNode, deformers);
                    break;
                case'NurbsCurve':
                    return this.parseNurbsGeometry(geoNode);
                    break
            }
        },
        parseMeshGeometry: function parseMeshGeometry(relationships, geoNode, deformers) {
            var skeletons = deformers.skeletons;
            var morphTargets = [];
            var modelNodes = relationships.parents.map(function (parent) {
                return fbxTree.Objects.Model[parent.ID]
            });
            if (modelNodes.length === 0) return;
            var skeleton = relationships.children.reduce(function (skeleton, child) {
                if (skeletons[child.ID] !== undefined) skeleton = skeletons[child.ID];
                return skeleton
            }, null);
            relationships.children.forEach(function (child) {
                if (deformers.morphTargets[child.ID] !== undefined) {
                    morphTargets.push(deformers.morphTargets[child.ID])
                }
            });
            var modelNode = modelNodes[0];
            var transformData = {};
            if ('RotationOrder' in modelNode) transformData.eulerOrder = getEulerOrder(modelNode.RotationOrder.value);
            if ('InheritType' in modelNode) transformData.inheritType = parseInt(modelNode.InheritType.value);
            if ('GeometricTranslation' in modelNode) transformData.translation = modelNode.GeometricTranslation.value;
            if ('GeometricRotation' in modelNode) transformData.rotation = modelNode.GeometricRotation.value;
            if ('GeometricScaling' in modelNode) transformData.scale = modelNode.GeometricScaling.value;
            var transform = generateTransform(transformData);
            return this.genGeometry(geoNode, skeleton, morphTargets, transform)
        },
        genGeometry: function genGeometry(geoNode, skeleton, morphTargets, preTransform) {
            var geo = new THREE.BufferGeometry();
            if (geoNode.attrName) geo.name = geoNode.attrName;
            var geoInfo = this.parseGeoNode(geoNode, skeleton);
            var buffers = this.genBuffers(geoInfo);
            var positionAttribute = new THREE.Float32BufferAttribute(buffers.vertex, 3);
            positionAttribute.applyMatrix4(preTransform);
            geo.setAttribute('position', positionAttribute);
            if (buffers.colors.length > 0) {
                geo.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
            }
            if (skeleton) {
                geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(buffers.weightsIndices, 4));
                geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(buffers.vertexWeights, 4));
                geo.FBX_Deformer = skeleton
            }
            if (buffers.normal.length > 0) {
                var normalMatrix = new THREE.Matrix3().getNormalMatrix(preTransform);
                var normalAttribute = new THREE.Float32BufferAttribute(buffers.normal, 3);
                normalAttribute.applyNormalMatrix(normalMatrix);
                geo.setAttribute('normal', normalAttribute)
            }
            buffers.uvs.forEach(function (uvBuffer, i) {
                var name = 'uv' + (i + 1).toString();
                if (i === 0) {
                    name = 'uv'
                }
                geo.setAttribute(name, new THREE.Float32BufferAttribute(buffers.uvs[i], 2))
            });
            if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {
                var prevMaterialIndex = buffers.materialIndex[0];
                var startIndex = 0;
                buffers.materialIndex.forEach(function (currentIndex, i) {
                    if (currentIndex !== prevMaterialIndex) {
                        geo.addGroup(startIndex, i - startIndex, prevMaterialIndex);
                        prevMaterialIndex = currentIndex;
                        startIndex = i
                    }
                });
                if (geo.groups.length > 0) {
                    var lastGroup = geo.groups[geo.groups.length - 1];
                    var lastIndex = lastGroup.start + lastGroup.count;
                    if (lastIndex !== buffers.materialIndex.length) {
                        geo.addGroup(lastIndex, buffers.materialIndex.length - lastIndex, prevMaterialIndex)
                    }
                }
                if (geo.groups.length === 0) {
                    geo.addGroup(0, buffers.materialIndex.length, buffers.materialIndex[0])
                }
            }
            this.addMorphTargets(geo, geoNode, morphTargets, preTransform);
            return geo
        },
        parseGeoNode: function parseGeoNode(geoNode, skeleton) {
            var geoInfo = {};
            geoInfo.vertexPositions = geoNode.Vertices !== undefined ? geoNode.Vertices.a : [];
            geoInfo.vertexIndices = geoNode.PolygonVertexIndex !== undefined ? geoNode.PolygonVertexIndex.a : [];
            if (geoNode.LayerElementColor) {
                geoInfo.color = this.parseVertexColors(geoNode.LayerElementColor[0])
            }
            if (geoNode.LayerElementMaterial) {
                geoInfo.material = this.parseMaterialIndices(geoNode.LayerElementMaterial[0])
            }
            if (geoNode.LayerElementNormal) {
                geoInfo.normal = this.parseNormals(geoNode.LayerElementNormal[0])
            }
            if (geoNode.LayerElementUV) {
                geoInfo.uv = [];
                var i = 0;
                while (geoNode.LayerElementUV[i]) {
                    geoInfo.uv.push(this.parseUVs(geoNode.LayerElementUV[i]));
                    i++
                }
            }
            geoInfo.weightTable = {};
            if (skeleton !== null) {
                geoInfo.skeleton = skeleton;
                skeleton.rawBones.forEach(function (rawBone, i) {
                    rawBone.indices.forEach(function (index, j) {
                        if (geoInfo.weightTable[index] === undefined) geoInfo.weightTable[index] = [];
                        geoInfo.weightTable[index].push({id: i, weight: rawBone.weights[j]})
                    })
                })
            }
            return geoInfo
        },
        genBuffers: function genBuffers(geoInfo) {
            var buffers = {
                vertex: [],
                normal: [],
                colors: [],
                uvs: [],
                materialIndex: [],
                vertexWeights: [],
                weightsIndices: []
            };
            var polygonIndex = 0;
            var faceLength = 0;
            var displayedWeightsWarning = false;
            var facePositionIndexes = [];
            var faceNormals = [];
            var faceColors = [];
            var faceUVs = [];
            var faceWeights = [];
            var faceWeightIndices = [];
            var self = this;
            geoInfo.vertexIndices.forEach(function (vertexIndex, polygonVertexIndex) {
                var endOfFace = false;
                if (vertexIndex < 0) {
                    vertexIndex = vertexIndex ^ -1;
                    endOfFace = true
                }
                var weightIndices = [];
                var weights = [];
                facePositionIndexes.push(vertexIndex * 3, vertexIndex * 3 + 1, vertexIndex * 3 + 2);
                if (geoInfo.color) {
                    var data = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.color);
                    faceColors.push(data[0], data[1], data[2])
                }
                if (geoInfo.skeleton) {
                    if (geoInfo.weightTable[vertexIndex] !== undefined) {
                        geoInfo.weightTable[vertexIndex].forEach(function (wt) {
                            weights.push(wt.weight);
                            weightIndices.push(wt.id)
                        })
                    }
                    if (weights.length > 4) {
                        if (!displayedWeightsWarning) {
                            console.warn('THREE.FBXLoader: Vertex has more than 4 skinning weights assigned to vertex. Deleting additional weights.');
                            displayedWeightsWarning = true
                        }
                        var wIndex = [0, 0, 0, 0];
                        var Weight = [0, 0, 0, 0];
                        weights.forEach(function (weight, weightIndex) {
                            var currentWeight = weight;
                            var currentIndex = weightIndices[weightIndex];
                            Weight.forEach(function (comparedWeight, comparedWeightIndex, comparedWeightArray) {
                                if (currentWeight > comparedWeight) {
                                    comparedWeightArray[comparedWeightIndex] = currentWeight;
                                    currentWeight = comparedWeight;
                                    var tmp = wIndex[comparedWeightIndex];
                                    wIndex[comparedWeightIndex] = currentIndex;
                                    currentIndex = tmp
                                }
                            })
                        });
                        weightIndices = wIndex;
                        weights = Weight
                    }
                    while (weights.length < 4) {
                        weights.push(0);
                        weightIndices.push(0)
                    }
                    for (var i = 0; i < 4; ++i) {
                        faceWeights.push(weights[i]);
                        faceWeightIndices.push(weightIndices[i])
                    }
                }
                if (geoInfo.normal) {
                    var data = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.normal);
                    faceNormals.push(data[0], data[1], data[2])
                }
                if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {
                    var materialIndex = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.material)[0]
                }
                if (geoInfo.uv) {
                    geoInfo.uv.forEach(function (uv, i) {
                        var data = getData(polygonVertexIndex, polygonIndex, vertexIndex, uv);
                        if (faceUVs[i] === undefined) {
                            faceUVs[i] = []
                        }
                        faceUVs[i].push(data[0]);
                        faceUVs[i].push(data[1])
                    })
                }
                faceLength++;
                if (endOfFace) {
                    self.genFace(buffers, geoInfo, facePositionIndexes, materialIndex, faceNormals, faceColors, faceUVs, faceWeights, faceWeightIndices, faceLength);
                    polygonIndex++;
                    faceLength = 0;
                    facePositionIndexes = [];
                    faceNormals = [];
                    faceColors = [];
                    faceUVs = [];
                    faceWeights = [];
                    faceWeightIndices = []
                }
            });
            return buffers
        },
        genFace: function genFace(buffers, geoInfo, facePositionIndexes, materialIndex, faceNormals, faceColors, faceUVs, faceWeights, faceWeightIndices, faceLength) {
            for (var i = 2; i < faceLength; i++) {
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[0]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[1]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[2]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[(i - 1) * 3]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[(i - 1) * 3 + 1]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[(i - 1) * 3 + 2]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i * 3]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i * 3 + 1]]);
                buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i * 3 + 2]]);
                if (geoInfo.skeleton) {
                    buffers.vertexWeights.push(faceWeights[0]);
                    buffers.vertexWeights.push(faceWeights[1]);
                    buffers.vertexWeights.push(faceWeights[2]);
                    buffers.vertexWeights.push(faceWeights[3]);
                    buffers.vertexWeights.push(faceWeights[(i - 1) * 4]);
                    buffers.vertexWeights.push(faceWeights[(i - 1) * 4 + 1]);
                    buffers.vertexWeights.push(faceWeights[(i - 1) * 4 + 2]);
                    buffers.vertexWeights.push(faceWeights[(i - 1) * 4 + 3]);
                    buffers.vertexWeights.push(faceWeights[i * 4]);
                    buffers.vertexWeights.push(faceWeights[i * 4 + 1]);
                    buffers.vertexWeights.push(faceWeights[i * 4 + 2]);
                    buffers.vertexWeights.push(faceWeights[i * 4 + 3]);
                    buffers.weightsIndices.push(faceWeightIndices[0]);
                    buffers.weightsIndices.push(faceWeightIndices[1]);
                    buffers.weightsIndices.push(faceWeightIndices[2]);
                    buffers.weightsIndices.push(faceWeightIndices[3]);
                    buffers.weightsIndices.push(faceWeightIndices[(i - 1) * 4]);
                    buffers.weightsIndices.push(faceWeightIndices[(i - 1) * 4 + 1]);
                    buffers.weightsIndices.push(faceWeightIndices[(i - 1) * 4 + 2]);
                    buffers.weightsIndices.push(faceWeightIndices[(i - 1) * 4 + 3]);
                    buffers.weightsIndices.push(faceWeightIndices[i * 4]);
                    buffers.weightsIndices.push(faceWeightIndices[i * 4 + 1]);
                    buffers.weightsIndices.push(faceWeightIndices[i * 4 + 2]);
                    buffers.weightsIndices.push(faceWeightIndices[i * 4 + 3])
                }
                if (geoInfo.color) {
                    buffers.colors.push(faceColors[0]);
                    buffers.colors.push(faceColors[1]);
                    buffers.colors.push(faceColors[2]);
                    buffers.colors.push(faceColors[(i - 1) * 3]);
                    buffers.colors.push(faceColors[(i - 1) * 3 + 1]);
                    buffers.colors.push(faceColors[(i - 1) * 3 + 2]);
                    buffers.colors.push(faceColors[i * 3]);
                    buffers.colors.push(faceColors[i * 3 + 1]);
                    buffers.colors.push(faceColors[i * 3 + 2])
                }
                if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {
                    buffers.materialIndex.push(materialIndex);
                    buffers.materialIndex.push(materialIndex);
                    buffers.materialIndex.push(materialIndex)
                }
                if (geoInfo.normal) {
                    buffers.normal.push(faceNormals[0]);
                    buffers.normal.push(faceNormals[1]);
                    buffers.normal.push(faceNormals[2]);
                    buffers.normal.push(faceNormals[(i - 1) * 3]);
                    buffers.normal.push(faceNormals[(i - 1) * 3 + 1]);
                    buffers.normal.push(faceNormals[(i - 1) * 3 + 2]);
                    buffers.normal.push(faceNormals[i * 3]);
                    buffers.normal.push(faceNormals[i * 3 + 1]);
                    buffers.normal.push(faceNormals[i * 3 + 2])
                }
                if (geoInfo.uv) {
                    geoInfo.uv.forEach(function (uv, j) {
                        if (buffers.uvs[j] === undefined) buffers.uvs[j] = [];
                        buffers.uvs[j].push(faceUVs[j][0]);
                        buffers.uvs[j].push(faceUVs[j][1]);
                        buffers.uvs[j].push(faceUVs[j][(i - 1) * 2]);
                        buffers.uvs[j].push(faceUVs[j][(i - 1) * 2 + 1]);
                        buffers.uvs[j].push(faceUVs[j][i * 2]);
                        buffers.uvs[j].push(faceUVs[j][i * 2 + 1])
                    })
                }
            }
        },
        addMorphTargets: function addMorphTargets(parentGeo, parentGeoNode, morphTargets, preTransform) {
            if (morphTargets.length === 0) return;
            parentGeo.morphTargetsRelative = true;
            parentGeo.morphAttributes.position = [];
            var self = this;
            morphTargets.forEach(function (morphTarget) {
                morphTarget.rawTargets.forEach(function (rawTarget) {
                    var morphGeoNode = fbxTree.Objects.Geometry[rawTarget.geoID];
                    if (morphGeoNode !== undefined) {
                        self.genMorphGeometry(parentGeo, parentGeoNode, morphGeoNode, preTransform, rawTarget.name)
                    }
                })
            })
        },
        genMorphGeometry: function genMorphGeometry(parentGeo, parentGeoNode, morphGeoNode, preTransform, name) {
            var vertexIndices = parentGeoNode.PolygonVertexIndex !== undefined ? parentGeoNode.PolygonVertexIndex.a : [];
            var morphPositionsSparse = morphGeoNode.Vertices !== undefined ? morphGeoNode.Vertices.a : [];
            var indices = morphGeoNode.Indexes !== undefined ? morphGeoNode.Indexes.a : [];
            var length = parentGeo.attributes.position.count * 3;
            var morphPositions = new Float32Array(length);
            for (var i = 0; i < indices.length; i++) {
                var morphIndex = indices[i] * 3;
                morphPositions[morphIndex] = morphPositionsSparse[i * 3];
                morphPositions[morphIndex + 1] = morphPositionsSparse[i * 3 + 1];
                morphPositions[morphIndex + 2] = morphPositionsSparse[i * 3 + 2]
            }
            var morphGeoInfo = {vertexIndices: vertexIndices, vertexPositions: morphPositions};
            var morphBuffers = this.genBuffers(morphGeoInfo);
            var positionAttribute = new THREE.Float32BufferAttribute(morphBuffers.vertex, 3);
            positionAttribute.name = name || morphGeoNode.attrName;
            positionAttribute.applyMatrix4(preTransform);
            parentGeo.morphAttributes.position.push(positionAttribute)
        },
        parseNormals: function parseNormals(NormalNode) {
            var mappingType = NormalNode.MappingInformationType;
            var referenceType = NormalNode.ReferenceInformationType;
            var buffer = NormalNode.Normals.a;
            var indexBuffer = [];
            if (referenceType === 'IndexToDirect') {
                if ('NormalIndex' in NormalNode) {
                    indexBuffer = NormalNode.NormalIndex.a
                } else if ('NormalsIndex' in NormalNode) {
                    indexBuffer = NormalNode.NormalsIndex.a
                }
            }
            return {
                dataSize: 3,
                buffer: buffer,
                indices: indexBuffer,
                mappingType: mappingType,
                referenceType: referenceType
            }
        },
        parseUVs: function parseUVs(UVNode) {
            var mappingType = UVNode.MappingInformationType;
            var referenceType = UVNode.ReferenceInformationType;
            var buffer = UVNode.UV.a;
            var indexBuffer = [];
            if (referenceType === 'IndexToDirect') {
                indexBuffer = UVNode.UVIndex.a
            }
            return {
                dataSize: 2,
                buffer: buffer,
                indices: indexBuffer,
                mappingType: mappingType,
                referenceType: referenceType
            }
        },
        parseVertexColors: function parseVertexColors(ColorNode) {
            var mappingType = ColorNode.MappingInformationType;
            var referenceType = ColorNode.ReferenceInformationType;
            var buffer = ColorNode.Colors.a;
            var indexBuffer = [];
            if (referenceType === 'IndexToDirect') {
                indexBuffer = ColorNode.ColorIndex.a
            }
            return {
                dataSize: 4,
                buffer: buffer,
                indices: indexBuffer,
                mappingType: mappingType,
                referenceType: referenceType
            }
        },
        parseMaterialIndices: function parseMaterialIndices(MaterialNode) {
            var mappingType = MaterialNode.MappingInformationType;
            var referenceType = MaterialNode.ReferenceInformationType;
            if (mappingType === 'NoMappingInformation') {
                return {dataSize: 1, buffer: [0], indices: [0], mappingType: 'AllSame', referenceType: referenceType}
            }
            var materialIndexBuffer = MaterialNode.Materials.a;
            var materialIndices = [];
            for (var i = 0; i < materialIndexBuffer.length; ++i) {
                materialIndices.push(i)
            }
            return {
                dataSize: 1,
                buffer: materialIndexBuffer,
                indices: materialIndices,
                mappingType: mappingType,
                referenceType: referenceType
            }
        },
        parseNurbsGeometry: function parseNurbsGeometry(geoNode) {
            if (THREE.NURBSCurve === undefined) {
                console.error('THREE.FBXLoader: The loader relies on THREE.NURBSCurve for any nurbs present in the model. Nurbs will show up as empty geometry.');
                return new THREE.BufferGeometry()
            }
            var order = parseInt(geoNode.Order);
            if (isNaN(order)) {
                console.error('THREE.FBXLoader: Invalid Order %s given for geometry ID: %s', geoNode.Order, geoNode.id);
                return new THREE.BufferGeometry()
            }
            var degree = order - 1;
            var knots = geoNode.KnotVector.a;
            var controlPoints = [];
            var pointsValues = geoNode.Points.a;
            for (var i = 0, l = pointsValues.length; i < l; i += 4) {
                controlPoints.push(new THREE.Vector4().fromArray(pointsValues, i))
            }
            var startKnot, endKnot;
            if (geoNode.Form === 'Closed') {
                controlPoints.push(controlPoints[0])
            } else if (geoNode.Form === 'Periodic') {
                startKnot = degree;
                endKnot = knots.length - 1 - startKnot;
                for (var i = 0; i < degree; ++i) {
                    controlPoints.push(controlPoints[i])
                }
            }
            var curve = new THREE.NURBSCurve(degree, knots, controlPoints, startKnot, endKnot);
            var vertices = curve.getPoints(controlPoints.length * 7);
            var positions = new Float32Array(vertices.length * 3);
            vertices.forEach(function (vertex, i) {
                vertex.toArray(positions, i * 3)
            });
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            return geometry
        }
    };

    function AnimationParser() {
    }

    AnimationParser.prototype = {
        constructor: AnimationParser,
        parse: function parse() {
            var animationClips = [];
            var rawClips = this.parseClips();
            if (rawClips !== undefined) {
                for (var key in rawClips) {
                    var rawClip = rawClips[key];
                    var clip = this.addClip(rawClip);
                    animationClips.push(clip)
                }
            }
            return animationClips
        },
        parseClips: function parseClips() {
            if (fbxTree.Objects.AnimationCurve === undefined) return undefined;
            var curveNodesMap = this.parseAnimationCurveNodes();
            this.parseAnimationCurves(curveNodesMap);
            var layersMap = this.parseAnimationLayers(curveNodesMap);
            var rawClips = this.parseAnimStacks(layersMap);
            return rawClips
        },
        parseAnimationCurveNodes: function parseAnimationCurveNodes() {
            var rawCurveNodes = fbxTree.Objects.AnimationCurveNode;
            var curveNodesMap = new Map();
            for (var nodeID in rawCurveNodes) {
                var rawCurveNode = rawCurveNodes[nodeID];
                if (rawCurveNode.attrName.match(/S|R|T|DeformPercent/) !== null) {
                    var curveNode = {id: rawCurveNode.id, attr: rawCurveNode.attrName, curves: {}};
                    curveNodesMap.set(curveNode.id, curveNode)
                }
            }
            return curveNodesMap
        },
        parseAnimationCurves: function parseAnimationCurves(curveNodesMap) {
            var rawCurves = fbxTree.Objects.AnimationCurve;
            for (var nodeID in rawCurves) {
                var animationCurve = {
                    id: rawCurves[nodeID].id,
                    times: rawCurves[nodeID].KeyTime.a.map(convertFBXTimeToSeconds),
                    values: rawCurves[nodeID].KeyValueFloat.a
                };
                var relationships = connections.get(animationCurve.id);
                if (relationships !== undefined) {
                    var animationCurveID = relationships.parents[0].ID;
                    var animationCurveRelationship = relationships.parents[0].relationship;
                    if (animationCurveRelationship.match(/X/)) {
                        curveNodesMap.get(animationCurveID).curves['x'] = animationCurve
                    } else if (animationCurveRelationship.match(/Y/)) {
                        curveNodesMap.get(animationCurveID).curves['y'] = animationCurve
                    } else if (animationCurveRelationship.match(/Z/)) {
                        curveNodesMap.get(animationCurveID).curves['z'] = animationCurve
                    } else if (animationCurveRelationship.match(/d|DeformPercent/) && curveNodesMap.has(animationCurveID)) {
                        curveNodesMap.get(animationCurveID).curves['morph'] = animationCurve
                    }
                }
            }
        },
        parseAnimationLayers: function parseAnimationLayers(curveNodesMap) {
            var rawLayers = fbxTree.Objects.AnimationLayer;
            var layersMap = new Map();
            for (var nodeID in rawLayers) {
                var layerCurveNodes = [];
                var connection = connections.get(parseInt(nodeID));
                if (connection !== undefined) {
                    var children = connection.children;
                    children.forEach(function (child, i) {
                        if (curveNodesMap.has(child.ID)) {
                            var curveNode = curveNodesMap.get(child.ID);
                            if (curveNode.curves.x !== undefined || curveNode.curves.y !== undefined || curveNode.curves.z !== undefined) {
                                if (layerCurveNodes[i] === undefined) {
                                    var modelID = connections.get(child.ID).parents.filter(function (parent) {
                                        return parent.relationship !== undefined
                                    })[0].ID;
                                    if (modelID !== undefined) {
                                        var rawModel = fbxTree.Objects.Model[modelID.toString()];
                                        var node = {
                                            modelName: rawModel.attrName ? THREE.PropertyBinding.sanitizeNodeName(rawModel.attrName) : '',
                                            ID: rawModel.id,
                                            initialPosition: [0, 0, 0],
                                            initialRotation: [0, 0, 0],
                                            initialScale: [1, 1, 1]
                                        };
                                        sceneGraph.traverse(function (child) {
                                            if (child.ID === rawModel.id) {
                                                node.transform = child.matrix;
                                                if (child.userData.transformData) node.eulerOrder = child.userData.transformData.eulerOrder
                                            }
                                        });
                                        if (!node.transform) node.transform = new THREE.Matrix4();
                                        if ('PreRotation' in rawModel) node.preRotation = rawModel.PreRotation.value;
                                        if ('PostRotation' in rawModel) node.postRotation = rawModel.PostRotation.value;
                                        layerCurveNodes[i] = node
                                    }
                                }
                                if (layerCurveNodes[i]) layerCurveNodes[i][curveNode.attr] = curveNode
                            } else if (curveNode.curves.morph !== undefined) {
                                if (layerCurveNodes[i] === undefined) {
                                    var deformerID = connections.get(child.ID).parents.filter(function (parent) {
                                        return parent.relationship !== undefined
                                    })[0].ID;
                                    var morpherID = connections.get(deformerID).parents[0].ID;
                                    var geoID = connections.get(morpherID).parents[0].ID;
                                    var modelID = connections.get(geoID).parents[0].ID;
                                    var rawModel = fbxTree.Objects.Model[modelID];
                                    var node = {
                                        modelName: rawModel.attrName ? THREE.PropertyBinding.sanitizeNodeName(rawModel.attrName) : '',
                                        morphName: fbxTree.Objects.Deformer[deformerID].attrName
                                    };
                                    layerCurveNodes[i] = node
                                }
                                layerCurveNodes[i][curveNode.attr] = curveNode
                            }
                        }
                    });
                    layersMap.set(parseInt(nodeID), layerCurveNodes)
                }
            }
            return layersMap
        },
        parseAnimStacks: function parseAnimStacks(layersMap) {
            var rawStacks = fbxTree.Objects.AnimationStack;
            var rawClips = {};
            for (var nodeID in rawStacks) {
                var children = connections.get(parseInt(nodeID)).children;
                if (children.length > 1) {
                    console.warn('THREE.FBXLoader: Encountered an animation stack with multiple layers, this is currently not supported. Ignoring subsequent layers.')
                }
                var layer = layersMap.get(children[0].ID);
                rawClips[nodeID] = {name: rawStacks[nodeID].attrName, layer: layer}
            }
            return rawClips
        },
        addClip: function addClip(rawClip) {
            var tracks = [];
            var self = this;
            rawClip.layer.forEach(function (rawTracks) {
                tracks = tracks.concat(self.generateTracks(rawTracks))
            });
            return new THREE.AnimationClip(rawClip.name, -1, tracks)
        },
        generateTracks: function generateTracks(rawTracks) {
            var tracks = [];
            var initialPosition = new THREE.Vector3();
            var initialRotation = new THREE.Quaternion();
            var initialScale = new THREE.Vector3();
            if (rawTracks.transform) rawTracks.transform.decompose(initialPosition, initialRotation, initialScale);
            initialPosition = initialPosition.toArray();
            initialRotation = new THREE.Euler().setFromQuaternion(initialRotation, rawTracks.eulerOrder).toArray();
            initialScale = initialScale.toArray();
            if (rawTracks.T !== undefined && Object.keys(rawTracks.T.curves).length > 0) {
                var positionTrack = this.generateVectorTrack(rawTracks.modelName, rawTracks.T.curves, initialPosition, 'position');
                if (positionTrack !== undefined) tracks.push(positionTrack)
            }
            if (rawTracks.R !== undefined && Object.keys(rawTracks.R.curves).length > 0) {
                var rotationTrack = this.generateRotationTrack(rawTracks.modelName, rawTracks.R.curves, initialRotation, rawTracks.preRotation, rawTracks.postRotation, rawTracks.eulerOrder);
                if (rotationTrack !== undefined) tracks.push(rotationTrack)
            }
            if (rawTracks.S !== undefined && Object.keys(rawTracks.S.curves).length > 0) {
                var scaleTrack = this.generateVectorTrack(rawTracks.modelName, rawTracks.S.curves, initialScale, 'scale');
                if (scaleTrack !== undefined) tracks.push(scaleTrack)
            }
            if (rawTracks.DeformPercent !== undefined) {
                var morphTrack = this.generateMorphTrack(rawTracks);
                if (morphTrack !== undefined) tracks.push(morphTrack)
            }
            return tracks
        },
        generateVectorTrack: function generateVectorTrack(modelName, curves, initialValue, type) {
            var times = this.getTimesForAllAxes(curves);
            var values = this.getKeyframeTrackValues(times, curves, initialValue);
            return new THREE.VectorKeyframeTrack(modelName + '.' + type, times, values)
        },
        generateRotationTrack: function generateRotationTrack(modelName, curves, initialValue, preRotation, postRotation, eulerOrder) {
            if (curves.x !== undefined) {
                this.interpolateRotations(curves.x);
                curves.x.values = curves.x.values.map(THREE.MathUtils.degToRad)
            }
            if (curves.y !== undefined) {
                this.interpolateRotations(curves.y);
                curves.y.values = curves.y.values.map(THREE.MathUtils.degToRad)
            }
            if (curves.z !== undefined) {
                this.interpolateRotations(curves.z);
                curves.z.values = curves.z.values.map(THREE.MathUtils.degToRad)
            }
            var times = this.getTimesForAllAxes(curves);
            var values = this.getKeyframeTrackValues(times, curves, initialValue);
            if (preRotation !== undefined) {
                preRotation = preRotation.map(THREE.MathUtils.degToRad);
                preRotation.push(eulerOrder);
                preRotation = new THREE.Euler().fromArray(preRotation);
                preRotation = new THREE.Quaternion().setFromEuler(preRotation)
            }
            if (postRotation !== undefined) {
                postRotation = postRotation.map(THREE.MathUtils.degToRad);
                postRotation.push(eulerOrder);
                postRotation = new THREE.Euler().fromArray(postRotation);
                postRotation = new THREE.Quaternion().setFromEuler(postRotation).inverse()
            }
            var quaternion = new THREE.Quaternion();
            var euler = new THREE.Euler();
            var quaternionValues = [];
            for (var i = 0; i < values.length; i += 3) {
                euler.set(values[i], values[i + 1], values[i + 2], eulerOrder);
                quaternion.setFromEuler(euler);
                if (preRotation !== undefined) quaternion.premultiply(preRotation);
                if (postRotation !== undefined) quaternion.multiply(postRotation);
                quaternion.toArray(quaternionValues, i / 3 * 4)
            }
            return new THREE.QuaternionKeyframeTrack(modelName + '.quaternion', times, quaternionValues)
        },
        generateMorphTrack: function generateMorphTrack(rawTracks) {
            var curves = rawTracks.DeformPercent.curves.morph;
            var values = curves.values.map(function (val) {
                return val / 100
            });
            var morphNum = sceneGraph.getObjectByName(rawTracks.modelName).morphTargetDictionary[rawTracks.morphName];
            return new THREE.NumberKeyframeTrack(rawTracks.modelName + '.morphTargetInfluences[' + morphNum + ']', curves.times, values)
        },
        getTimesForAllAxes: function getTimesForAllAxes(curves) {
            var times = [];
            if (curves.x !== undefined) times = times.concat(curves.x.times);
            if (curves.y !== undefined) times = times.concat(curves.y.times);
            if (curves.z !== undefined) times = times.concat(curves.z.times);
            times = times.sort(function (a, b) {
                return a - b
            }).filter(function (elem, index, array) {
                return array.indexOf(elem) == index
            });
            return times
        },
        getKeyframeTrackValues: function getKeyframeTrackValues(times, curves, initialValue) {
            var prevValue = initialValue;
            var values = [];
            var xIndex = -1;
            var yIndex = -1;
            var zIndex = -1;
            times.forEach(function (time) {
                if (curves.x) xIndex = curves.x.times.indexOf(time);
                if (curves.y) yIndex = curves.y.times.indexOf(time);
                if (curves.z) zIndex = curves.z.times.indexOf(time);
                if (xIndex !== -1) {
                    var xValue = curves.x.values[xIndex];
                    values.push(xValue);
                    prevValue[0] = xValue
                } else {
                    values.push(prevValue[0])
                }
                if (yIndex !== -1) {
                    var yValue = curves.y.values[yIndex];
                    values.push(yValue);
                    prevValue[1] = yValue
                } else {
                    values.push(prevValue[1])
                }
                if (zIndex !== -1) {
                    var zValue = curves.z.values[zIndex];
                    values.push(zValue);
                    prevValue[2] = zValue
                } else {
                    values.push(prevValue[2])
                }
            });
            return values
        },
        interpolateRotations: function interpolateRotations(curve) {
            for (var i = 1; i < curve.values.length; i++) {
                var initialValue = curve.values[i - 1];
                var valuesSpan = curve.values[i] - initialValue;
                var absoluteSpan = Math.abs(valuesSpan);
                if (absoluteSpan >= 180) {
                    var numSubIntervals = absoluteSpan / 180;
                    var step = valuesSpan / numSubIntervals;
                    var nextValue = initialValue + step;
                    var initialTime = curve.times[i - 1];
                    var timeSpan = curve.times[i] - initialTime;
                    var interval = timeSpan / numSubIntervals;
                    var nextTime = initialTime + interval;
                    var interpolatedTimes = [];
                    var interpolatedValues = [];
                    while (nextTime < curve.times[i]) {
                        interpolatedTimes.push(nextTime);
                        nextTime += interval;
                        interpolatedValues.push(nextValue);
                        nextValue += step
                    }
                    curve.times = inject(curve.times, i, interpolatedTimes);
                    curve.values = inject(curve.values, i, interpolatedValues)
                }
            }
        }
    };

    function TextParser() {
    }

    TextParser.prototype = {
        constructor: TextParser, getPrevNode: function getPrevNode() {
            return this.nodeStack[this.currentIndent - 2]
        }, getCurrentNode: function getCurrentNode() {
            return this.nodeStack[this.currentIndent - 1]
        }, getCurrentProp: function getCurrentProp() {
            return this.currentProp
        }, pushStack: function pushStack(node) {
            this.nodeStack.push(node);
            this.currentIndent += 1
        }, popStack: function popStack() {
            this.nodeStack.pop();
            this.currentIndent -= 1
        }, setCurrentProp: function setCurrentProp(val, name) {
            this.currentProp = val;
            this.currentPropName = name
        }, parse: function parse(text) {
            this.currentIndent = 0;
            this.allNodes = new FBXTree();
            this.nodeStack = [];
            this.currentProp = [];
            this.currentPropName = '';
            var self = this;
            var split = text.split(/[\r\n]+/);
            split.forEach(function (line, i) {
                var matchComment = line.match(/^[\s\t]*;/);
                var matchEmpty = line.match(/^[\s\t]*$/);
                if (matchComment || matchEmpty) return;
                var matchBeginning = line.match('^\\t{' + self.currentIndent + '}(\\w+):(.*){', '');
                var matchProperty = line.match('^\\t{' + self.currentIndent + '}(\\w+):[\\s\\t\\r\\n](.*)');
                var matchEnd = line.match('^\\t{' + (self.currentIndent - 1) + '}}');
                if (matchBeginning) {
                    self.parseNodeBegin(line, matchBeginning)
                } else if (matchProperty) {
                    self.parseNodeProperty(line, matchProperty, split[++i])
                } else if (matchEnd) {
                    self.popStack()
                } else if (line.match(/^[^\s\t}]/)) {
                    self.parseNodePropertyContinued(line)
                }
            });
            return this.allNodes
        }, parseNodeBegin: function parseNodeBegin(line, property) {
            var nodeName = property[1].trim().replace(/^"/, '').replace(/"$/, '');
            var nodeAttrs = property[2].split(',').map(function (attr) {
                return attr.trim().replace(/^"/, '').replace(/"$/, '')
            });
            var node = {name: nodeName};
            var attrs = this.parseNodeAttr(nodeAttrs);
            var currentNode = this.getCurrentNode();
            if (this.currentIndent === 0) {
                this.allNodes.add(nodeName, node)
            } else {
                if (nodeName in currentNode) {
                    if (nodeName === 'PoseNode') {
                        currentNode.PoseNode.push(node)
                    } else if (currentNode[nodeName].id !== undefined) {
                        currentNode[nodeName] = {};
                        currentNode[nodeName][currentNode[nodeName].id] = currentNode[nodeName]
                    }
                    if (attrs.id !== '') currentNode[nodeName][attrs.id] = node
                } else if (typeof attrs.id === 'number') {
                    currentNode[nodeName] = {};
                    currentNode[nodeName][attrs.id] = node
                } else if (nodeName !== 'Properties70') {
                    if (nodeName === 'PoseNode') currentNode[nodeName] = [node]; else currentNode[nodeName] = node
                }
            }
            if (typeof attrs.id === 'number') node.id = attrs.id;
            if (attrs.name !== '') node.attrName = attrs.name;
            if (attrs.type !== '') node.attrType = attrs.type;
            this.pushStack(node)
        }, parseNodeAttr: function parseNodeAttr(attrs) {
            var id = attrs[0];
            if (attrs[0] !== '') {
                id = parseInt(attrs[0]);
                if (isNaN(id)) {
                    id = attrs[0]
                }
            }
            var name = '', type = '';
            if (attrs.length > 1) {
                name = attrs[1].replace(/^(\w+)::/, '');
                type = attrs[2]
            }
            return {id: id, name: name, type: type}
        }, parseNodeProperty: function parseNodeProperty(line, property, contentLine) {
            var propName = property[1].replace(/^"/, '').replace(/"$/, '').trim();
            var propValue = property[2].replace(/^"/, '').replace(/"$/, '').trim();
            if (propName === 'Content' && propValue === ',') {
                propValue = contentLine.replace(/"/g, '').replace(/,$/, '').trim()
            }
            var currentNode = this.getCurrentNode();
            var parentName = currentNode.name;
            if (parentName === 'Properties70') {
                this.parseNodeSpecialProperty(line, propName, propValue);
                return
            }
            if (propName === 'C') {
                var connProps = propValue.split(',').slice(1);
                var from = parseInt(connProps[0]);
                var to = parseInt(connProps[1]);
                var rest = propValue.split(',').slice(3);
                rest = rest.map(function (elem) {
                    return elem.trim().replace(/^"/, '')
                });
                propName = 'connections';
                propValue = [from, to];
                append(propValue, rest);
                if (currentNode[propName] === undefined) {
                    currentNode[propName] = []
                }
            }
            if (propName === 'Node') currentNode.id = propValue;
            if (propName in currentNode && Array.isArray(currentNode[propName])) {
                currentNode[propName].push(propValue)
            } else {
                if (propName !== 'a') currentNode[propName] = propValue; else currentNode.a = propValue
            }
            this.setCurrentProp(currentNode, propName);
            if (propName === 'a' && propValue.slice(-1) !== ',') {
                currentNode.a = parseNumberArray(propValue)
            }
        }, parseNodePropertyContinued: function parseNodePropertyContinued(line) {
            var currentNode = this.getCurrentNode();
            currentNode.a += line;
            if (line.slice(-1) !== ',') {
                currentNode.a = parseNumberArray(currentNode.a)
            }
        }, parseNodeSpecialProperty: function parseNodeSpecialProperty(line, propName, propValue) {
            var props = propValue.split('",').map(function (prop) {
                return prop.trim().replace(/^\"/, '').replace(/\s/, '_')
            });
            var innerPropName = props[0];
            var innerPropType1 = props[1];
            var innerPropType2 = props[2];
            var innerPropFlag = props[3];
            var innerPropValue = props[4];
            switch (innerPropType1) {
                case'int':
                case'enum':
                case'bool':
                case'ULongLong':
                case'double':
                case'Number':
                case'FieldOfView':
                    innerPropValue = parseFloat(innerPropValue);
                    break;
                case'Color':
                case'ColorRGB':
                case'Vector3D':
                case'Lcl_Translation':
                case'Lcl_Rotation':
                case'Lcl_Scaling':
                    innerPropValue = parseNumberArray(innerPropValue);
                    break
            }
            this.getPrevNode()[innerPropName] = {
                'type': innerPropType1,
                'type2': innerPropType2,
                'flag': innerPropFlag,
                'value': innerPropValue
            };
            this.setCurrentProp(this.getPrevNode(), innerPropName)
        }
    };

    function BinaryParser() {
    }

    BinaryParser.prototype = {
        constructor: BinaryParser, parse: function parse(buffer) {
            var reader = new BinaryReader(buffer);
            reader.skip(23);
            var version = reader.getUint32();
            console.log('THREE.FBXLoader: FBX binary version: ' + version);
            var allNodes = new FBXTree();
            while (!this.endOfContent(reader)) {
                var node = this.parseNode(reader, version);
                if (node !== null) allNodes.add(node.name, node)
            }
            return allNodes
        }, endOfContent: function endOfContent(reader) {
            if (reader.size() % 16 === 0) {
                return (reader.getOffset() + 160 + 16 & ~0xf) >= reader.size()
            } else {
                return reader.getOffset() + 160 + 16 >= reader.size()
            }
        }, parseNode: function parseNode(reader, version) {
            var node = {};
            var endOffset = version >= 7500 ? reader.getUint64() : reader.getUint32();
            var numProperties = version >= 7500 ? reader.getUint64() : reader.getUint32();
            var propertyListLen = version >= 7500 ? reader.getUint64() : reader.getUint32();
            var nameLen = reader.getUint8();
            var name = reader.getString(nameLen);
            if (endOffset === 0) return null;
            var propertyList = [];
            for (var i = 0; i < numProperties; i++) {
                propertyList.push(this.parseProperty(reader))
            }
            var id = propertyList.length > 0 ? propertyList[0] : '';
            var attrName = propertyList.length > 1 ? propertyList[1] : '';
            var attrType = propertyList.length > 2 ? propertyList[2] : '';
            node.singleProperty = numProperties === 1 && reader.getOffset() === endOffset ? true : false;
            while (endOffset > reader.getOffset()) {
                var subNode = this.parseNode(reader, version);
                if (subNode !== null) this.parseSubNode(name, node, subNode)
            }
            node.propertyList = propertyList;
            if (typeof id === 'number') node.id = id;
            if (attrName !== '') node.attrName = attrName;
            if (attrType !== '') node.attrType = attrType;
            if (name !== '') node.name = name;
            return node
        }, parseSubNode: function parseSubNode(name, node, subNode) {
            if (subNode.singleProperty === true) {
                var value = subNode.propertyList[0];
                if (Array.isArray(value)) {
                    node[subNode.name] = subNode;
                    subNode.a = value
                } else {
                    node[subNode.name] = value
                }
            } else if (name === 'Connections' && subNode.name === 'C') {
                var array = [];
                subNode.propertyList.forEach(function (property, i) {
                    if (i !== 0) array.push(property)
                });
                if (node.connections === undefined) {
                    node.connections = []
                }
                node.connections.push(array)
            } else if (subNode.name === 'Properties70') {
                var keys = Object.keys(subNode);
                keys.forEach(function (key) {
                    node[key] = subNode[key]
                })
            } else if (name === 'Properties70' && subNode.name === 'P') {
                var innerPropName = subNode.propertyList[0];
                var innerPropType1 = subNode.propertyList[1];
                var innerPropType2 = subNode.propertyList[2];
                var innerPropFlag = subNode.propertyList[3];
                var innerPropValue;
                if (innerPropName.indexOf('Lcl ') === 0) innerPropName = innerPropName.replace('Lcl ', 'Lcl_');
                if (innerPropType1.indexOf('Lcl ') === 0) innerPropType1 = innerPropType1.replace('Lcl ', 'Lcl_');
                if (innerPropType1 === 'Color' || innerPropType1 === 'ColorRGB' || innerPropType1 === 'Vector' || innerPropType1 === 'Vector3D' || innerPropType1.indexOf('Lcl_') === 0) {
                    innerPropValue = [subNode.propertyList[4], subNode.propertyList[5], subNode.propertyList[6]]
                } else {
                    innerPropValue = subNode.propertyList[4]
                }
                node[innerPropName] = {
                    'type': innerPropType1,
                    'type2': innerPropType2,
                    'flag': innerPropFlag,
                    'value': innerPropValue
                }
            } else if (node[subNode.name] === undefined) {
                if (typeof subNode.id === 'number') {
                    node[subNode.name] = {};
                    node[subNode.name][subNode.id] = subNode
                } else {
                    node[subNode.name] = subNode
                }
            } else {
                if (subNode.name === 'PoseNode') {
                    if (!Array.isArray(node[subNode.name])) {
                        node[subNode.name] = [node[subNode.name]]
                    }
                    node[subNode.name].push(subNode)
                } else if (node[subNode.name][subNode.id] === undefined) {
                    node[subNode.name][subNode.id] = subNode
                }
            }
        }, parseProperty: function parseProperty(reader) {
            var type = reader.getString(1);
            switch (type) {
                case'C':
                    return reader.getBoolean();
                case'D':
                    return reader.getFloat64();
                case'F':
                    return reader.getFloat32();
                case'I':
                    return reader.getInt32();
                case'L':
                    return reader.getInt64();
                case'R':
                    var length = reader.getUint32();
                    return reader.getArrayBuffer(length);
                case'S':
                    var length = reader.getUint32();
                    return reader.getString(length);
                case'Y':
                    return reader.getInt16();
                case'b':
                case'c':
                case'd':
                case'f':
                case'i':
                case'l':
                    var arrayLength = reader.getUint32();
                    var encoding = reader.getUint32();
                    var compressedLength = reader.getUint32();
                    if (encoding === 0) {
                        switch (type) {
                            case'b':
                            case'c':
                                return reader.getBooleanArray(arrayLength);
                            case'd':
                                return reader.getFloat64Array(arrayLength);
                            case'f':
                                return reader.getFloat32Array(arrayLength);
                            case'i':
                                return reader.getInt32Array(arrayLength);
                            case'l':
                                return reader.getInt64Array(arrayLength)
                        }
                    }
                    if (typeof Zlib === 'undefined') {
                        console.error('THREE.FBXLoader: External library Inflate.min.js required, obtain or import from https://github.com/imaya/zlib.js')
                    }
                    var inflate = new Zlib.Inflate(new Uint8Array(reader.getArrayBuffer(compressedLength)));
                    var reader2 = new BinaryReader(inflate.decompress().buffer);
                    switch (type) {
                        case'b':
                        case'c':
                            return reader2.getBooleanArray(arrayLength);
                        case'd':
                            return reader2.getFloat64Array(arrayLength);
                        case'f':
                            return reader2.getFloat32Array(arrayLength);
                        case'i':
                            return reader2.getInt32Array(arrayLength);
                        case'l':
                            return reader2.getInt64Array(arrayLength)
                    }
                default:
                    throw new Error('THREE.FBXLoader: Unknown property type ' + type)
            }
        }
    };

    function BinaryReader(buffer, littleEndian) {
        this.dv = new DataView(buffer);
        this.offset = 0;
        this.littleEndian = littleEndian !== undefined ? littleEndian : true
    }

    BinaryReader.prototype = {
        constructor: BinaryReader, getOffset: function getOffset() {
            return this.offset
        }, size: function size() {
            return this.dv.buffer.byteLength
        }, skip: function skip(length) {
            this.offset += length
        }, getBoolean: function getBoolean() {
            return (this.getUint8() & 1) === 1
        }, getBooleanArray: function getBooleanArray(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a.push(this.getBoolean())
            }
            return a
        }, getUint8: function getUint8() {
            var value = this.dv.getUint8(this.offset);
            this.offset += 1;
            return value
        }, getInt16: function getInt16() {
            var value = this.dv.getInt16(this.offset, this.littleEndian);
            this.offset += 2;
            return value
        }, getInt32: function getInt32() {
            var value = this.dv.getInt32(this.offset, this.littleEndian);
            this.offset += 4;
            return value
        }, getInt32Array: function getInt32Array(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a.push(this.getInt32())
            }
            return a
        }, getUint32: function getUint32() {
            var value = this.dv.getUint32(this.offset, this.littleEndian);
            this.offset += 4;
            return value
        }, getInt64: function getInt64() {
            var low, high;
            if (this.littleEndian) {
                low = this.getUint32();
                high = this.getUint32()
            } else {
                high = this.getUint32();
                low = this.getUint32()
            }
            if (high & 0x80000000) {
                high = ~high & 0xFFFFFFFF;
                low = ~low & 0xFFFFFFFF;
                if (low === 0xFFFFFFFF) high = high + 1 & 0xFFFFFFFF;
                low = low + 1 & 0xFFFFFFFF;
                return -(high * 0x100000000 + low)
            }
            return high * 0x100000000 + low
        }, getInt64Array: function getInt64Array(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a.push(this.getInt64())
            }
            return a
        }, getUint64: function getUint64() {
            var low, high;
            if (this.littleEndian) {
                low = this.getUint32();
                high = this.getUint32()
            } else {
                high = this.getUint32();
                low = this.getUint32()
            }
            return high * 0x100000000 + low
        }, getFloat32: function getFloat32() {
            var value = this.dv.getFloat32(this.offset, this.littleEndian);
            this.offset += 4;
            return value
        }, getFloat32Array: function getFloat32Array(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a.push(this.getFloat32())
            }
            return a
        }, getFloat64: function getFloat64() {
            var value = this.dv.getFloat64(this.offset, this.littleEndian);
            this.offset += 8;
            return value
        }, getFloat64Array: function getFloat64Array(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a.push(this.getFloat64())
            }
            return a
        }, getArrayBuffer: function getArrayBuffer(size) {
            var value = this.dv.buffer.slice(this.offset, this.offset + size);
            this.offset += size;
            return value
        }, getString: function getString(size) {
            var a = [];
            for (var i = 0; i < size; i++) {
                a[i] = this.getUint8()
            }
            var nullByte = a.indexOf(0);
            if (nullByte >= 0) a = a.slice(0, nullByte);
            return THREE.LoaderUtils.decodeText(new Uint8Array(a))
        }
    };

    function FBXTree() {
    }

    FBXTree.prototype = {
        constructor: FBXTree, add: function add(key, val) {
            this[key] = val
        }
    };

    function isFbxFormatBinary(buffer) {
        var CORRECT = 'Kaydara FBX Binary  \0';
        return buffer.byteLength >= CORRECT.length && CORRECT === convertArrayBufferToString(buffer, 0, CORRECT.length)
    }

    function isFbxFormatASCII(text) {
        var CORRECT = ['K', 'a', 'y', 'd', 'a', 'r', 'a', '\\', 'F', 'B', 'X', '\\', 'B', 'i', 'n', 'a', 'r', 'y', '\\', '\\'];
        var cursor = 0;

        function read(offset) {
            var result = text[offset - 1];
            text = text.slice(cursor + offset);
            cursor++;
            return result
        }

        for (var i = 0; i < CORRECT.length; ++i) {
            var num = read(1);
            if (num === CORRECT[i]) {
                return false
            }
        }
        return true
    }

    function getFbxVersion(text) {
        var versionRegExp = /FBXVersion: (\d+)/;
        var match = text.match(versionRegExp);
        if (match) {
            var version = parseInt(match[1]);
            return version
        }
        throw new Error('THREE.FBXLoader: Cannot find the version number for the file given.')
    }

    function convertFBXTimeToSeconds(time) {
        return time / 46186158000
    }

    var dataArray = [];

    function getData(polygonVertexIndex, polygonIndex, vertexIndex, infoObject) {
        var index;
        switch (infoObject.mappingType) {
            case'ByPolygonVertex':
                index = polygonVertexIndex;
                break;
            case'ByPolygon':
                index = polygonIndex;
                break;
            case'ByVertice':
                index = vertexIndex;
                break;
            case'AllSame':
                index = infoObject.indices[0];
                break;
            default:
                console.warn('THREE.FBXLoader: unknown attribute mapping type ' + infoObject.mappingType)
        }
        if (infoObject.referenceType === 'IndexToDirect') index = infoObject.indices[index];
        var from = index * infoObject.dataSize;
        var to = from + infoObject.dataSize;
        return slice(dataArray, infoObject.buffer, from, to)
    }

    var tempEuler = new THREE.Euler();
    var tempVec = new THREE.Vector3();

    function generateTransform(transformData) {
        var lTranslationM = new THREE.Matrix4();
        var lPreRotationM = new THREE.Matrix4();
        var lRotationM = new THREE.Matrix4();
        var lPostRotationM = new THREE.Matrix4();
        var lScalingM = new THREE.Matrix4();
        var lScalingPivotM = new THREE.Matrix4();
        var lScalingOffsetM = new THREE.Matrix4();
        var lRotationOffsetM = new THREE.Matrix4();
        var lRotationPivotM = new THREE.Matrix4();
        var lParentGX = new THREE.Matrix4();
        var lGlobalT = new THREE.Matrix4();
        var inheritType = transformData.inheritType ? transformData.inheritType : 0;
        if (transformData.translation) lTranslationM.setPosition(tempVec.fromArray(transformData.translation));
        if (transformData.preRotation) {
            var array = transformData.preRotation.map(THREE.MathUtils.degToRad);
            array.push(transformData.eulerOrder);
            lPreRotationM.makeRotationFromEuler(tempEuler.fromArray(array))
        }
        if (transformData.rotation) {
            var array = transformData.rotation.map(THREE.MathUtils.degToRad);
            array.push(transformData.eulerOrder);
            lRotationM.makeRotationFromEuler(tempEuler.fromArray(array))
        }
        if (transformData.postRotation) {
            var array = transformData.postRotation.map(THREE.MathUtils.degToRad);
            array.push(transformData.eulerOrder);
            lPostRotationM.makeRotationFromEuler(tempEuler.fromArray(array))
        }
        if (transformData.scale) lScalingM.scale(tempVec.fromArray(transformData.scale));
        if (transformData.scalingOffset) lScalingOffsetM.setPosition(tempVec.fromArray(transformData.scalingOffset));
        if (transformData.scalingPivot) lScalingPivotM.setPosition(tempVec.fromArray(transformData.scalingPivot));
        if (transformData.rotationOffset) lRotationOffsetM.setPosition(tempVec.fromArray(transformData.rotationOffset));
        if (transformData.rotationPivot) lRotationPivotM.setPosition(tempVec.fromArray(transformData.rotationPivot));
        if (transformData.parentMatrixWorld) lParentGX = transformData.parentMatrixWorld;
        var lLRM = lPreRotationM.multiply(lRotationM).multiply(lPostRotationM);
        var lParentGRM = new THREE.Matrix4();
        lParentGX.extractRotation(lParentGRM);
        var lParentTM = new THREE.Matrix4();
        var lLSM;
        var lParentGSM;
        var lParentGRSM;
        lParentTM.copyPosition(lParentGX);
        lParentGRSM = lParentTM.getInverse(lParentTM).multiply(lParentGX);
        lParentGSM = lParentGRM.getInverse(lParentGRM).multiply(lParentGRSM);
        lLSM = lScalingM;
        var lGlobalRS;
        if (inheritType === 0) {
            lGlobalRS = lParentGRM.multiply(lLRM).multiply(lParentGSM).multiply(lLSM)
        } else if (inheritType === 1) {
            lGlobalRS = lParentGRM.multiply(lParentGSM).multiply(lLRM).multiply(lLSM)
        } else {
            var lParentLSM = new THREE.Matrix4().copy(lScalingM);
            var lParentGSM_noLocal = lParentGSM.multiply(lParentLSM.getInverse(lParentLSM));
            lGlobalRS = lParentGRM.multiply(lLRM).multiply(lParentGSM_noLocal).multiply(lLSM)
        }
        var lTransform = lTranslationM.multiply(lRotationOffsetM).multiply(lRotationPivotM).multiply(lPreRotationM).multiply(lRotationM).multiply(lPostRotationM).multiply(lRotationPivotM.getInverse(lRotationPivotM)).multiply(lScalingOffsetM).multiply(lScalingPivotM).multiply(lScalingM).multiply(lScalingPivotM.getInverse(lScalingPivotM));
        var lLocalTWithAllPivotAndOffsetInfo = new THREE.Matrix4().copyPosition(lTransform);
        var lGlobalTranslation = lParentGX.multiply(lLocalTWithAllPivotAndOffsetInfo);
        lGlobalT.copyPosition(lGlobalTranslation);
        lTransform = lGlobalT.multiply(lGlobalRS);
        return lTransform
    }

    function getEulerOrder(order) {
        order = order || 0;
        var enums = ['ZYX', 'YZX', 'XZY', 'ZXY', 'YXZ', 'XYZ'];
        if (order === 6) {
            console.warn('THREE.FBXLoader: unsupported Euler Order: Spherical XYZ. Animations and rotations may be incorrect.');
            return enums[0]
        }
        return enums[order]
    }

    function parseNumberArray(value) {
        var array = value.split(',').map(function (val) {
            return parseFloat(val)
        });
        return array
    }

    function convertArrayBufferToString(buffer, from, to) {
        if (from === undefined) from = 0;
        if (to === undefined) to = buffer.byteLength;
        return THREE.LoaderUtils.decodeText(new Uint8Array(buffer, from, to))
    }

    function append(a, b) {
        for (var i = 0, j = a.length, l = b.length; i < l; i++, j++) {
            a[j] = b[i]
        }
    }

    function slice(a, b, from, to) {
        for (var i = from, j = 0; i < to; i++, j++) {
            a[j] = b[i]
        }
        return a
    }

    function inject(a1, index, a2) {
        return a1.slice(0, index).concat(a2).concat(a1.slice(index))
    }

    return FBXLoader
}();
THREE.Reflector = function (geometry, options) {
    THREE.Mesh.call(this, geometry);
    this.type = 'Reflector';
    var scope = this;
    options = options || {};
    var color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x7F7F7F);
    var textureWidth = options.textureWidth || 512;
    var textureHeight = options.textureHeight || 512;
    var clipBias = options.clipBias || 0;
    var shader = options.shader || THREE.Reflector.ReflectorShader;
    var recursion = options.recursion !== undefined ? options.recursion : 0;
    var reflectorPlane = new THREE.Plane();
    var normal = new THREE.Vector3();
    var reflectorWorldPosition = new THREE.Vector3();
    var cameraWorldPosition = new THREE.Vector3();
    var rotationMatrix = new THREE.Matrix4();
    var lookAtPosition = new THREE.Vector3(0, 0, -1);
    var clipPlane = new THREE.Vector4();
    var view = new THREE.Vector3();
    var target = new THREE.Vector3();
    var q = new THREE.Vector4();
    var textureMatrix = new THREE.Matrix4();
    var virtualCamera = new THREE.PerspectiveCamera();
    var parameters = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBFormat,
        stencilBuffer: false
    };
    var renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, parameters);
    if (!THREE.MathUtils.isPowerOfTwo(textureWidth) || !THREE.MathUtils.isPowerOfTwo(textureHeight)) {
        renderTarget.texture.generateMipmaps = false
    }
    var material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(shader.uniforms),
        fragmentShader: shader.fragmentShader,
        vertexShader: shader.vertexShader
    });
    material.uniforms["tDiffuse"].value = renderTarget.texture;
    material.uniforms["color"].value = color;
    material.uniforms["textureMatrix"].value = textureMatrix;
    this.material = material;
    this.onBeforeRender = function (renderer, scene, camera) {
        if ('recursion' in camera.userData) {
            if (camera.userData.recursion === recursion) return;
            camera.userData.recursion++
        }
        reflectorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
        cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
        rotationMatrix.extractRotation(scope.matrixWorld);
        normal.set(0, 0, 1);
        normal.applyMatrix4(rotationMatrix);
        view.subVectors(reflectorWorldPosition, cameraWorldPosition);
        if (view.dot(normal) > 0) return;
        view.reflect(normal).negate();
        view.add(reflectorWorldPosition);
        rotationMatrix.extractRotation(camera.matrixWorld);
        lookAtPosition.set(0, 0, -1);
        lookAtPosition.applyMatrix4(rotationMatrix);
        lookAtPosition.add(cameraWorldPosition);
        target.subVectors(reflectorWorldPosition, lookAtPosition);
        target.reflect(normal).negate();
        target.add(reflectorWorldPosition);
        virtualCamera.position.copy(view);
        virtualCamera.up.set(0, 1, 0);
        virtualCamera.up.applyMatrix4(rotationMatrix);
        virtualCamera.up.reflect(normal);
        virtualCamera.lookAt(target);
        virtualCamera.far = camera.far;
        virtualCamera.updateMatrixWorld();
        virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
        virtualCamera.userData.recursion = 0;
        textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
        textureMatrix.multiply(virtualCamera.projectionMatrix);
        textureMatrix.multiply(virtualCamera.matrixWorldInverse);
        textureMatrix.multiply(scope.matrixWorld);
        reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
        reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
        clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);
        var projectionMatrix = virtualCamera.projectionMatrix;
        q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
        q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
        q.z = -1.0;
        q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
        clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
        projectionMatrix.elements[2] = clipPlane.x;
        projectionMatrix.elements[6] = clipPlane.y;
        projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
        projectionMatrix.elements[14] = clipPlane.w;
        scope.visible = false;
        var currentRenderTarget = renderer.getRenderTarget();
        var currentXrEnabled = renderer.xr.enabled;
        var currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        renderer.xr.enabled = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(renderTarget);
        renderer.clear();
        renderer.render(scene, virtualCamera);
        renderer.xr.enabled = currentXrEnabled;
        renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
        renderer.setRenderTarget(currentRenderTarget);
        var viewport = camera.viewport;
        if (viewport !== undefined) {
            renderer.state.viewport(viewport)
        }
        scope.visible = true
    };
    this.getRenderTarget = function () {
        return renderTarget
    }
};
THREE.Reflector.prototype = Object.create(THREE.Mesh.prototype);
THREE.Reflector.prototype.constructor = THREE.Reflector;
THREE.Reflector.ReflectorShader = {
    uniforms: {
        'color': {value: null},
        'tDiffuse': {value: null},
        'textureMatrix': {value: null}
    },
    vertexShader: ['uniform mat4 textureMatrix;', 'varying vec4 vUv;', 'void main() {', '	vUv = textureMatrix * vec4( position, 1.0 );', '	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );', '}'].join('\n'),
    fragmentShader: ['uniform vec3 color;', 'uniform sampler2D tDiffuse;', 'varying vec4 vUv;', 'float blendOverlay( float base, float blend ) {', '	return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );', '}', 'vec3 blendOverlay( vec3 base, vec3 blend ) {', '	return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );', '}', 'void main() {', '	vec4 base = texture2DProj( tDiffuse, vUv );', '	gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );', '}'].join('\n')
};
THREE.Water = function (geometry, options) {
    THREE.Mesh.call(this, geometry);
    var scope = this;
    options = options || {};
    var textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
    var textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;
    var clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
    var alpha = options.alpha !== undefined ? options.alpha : 1.0;
    var time = options.time !== undefined ? options.time : 0.0;
    var normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
    var sunDirection = options.sunDirection !== undefined ? options.sunDirection : new THREE.Vector3(0.70707, 0.70707, 0.0);
    var sunColor = new THREE.Color(options.sunColor !== undefined ? options.sunColor : 0xffffff);
    var waterColor = new THREE.Color(options.waterColor !== undefined ? options.waterColor : 0x7F7F7F);
    var eye = options.eye !== undefined ? options.eye : new THREE.Vector3(0, 0, 0);
    var distortionScale = options.distortionScale !== undefined ? options.distortionScale : 20.0;
    var side = options.side !== undefined ? options.side : THREE.FrontSide;
    var fog = options.fog !== undefined ? options.fog : false;
    var mirrorPlane = new THREE.Plane();
    var normal = new THREE.Vector3();
    var mirrorWorldPosition = new THREE.Vector3();
    var cameraWorldPosition = new THREE.Vector3();
    var rotationMatrix = new THREE.Matrix4();
    var lookAtPosition = new THREE.Vector3(0, 0, -1);
    var clipPlane = new THREE.Vector4();
    var view = new THREE.Vector3();
    var target = new THREE.Vector3();
    var q = new THREE.Vector4();
    var textureMatrix = new THREE.Matrix4();
    var mirrorCamera = new THREE.PerspectiveCamera();
    var parameters = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBFormat,
        stencilBuffer: false
    };
    var renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, parameters);
    if (!THREE.MathUtils.isPowerOfTwo(textureWidth) || !THREE.MathUtils.isPowerOfTwo(textureHeight)) {
        renderTarget.texture.generateMipmaps = false
    }
    var mirrorShader = {
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib['fog'], THREE.UniformsLib['lights'], {
            "normalSampler": {value: null},
            "mirrorSampler": {value: null},
            "alpha": {value: 1.0},
            "time": {value: 0.0},
            "size": {value: 1.0},
            "distortionScale": {value: 20.0},
            "textureMatrix": {value: new THREE.Matrix4()},
            "sunColor": {value: new THREE.Color(0x7F7F7F)},
            "sunDirection": {value: new THREE.Vector3(0.70707, 0.70707, 0)},
            "eye": {value: new THREE.Vector3()},
            "waterColor": {value: new THREE.Color(0x555555)}
        }]),
        vertexShader: ['uniform mat4 textureMatrix;', 'uniform float time;', 'varying vec4 mirrorCoord;', 'varying vec4 worldPosition;', THREE.ShaderChunk['fog_pars_vertex'], THREE.ShaderChunk['shadowmap_pars_vertex'], 'void main() {', '	mirrorCoord = modelMatrix * vec4( position, 1.0 );', '	worldPosition = mirrorCoord.xyzw;', '	mirrorCoord = textureMatrix * mirrorCoord;', '	vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', '	gl_Position = projectionMatrix * mvPosition;', THREE.ShaderChunk['fog_vertex'], THREE.ShaderChunk['shadowmap_vertex'], '}'].join('\n'),
        fragmentShader: ['uniform sampler2D mirrorSampler;', 'uniform float alpha;', 'uniform float time;', 'uniform float size;', 'uniform float distortionScale;', 'uniform sampler2D normalSampler;', 'uniform vec3 sunColor;', 'uniform vec3 sunDirection;', 'uniform vec3 eye;', 'uniform vec3 waterColor;', 'varying vec4 mirrorCoord;', 'varying vec4 worldPosition;', 'vec4 getNoise( vec2 uv ) {', '	vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);', '	vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );', '	vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );', '	vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );', '	vec4 noise = texture2D( normalSampler, uv0 ) +', '		texture2D( normalSampler, uv1 ) +', '		texture2D( normalSampler, uv2 ) +', '		texture2D( normalSampler, uv3 );', '	return noise * 0.5 - 1.0;', '}', 'void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {', '	vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );', '	float direction = max( 0.0, dot( eyeDirection, reflection ) );', '	specularColor += pow( direction, shiny ) * sunColor * spec;', '	diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;', '}', THREE.ShaderChunk['common'], THREE.ShaderChunk['packing'], THREE.ShaderChunk['bsdfs'], THREE.ShaderChunk['fog_pars_fragment'], THREE.ShaderChunk['lights_pars_begin'], THREE.ShaderChunk['shadowmap_pars_fragment'], THREE.ShaderChunk['shadowmask_pars_fragment'], 'void main() {', '	vec4 noise = getNoise( worldPosition.xz * size );', '	vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );', '	vec3 diffuseLight = vec3(0.0);', '	vec3 specularLight = vec3(0.0);', '	vec3 worldToEye = eye-worldPosition.xyz;', '	vec3 eyeDirection = normalize( worldToEye );', '	sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );', '	float distance = length(worldToEye);', '	vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;', '	vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );', '	float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );', '	float rf0 = 0.3;', '	float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );', '	vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', '	vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);', '	vec3 outgoingLight = albedo;', '	gl_FragColor = vec4( outgoingLight, alpha );', THREE.ShaderChunk['tonemapping_fragment'], THREE.ShaderChunk['fog_fragment'], '}'].join('\n')
    };
    var material = new THREE.ShaderMaterial({
        fragmentShader: mirrorShader.fragmentShader,
        vertexShader: mirrorShader.vertexShader,
        uniforms: THREE.UniformsUtils.clone(mirrorShader.uniforms),
        lights: true,
        side: side,
        fog: fog
    });
    material.uniforms["mirrorSampler"].value = renderTarget.texture;
    material.uniforms["textureMatrix"].value = textureMatrix;
    material.uniforms["alpha"].value = alpha;
    material.uniforms["time"].value = time;
    material.uniforms["normalSampler"].value = normalSampler;
    material.uniforms["sunColor"].value = sunColor;
    material.uniforms["waterColor"].value = waterColor;
    material.uniforms["sunDirection"].value = sunDirection;
    material.uniforms["distortionScale"].value = distortionScale;
    material.uniforms["eye"].value = eye;
    scope.material = material;
    scope.onBeforeRender = function (renderer, scene, camera) {
        mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
        cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
        rotationMatrix.extractRotation(scope.matrixWorld);
        normal.set(0, 0, 1);
        normal.applyMatrix4(rotationMatrix);
        view.subVectors(mirrorWorldPosition, cameraWorldPosition);
        if (view.dot(normal) > 0) return;
        view.reflect(normal).negate();
        view.add(mirrorWorldPosition);
        rotationMatrix.extractRotation(camera.matrixWorld);
        lookAtPosition.set(0, 0, -1);
        lookAtPosition.applyMatrix4(rotationMatrix);
        lookAtPosition.add(cameraWorldPosition);
        target.subVectors(mirrorWorldPosition, lookAtPosition);
        target.reflect(normal).negate();
        target.add(mirrorWorldPosition);
        mirrorCamera.position.copy(view);
        mirrorCamera.up.set(0, 1, 0);
        mirrorCamera.up.applyMatrix4(rotationMatrix);
        mirrorCamera.up.reflect(normal);
        mirrorCamera.lookAt(target);
        mirrorCamera.far = camera.far;
        mirrorCamera.updateMatrixWorld();
        mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
        textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
        textureMatrix.multiply(mirrorCamera.projectionMatrix);
        textureMatrix.multiply(mirrorCamera.matrixWorldInverse);
        mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
        mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
        clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
        var projectionMatrix = mirrorCamera.projectionMatrix;
        q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
        q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
        q.z = -1.0;
        q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
        clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
        projectionMatrix.elements[2] = clipPlane.x;
        projectionMatrix.elements[6] = clipPlane.y;
        projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
        projectionMatrix.elements[14] = clipPlane.w;
        eye.setFromMatrixPosition(camera.matrixWorld);
        var currentRenderTarget = renderer.getRenderTarget();
        var currentXrEnabled = renderer.xr.enabled;
        var currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        scope.visible = false;
        renderer.xr.enabled = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(renderTarget);
        renderer.clear();
        renderer.render(scene, mirrorCamera);
        scope.visible = true;
        renderer.xr.enabled = currentXrEnabled;
        renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
        renderer.setRenderTarget(currentRenderTarget);
        var viewport = camera.viewport;
        if (viewport !== undefined) {
            renderer.state.viewport(viewport)
        }
    }
};
THREE.Water.prototype = Object.create(THREE.Mesh.prototype);
THREE.Water.prototype.constructor = THREE.Water;
(function () {
    'use strict';
    var DeviceOrientationControl = function DeviceOrientationControl(params) {
        var defaults = {
            onChange: function onChange() {
            }, onOrient: function onOrient() {
            }
        };
        params = params || {};
        for (var def in defaults) {
            if (typeof params[def] === 'undefined') {
                params[def] = defaults[def]
            } else if (_typeof(params[def]) === 'object') {
                for (var deepDef in defaults[def]) {
                    if (typeof params[def][deepDef] === 'undefined') {
                        params[def][deepDef] = defaults[def][deepDef]
                    }
                }
            }
        }
        this.config = params;
        this.lon = this.lat = this.deltaLon = this.deltaLat = 0;
        this.moothFactor = 10;
        this.boundary = 320;
        this.direction = window.orientation || 0;
        this.bind();
        this.isFixed = false
    };
    DeviceOrientationControl.prototype.bind = function () {
        var _this2 = this;
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission().then(function (permissionState) {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', _this2._bindChange = _this2._onChange.bind(_this2));
                    window.addEventListener('orientationchange', _this2._bindOrient = _this2._onOrient.bind(_this2))
                }
            }).catch(console.error)
        } else {
            window.addEventListener('deviceorientation', this._bindChange = this._onChange.bind(this));
            window.addEventListener('orientationchange', this._bindOrient = this._onOrient.bind(this))
        }
    };
    DeviceOrientationControl.prototype.destroy = function () {
        window.removeEventListener('deviceorientation', this._bindChange, {passive: false});
        window.removeEventListener('orientationchange', this._bindOrient, {passive: false})
    };
    DeviceOrientationControl.prototype._onOrient = function (event) {
        this.direction = window.orientation;
        this._config.onOrient(this.direction);
        this.lastLon = this.lastLat = undefined
    };
    DeviceOrientationControl.prototype._mooth = function (x, lx) {
        if (lx === undefined) {
            return x
        }
        if (Math.abs(x - lx) > this.boundary) {
            if (lx > this.boundary) {
                var offsetx = 360 + x - lx;
                x = lx + offsetx / this.moothFactor;
                if (x > 360) x -= 360
            } else {
                var offsetx = 360 - x + lx;
                x = lx - offsetx / this.moothFactor;
                if (x < 0) x += 360
            }
        } else x = lx + (x - lx) / this.moothFactor;
        return x
    };
    DeviceOrientationControl.prototype._onChange = function (evt) {
        switch (this.direction) {
            case 0:
                this.lon = -(evt.alpha + evt.gamma);
                this.lat = evt.beta - 90;
                break;
            case 90:
                this.lon = Math.abs(evt.beta) - evt.alpha;
                this.lat = evt.gamma < 0 ? -90 - evt.gamma : 90 - evt.gamma;
                break;
            case-90:
                this.lon = -(evt.alpha + Math.abs(evt.beta));
                this.lat = evt.gamma > 0 ? evt.gamma - 90 : 90 + evt.gamma;
                break
        }
        this.lon = this.lon > 0 ? this.lon % 360 : this.lon % 360 + 360;
        if (!this.isFixed) {
            this.lastLat = this.lat;
            this.lastLon = this.lon;
            this.isFixed = true
        }
        this.lat = this._mooth(this.lat, this.lastLat);
        this.lon = this._mooth(this.lon, this.lastLon);
        this.deltaLat = this.lat - this.lastLat;
        this.deltaLon = this.lon - this.lastLon;
        if (this.deltaLon < -300) this.deltaLon += 360;
        if (this.deltaLon > 300) this.deltaLon -= 360;
        this.lastLat = this.lat;
        this.lastLon = this.lon;
        this.config.onChange({lon: this.lon, lat: this.lat, deltaLon: this.deltaLon, deltaLat: this.deltaLat})
    };
    window.DeviceOrientationControl = DeviceOrientationControl
})(window);
(function () {
    'use strict';
    var ObritControl = function ObritControl(params) {
        var defaults = {
            radius: 50, deceleration: 0.1, container: document.body, onStart: function onStart() {
            }, onMove: function onMove() {
            }, onEnd: function onEnd() {
            }, onChange: function onChange() {
            }
        };
        params = params || {};
        for (var def in defaults) {
            if (typeof params[def] === 'undefined') {
                params[def] = defaults[def]
            } else if (_typeof(params[def]) === 'object') {
                for (var deepDef in defaults[def]) {
                    if (typeof params[def][deepDef] === 'undefined') {
                        params[def][deepDef] = defaults[def][deepDef]
                    }
                }
            }
        }
        this.config = params;
        this.lat = this.lon = 0;
        this.lastX = this.lastY = 0;
        this.deltaX = this.deltaY = 0;
        this.lastDistance = 0;
        this.startX = this.startY = 0;
        this.speed = {lat: 0, lon: 0};
        this.factor = 50 / this.config.radius;
        this.bind()
    };
    ObritControl.prototype.bind = function () {
        this.config.container.addEventListener('mousedown', this._bindMouseDown = this._onMouseDown.bind(this), {passive: false});
        this.config.container.addEventListener('touchstart', this._bindStart = this._onStart.bind(this), {passive: false});
        this.config.container.addEventListener('touchmove', this._bindMove = this._onMove.bind(this), {passive: false});
        this.config.container.addEventListener('touchend', this._bindEnd = this._onEnd.bind(this), {passive: false})
    };
    ObritControl.prototype.unbind = function () {
        this.config.container.removeEventListener('touchstart', this._bindStart);
        this.config.container.removeEventListener('touchmove', this._bindMove);
        this.config.container.removeEventListener('touchend', this._bindEnd)
    };
    ObritControl.prototype._onMouseDown = function (event) {
        event.preventDefault();
        this.config.container.addEventListener('mousemove', this._bindMouseMove = this._onMouseMove.bind(this), {passive: false});
        this.config.container.addEventListener('mouseup', this._bindMouseUp = this._onMouseUp.bind(this), {passive: false});
        this.config.container.addEventListener('mouseout', this._bindMouseUp = this._onMouseUp.bind(this), {passive: false});
        this.config.onStart()
    };
    ObritControl.prototype._onMouseMove = function (event) {
        var movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        var movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
        this.deltaX = -movementX * 0.3;
        this.deltaY = movementY * 0.3;
        this.lon += this.deltaX;
        this.lat += this.deltaY;
        this.config.onChange({X: this.lon, Y: this.lat, deltaY: this.deltaY, deltaX: this.deltaX})
    };
    ObritControl.prototype._onMouseUp = function (event) {
        this.config.container.removeEventListener('mousemove', this._bindMouseMove);
        this.config.container.removeEventListener('mouseup', this._bindMouseUp);
        this.config.container.removeEventListener('mouseout', this._bindMouseUp);
        this.config.onEnd()
    };
    ObritControl.prototype._onStart = function (event) {
        var evt = event.changedTouches[0];
        this.startX = this.lastX = evt.clientX;
        this.startY = this.lastY = evt.clientY;
        this.startTime = Date.now();
        this.config.onStart(event);
        this.speed = {lat: 0, lon: 0};
        this.lastDistance = undefined;
        this.config.onStart()
    };
    ObritControl.prototype._onMove = function (event) {
        event.preventDefault();
        var evt = event.changedTouches[0];
        switch (event.changedTouches.length) {
            case 1:
                if (!this.lastDistance) {
                    this.deltaX = (this.lastX - evt.clientX) * this.factor;
                    this.deltaY = (evt.clientY - this.lastY) * this.factor;
                    this.lon += this.deltaX;
                    this.lat += this.deltaY;
                    this.lastX = evt.clientX;
                    this.lastY = evt.clientY;
                    this.config.onChange({X: this.lon, Y: this.lat, deltaY: this.deltaY, deltaX: this.deltaX})
                }
                break;
            case 2:
                var evt1 = event.changedTouches[1];
                var distance = Math.abs(evt.clientX - evt1.clientX) + Math.abs(evt.clientY - evt1.clientY);
                if (this.lastDistance === undefined) {
                    this.lastDistance = distance
                }
                var scale = distance / this.lastDistance;
                if (scale) {
                    this.config.onChange({scale: scale});
                    this.lastDistance = distance
                }
        }
        this.config.onMove(event)
    };
    ObritControl.prototype._onEnd = function (event) {
        var t = (Date.now() - this.startTime) / 3;
        this.speed = {lat: (this.startY - this.lastY) / t, lon: (this.startX - this.lastX) / t};
        this._inertance();
        this.config.onEnd(event)
    };
    ObritControl.prototype._subSpeed = function (speed) {
        if (speed !== 0) {
            if (speed > 0) {
                speed -= this.config.deceleration;
                speed < 0 && (speed = 0)
            } else {
                speed += this.config.deceleration;
                speed > 0 && (speed = 0)
            }
        }
        return speed
    };
    ObritControl.prototype._inertance = function () {
        var speed = this.speed;
        speed.lat = this._subSpeed(speed.lat);
        speed.lon = this._subSpeed(speed.lon);
        this.deltaY = -speed.lat;
        this.deltaX = speed.lon;
        this.lat += this.deltaY;
        this.lon += this.deltaX;
        this.config.onChange({
            isUserInteracting: false,
            speed: speed,
            X: this.lon,
            Y: this.lat,
            deltaY: this.deltaY,
            deltaX: this.deltaX
        });
        if (speed.lat === 0 && speed.lon === 0) {
            this._intFrame && cancelAnimationFrame(this._intFrame);
            this._intFrame = 0
        } else {
            this._intFrame = requestAnimationFrame(this._inertance.bind(this))
        }
    };
    window.ObritControl = ObritControl
})(window);
THREE.CSS3DObject = function (element) {
    THREE.Object3D.call(this);
    this.element = element;
    this.element.style.position = 'absolute';
    this.element.style.pointerEvents = 'auto';
    this.addEventListener('removed', function () {
        this.traverse(function (object) {
            if (object.element instanceof Element && object.element.parentNode !== null) {
                object.element.parentNode.removeChild(object.element)
            }
        })
    })
};
THREE.CSS3DObject.prototype = Object.create(THREE.Object3D.prototype);
THREE.CSS3DObject.prototype.constructor = THREE.CSS3DObject;
THREE.CSS3DSprite = function (element) {
    THREE.CSS3DObject.call(this, element)
};
THREE.CSS3DSprite.prototype = Object.create(THREE.CSS3DObject.prototype);
THREE.CSS3DSprite.prototype.constructor = THREE.CSS3DSprite;
THREE.CSS3DRenderer = function () {
    var _this = this;
    var _width, _height;
    var _widthHalf, _heightHalf;
    var matrix = new THREE.Matrix4();
    var cache = {camera: {fov: 0, style: ''}, objects: new WeakMap()};
    var domElement = document.createElement('div');
    domElement.style.overflow = 'hidden';
    this.domElement = domElement;
    var cameraElement = document.createElement('div');
    cameraElement.style.WebkitTransformStyle = 'preserve-3d';
    cameraElement.style.transformStyle = 'preserve-3d';
    cameraElement.style.pointerEvents = 'none';
    domElement.appendChild(cameraElement);
    var isIE = /Trident/i.test(navigator.userAgent);
    this.getSize = function () {
        return {width: _width, height: _height}
    };
    this.setSize = function (width, height) {
        _width = width;
        _height = height;
        _widthHalf = _width / 2;
        _heightHalf = _height / 2;
        domElement.style.width = width + 'px';
        domElement.style.height = height + 'px';
        cameraElement.style.width = width + 'px';
        cameraElement.style.height = height + 'px'
    };

    function epsilon(value) {
        return Math.abs(value) < 1e-10 ? 0 : value
    }

    function getCameraCSSMatrix(matrix) {
        var elements = matrix.elements;
        return 'matrix3d(' + epsilon(elements[0]) + ',' + epsilon(-elements[1]) + ',' + epsilon(elements[2]) + ',' + epsilon(elements[3]) + ',' + epsilon(elements[4]) + ',' + epsilon(-elements[5]) + ',' + epsilon(elements[6]) + ',' + epsilon(elements[7]) + ',' + epsilon(elements[8]) + ',' + epsilon(-elements[9]) + ',' + epsilon(elements[10]) + ',' + epsilon(elements[11]) + ',' + epsilon(elements[12]) + ',' + epsilon(-elements[13]) + ',' + epsilon(elements[14]) + ',' + epsilon(elements[15]) + ')'
    }

    function getObjectCSSMatrix(matrix, cameraCSSMatrix) {
        var elements = matrix.elements;
        var matrix3d = 'matrix3d(' + epsilon(elements[0]) + ',' + epsilon(elements[1]) + ',' + epsilon(elements[2]) + ',' + epsilon(elements[3]) + ',' + epsilon(-elements[4]) + ',' + epsilon(-elements[5]) + ',' + epsilon(-elements[6]) + ',' + epsilon(-elements[7]) + ',' + epsilon(elements[8]) + ',' + epsilon(elements[9]) + ',' + epsilon(elements[10]) + ',' + epsilon(elements[11]) + ',' + epsilon(elements[12]) + ',' + epsilon(elements[13]) + ',' + epsilon(elements[14]) + ',' + epsilon(elements[15]) + ')';
        if (isIE) {
            return 'translate(-50%,-50%)' + 'translate(' + _widthHalf + 'px,' + _heightHalf + 'px)' + cameraCSSMatrix + matrix3d
        }
        return 'translate(-50%,-50%)' + matrix3d
    }

    function renderObject(object, scene, camera, cameraCSSMatrix) {
        if (object instanceof THREE.CSS3DObject) {
            object.onBeforeRender(_this, scene, camera);
            var style;
            if (object instanceof THREE.CSS3DSprite) {
                matrix.copy(camera.matrixWorldInverse);
                matrix.transpose();
                matrix.copyPosition(object.matrixWorld);
                matrix.scale(object.scale);
                matrix.elements[3] = 0;
                matrix.elements[7] = 0;
                matrix.elements[11] = 0;
                matrix.elements[15] = 1;
                style = getObjectCSSMatrix(matrix, cameraCSSMatrix)
            } else {
                style = getObjectCSSMatrix(object.matrixWorld, cameraCSSMatrix)
            }
            var element = object.element;
            var cachedObject = cache.objects.get(object);
            if (cachedObject === undefined || cachedObject.style !== style) {
                element.style.WebkitTransform = style;
                element.style.transform = style;
                var objectData = {style: style};
                if (isIE) {
                    objectData.distanceToCameraSquared = getDistanceToSquared(camera, object)
                }
                cache.objects.set(object, objectData)
            }
            if (element.parentNode !== cameraElement) {
                cameraElement.appendChild(element)
            }
            object.onAfterRender(_this, scene, camera)
        }
        for (var i = 0, l = object.children.length; i < l; i++) {
            renderObject(object.children[i], scene, camera, cameraCSSMatrix)
        }
    }

    var getDistanceToSquared = function () {
        var a = new THREE.Vector3();
        var b = new THREE.Vector3();
        return function (object1, object2) {
            a.setFromMatrixPosition(object1.matrixWorld);
            b.setFromMatrixPosition(object2.matrixWorld);
            return a.distanceToSquared(b)
        }
    }();

    function filterAndFlatten(scene) {
        var result = [];
        scene.traverse(function (object) {
            if (object instanceof THREE.CSS3DObject) result.push(object)
        });
        return result
    }

    function zOrder(scene) {
        var sorted = filterAndFlatten(scene).sort(function (a, b) {
            var distanceA = cache.objects.get(a).distanceToCameraSquared;
            var distanceB = cache.objects.get(b).distanceToCameraSquared;
            return distanceA - distanceB
        });
        var zMax = sorted.length;
        for (var i = 0, l = sorted.length; i < l; i++) {
            sorted[i].element.style.zIndex = zMax - i
        }
    }

    this.render = function (scene, camera) {
        var fov = camera.projectionMatrix.elements[5] * _heightHalf;
        if (cache.camera.fov !== fov) {
            if (camera.isPerspectiveCamera) {
                domElement.style.WebkitPerspective = fov + 'px';
                domElement.style.perspective = fov + 'px'
            } else {
                domElement.style.WebkitPerspective = '';
                domElement.style.perspective = ''
            }
            cache.camera.fov = fov
        }
        if (scene.autoUpdate === true) scene.updateMatrixWorld();
        if (camera.parent === null) camera.updateMatrixWorld();
        if (camera.isOrthographicCamera) {
            var tx = -(camera.right + camera.left) / 2;
            var ty = (camera.top + camera.bottom) / 2
        }
        var cameraCSSMatrix = camera.isOrthographicCamera ? 'scale(' + fov + ')' + 'translate(' + epsilon(tx) + 'px,' + epsilon(ty) + 'px)' + getCameraCSSMatrix(camera.matrixWorldInverse) : 'translateZ(' + fov + 'px)' + getCameraCSSMatrix(camera.matrixWorldInverse);
        var style = cameraCSSMatrix + 'translate(' + _widthHalf + 'px,' + _heightHalf + 'px)';
        if (cache.camera.style !== style && !isIE) {
            cameraElement.style.WebkitTransform = style;
            cameraElement.style.transform = style;
            cache.camera.style = style
        }
        renderObject(scene, scene, camera, cameraCSSMatrix);
        if (isIE) {
            zOrder(scene)
        }
    }
};
THREE.RenderableObject = function () {
    this.id = 0;
    this.object = null;
    this.z = 0;
    this.renderOrder = 0
};
THREE.RenderableFace = function () {
    this.id = 0;
    this.v1 = new THREE.RenderableVertex();
    this.v2 = new THREE.RenderableVertex();
    this.v3 = new THREE.RenderableVertex();
    this.normalModel = new THREE.Vector3();
    this.vertexNormalsModel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.vertexNormalsLength = 0;
    this.color = new THREE.Color();
    this.material = null;
    this.uvs = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
    this.z = 0;
    this.renderOrder = 0
};
THREE.RenderableVertex = function () {
    this.position = new THREE.Vector3();
    this.positionWorld = new THREE.Vector3();
    this.positionScreen = new THREE.Vector4();
    this.visible = true
};
THREE.RenderableVertex.prototype.copy = function (vertex) {
    this.positionWorld.copy(vertex.positionWorld);
    this.positionScreen.copy(vertex.positionScreen)
};
THREE.RenderableLine = function () {
    this.id = 0;
    this.v1 = new THREE.RenderableVertex();
    this.v2 = new THREE.RenderableVertex();
    this.vertexColors = [new THREE.Color(), new THREE.Color()];
    this.material = null;
    this.z = 0;
    this.renderOrder = 0
};
THREE.RenderableSprite = function () {
    this.id = 0;
    this.object = null;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.rotation = 0;
    this.scale = new THREE.Vector2();
    this.material = null;
    this.renderOrder = 0
};
THREE.Projector = function () {
    var _object, _objectCount, _objectPool = [], _objectPoolLength = 0, _vertex, _vertexCount, _vertexPool = [],
        _vertexPoolLength = 0, _face, _faceCount, _facePool = [], _facePoolLength = 0, _line, _lineCount,
        _linePool = [], _linePoolLength = 0, _sprite, _spriteCount, _spritePool = [], _spritePoolLength = 0,
        _renderData = {objects: [], lights: [], elements: []}, _vector3 = new THREE.Vector3(),
        _vector4 = new THREE.Vector4(),
        _clipBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
        _boundingBox = new THREE.Box3(), _points3 = new Array(3), _viewMatrix = new THREE.Matrix4(),
        _viewProjectionMatrix = new THREE.Matrix4(), _modelMatrix, _modelViewProjectionMatrix = new THREE.Matrix4(),
        _normalMatrix = new THREE.Matrix3(), _frustum = new THREE.Frustum(),
        _clippedVertex1PositionScreen = new THREE.Vector4(), _clippedVertex2PositionScreen = new THREE.Vector4();
    this.projectVector = function (vector, camera) {
        console.warn('THREE.Projector: .projectVector() is now vector.project().');
        vector.project(camera)
    };
    this.unprojectVector = function (vector, camera) {
        console.warn('THREE.Projector: .unprojectVector() is now vector.unproject().');
        vector.unproject(camera)
    };
    this.pickingRay = function () {
        console.error('THREE.Projector: .pickingRay() is now raycaster.setFromCamera().')
    };
    var RenderList = function RenderList() {
        var normals = [];
        var colors = [];
        var uvs = [];
        var object = null;
        var normalMatrix = new THREE.Matrix3();

        function setObject(value) {
            object = value;
            normalMatrix.getNormalMatrix(object.matrixWorld);
            normals.length = 0;
            colors.length = 0;
            uvs.length = 0
        }

        function projectVertex(vertex) {
            var position = vertex.position;
            var positionWorld = vertex.positionWorld;
            var positionScreen = vertex.positionScreen;
            positionWorld.copy(position).applyMatrix4(_modelMatrix);
            positionScreen.copy(positionWorld).applyMatrix4(_viewProjectionMatrix);
            var invW = 1 / positionScreen.w;
            positionScreen.x *= invW;
            positionScreen.y *= invW;
            positionScreen.z *= invW;
            vertex.visible = positionScreen.x >= -1 && positionScreen.x <= 1 && positionScreen.y >= -1 && positionScreen.y <= 1 && positionScreen.z >= -1 && positionScreen.z <= 1
        }

        function pushVertex(x, y, z) {
            _vertex = getNextVertexInPool();
            _vertex.position.set(x, y, z);
            projectVertex(_vertex)
        }

        function pushNormal(x, y, z) {
            normals.push(x, y, z)
        }

        function pushColor(r, g, b) {
            colors.push(r, g, b)
        }

        function pushUv(x, y) {
            uvs.push(x, y)
        }

        function checkTriangleVisibility(v1, v2, v3) {
            if (v1.visible === true || v2.visible === true || v3.visible === true) return true;
            _points3[0] = v1.positionScreen;
            _points3[1] = v2.positionScreen;
            _points3[2] = v3.positionScreen;
            return _clipBox.intersectsBox(_boundingBox.setFromPoints(_points3))
        }

        function checkBackfaceCulling(v1, v2, v3) {
            return (v3.positionScreen.x - v1.positionScreen.x) * (v2.positionScreen.y - v1.positionScreen.y) - (v3.positionScreen.y - v1.positionScreen.y) * (v2.positionScreen.x - v1.positionScreen.x) < 0
        }

        function pushLine(a, b) {
            var v1 = _vertexPool[a];
            var v2 = _vertexPool[b];
            v1.positionScreen.copy(v1.position).applyMatrix4(_modelViewProjectionMatrix);
            v2.positionScreen.copy(v2.position).applyMatrix4(_modelViewProjectionMatrix);
            if (clipLine(v1.positionScreen, v2.positionScreen) === true) {
                v1.positionScreen.multiplyScalar(1 / v1.positionScreen.w);
                v2.positionScreen.multiplyScalar(1 / v2.positionScreen.w);
                _line = getNextLineInPool();
                _line.id = object.id;
                _line.v1.copy(v1);
                _line.v2.copy(v2);
                _line.z = Math.max(v1.positionScreen.z, v2.positionScreen.z);
                _line.renderOrder = object.renderOrder;
                _line.material = object.material;
                if (object.material.vertexColors) {
                    _line.vertexColors[0].fromArray(colors, a * 3);
                    _line.vertexColors[1].fromArray(colors, b * 3)
                }
                _renderData.elements.push(_line)
            }
        }

        function pushTriangle(a, b, c, material) {
            var v1 = _vertexPool[a];
            var v2 = _vertexPool[b];
            var v3 = _vertexPool[c];
            if (checkTriangleVisibility(v1, v2, v3) === false) return;
            if (material.side === THREE.DoubleSide || checkBackfaceCulling(v1, v2, v3) === true) {
                _face = getNextFaceInPool();
                _face.id = object.id;
                _face.v1.copy(v1);
                _face.v2.copy(v2);
                _face.v3.copy(v3);
                _face.z = (v1.positionScreen.z + v2.positionScreen.z + v3.positionScreen.z) / 3;
                _face.renderOrder = object.renderOrder;
                _vector3.subVectors(v3.position, v2.position);
                _vector4.subVectors(v1.position, v2.position);
                _vector3.cross(_vector4);
                _face.normalModel.copy(_vector3);
                _face.normalModel.applyMatrix3(normalMatrix).normalize();
                for (var i = 0; i < 3; i++) {
                    var normal = _face.vertexNormalsModel[i];
                    normal.fromArray(normals, arguments[i] * 3);
                    normal.applyMatrix3(normalMatrix).normalize();
                    var uv = _face.uvs[i];
                    uv.fromArray(uvs, arguments[i] * 2)
                }
                _face.vertexNormalsLength = 3;
                _face.material = material;
                if (material.vertexColors) {
                    _face.color.fromArray(colors, a * 3)
                }
                _renderData.elements.push(_face)
            }
        }

        return {
            setObject: setObject,
            projectVertex: projectVertex,
            checkTriangleVisibility: checkTriangleVisibility,
            checkBackfaceCulling: checkBackfaceCulling,
            pushVertex: pushVertex,
            pushNormal: pushNormal,
            pushColor: pushColor,
            pushUv: pushUv,
            pushLine: pushLine,
            pushTriangle: pushTriangle
        }
    };
    var renderList = new RenderList();

    function projectObject(object) {
        if (object.visible === false) return;
        if (object instanceof THREE.Light) {
            _renderData.lights.push(object)
        } else if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
            if (object.material.visible === false) return;
            if (object.frustumCulled === true && _frustum.intersectsObject(object) === false) return;
            addObject(object)
        } else if (object instanceof THREE.Sprite) {
            if (object.material.visible === false) return;
            if (object.frustumCulled === true && _frustum.intersectsSprite(object) === false) return;
            addObject(object)
        }
        var children = object.children;
        for (var i = 0, l = children.length; i < l; i++) {
            projectObject(children[i])
        }
    }

    function addObject(object) {
        _object = getNextObjectInPool();
        _object.id = object.id;
        _object.object = object;
        _vector3.setFromMatrixPosition(object.matrixWorld);
        _vector3.applyMatrix4(_viewProjectionMatrix);
        _object.z = _vector3.z;
        _object.renderOrder = object.renderOrder;
        _renderData.objects.push(_object)
    }

    this.projectScene = function (scene, camera, sortObjects, sortElements) {
        _faceCount = 0;
        _lineCount = 0;
        _spriteCount = 0;
        _renderData.elements.length = 0;
        if (scene.autoUpdate === true) scene.updateMatrixWorld();
        if (camera.parent === null) camera.updateMatrixWorld();
        _viewMatrix.copy(camera.matrixWorldInverse);
        _viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, _viewMatrix);
        _frustum.setFromProjectionMatrix(_viewProjectionMatrix);
        _objectCount = 0;
        _renderData.objects.length = 0;
        _renderData.lights.length = 0;
        projectObject(scene);
        if (sortObjects === true) {
            _renderData.objects.sort(painterSort)
        }
        var objects = _renderData.objects;
        for (var o = 0, ol = objects.length; o < ol; o++) {
            var object = objects[o].object;
            var geometry = object.geometry;
            renderList.setObject(object);
            _modelMatrix = object.matrixWorld;
            _vertexCount = 0;
            if (object instanceof THREE.Mesh) {
                if (geometry instanceof THREE.BufferGeometry) {
                    var material = object.material;
                    var isMultiMaterial = Array.isArray(material);
                    var attributes = geometry.attributes;
                    var groups = geometry.groups;
                    if (attributes.position === undefined) continue;
                    var positions = attributes.position.array;
                    for (var i = 0, l = positions.length; i < l; i += 3) {
                        var x = positions[i];
                        var y = positions[i + 1];
                        var z = positions[i + 2];
                        if (material.morphTargets === true) {
                            var morphTargets = geometry.morphAttributes.position;
                            var morphTargetsRelative = geometry.morphTargetsRelative;
                            var morphInfluences = object.morphTargetInfluences;
                            for (var t = 0, tl = morphTargets.length; t < tl; t++) {
                                var influence = morphInfluences[t];
                                if (influence === 0) continue;
                                var target = morphTargets[t];
                                if (morphTargetsRelative) {
                                    x += target.getX(i / 3) * influence;
                                    y += target.getY(i / 3) * influence;
                                    z += target.getZ(i / 3) * influence
                                } else {
                                    x += (target.getX(i / 3) - positions[i]) * influence;
                                    y += (target.getY(i / 3) - positions[i + 1]) * influence;
                                    z += (target.getZ(i / 3) - positions[i + 2]) * influence
                                }
                            }
                        }
                        renderList.pushVertex(x, y, z)
                    }
                    if (attributes.normal !== undefined) {
                        var normals = attributes.normal.array;
                        for (var i = 0, l = normals.length; i < l; i += 3) {
                            renderList.pushNormal(normals[i], normals[i + 1], normals[i + 2])
                        }
                    }
                    if (attributes.color !== undefined) {
                        var colors = attributes.color.array;
                        for (var i = 0, l = colors.length; i < l; i += 3) {
                            renderList.pushColor(colors[i], colors[i + 1], colors[i + 2])
                        }
                    }
                    if (attributes.uv !== undefined) {
                        var uvs = attributes.uv.array;
                        for (var i = 0, l = uvs.length; i < l; i += 2) {
                            renderList.pushUv(uvs[i], uvs[i + 1])
                        }
                    }
                    if (geometry.index !== null) {
                        var indices = geometry.index.array;
                        if (groups.length > 0) {
                            for (var g = 0; g < groups.length; g++) {
                                var group = groups[g];
                                material = isMultiMaterial === true ? object.material[group.materialIndex] : object.material;
                                if (material === undefined) continue;
                                for (var i = group.start, l = group.start + group.count; i < l; i += 3) {
                                    renderList.pushTriangle(indices[i], indices[i + 1], indices[i + 2], material)
                                }
                            }
                        } else {
                            for (var i = 0, l = indices.length; i < l; i += 3) {
                                renderList.pushTriangle(indices[i], indices[i + 1], indices[i + 2], material)
                            }
                        }
                    } else {
                        if (groups.length > 0) {
                            for (var g = 0; g < groups.length; g++) {
                                var group = groups[g];
                                material = isMultiMaterial === true ? object.material[group.materialIndex] : object.material;
                                if (material === undefined) continue;
                                for (var i = group.start, l = group.start + group.count; i < l; i += 3) {
                                    renderList.pushTriangle(i, i + 1, i + 2, material)
                                }
                            }
                        } else {
                            for (var i = 0, l = positions.length / 3; i < l; i += 3) {
                                renderList.pushTriangle(i, i + 1, i + 2, material)
                            }
                        }
                    }
                } else if (geometry instanceof THREE.Geometry) {
                    var vertices = geometry.vertices;
                    var faces = geometry.faces;
                    var faceVertexUvs = geometry.faceVertexUvs[0];
                    _normalMatrix.getNormalMatrix(_modelMatrix);
                    var material = object.material;
                    var isMultiMaterial = Array.isArray(material);
                    for (var v = 0, vl = vertices.length; v < vl; v++) {
                        var vertex = vertices[v];
                        _vector3.copy(vertex);
                        if (material.morphTargets === true) {
                            var morphTargets = geometry.morphTargets;
                            var morphInfluences = object.morphTargetInfluences;
                            for (var t = 0, tl = morphTargets.length; t < tl; t++) {
                                var influence = morphInfluences[t];
                                if (influence === 0) continue;
                                var target = morphTargets[t];
                                var targetVertex = target.vertices[v];
                                _vector3.x += (targetVertex.x - vertex.x) * influence;
                                _vector3.y += (targetVertex.y - vertex.y) * influence;
                                _vector3.z += (targetVertex.z - vertex.z) * influence
                            }
                        }
                        renderList.pushVertex(_vector3.x, _vector3.y, _vector3.z)
                    }
                    for (var f = 0, fl = faces.length; f < fl; f++) {
                        var face = faces[f];
                        material = isMultiMaterial === true ? object.material[face.materialIndex] : object.material;
                        if (material === undefined) continue;
                        var side = material.side;
                        var v1 = _vertexPool[face.a];
                        var v2 = _vertexPool[face.b];
                        var v3 = _vertexPool[face.c];
                        if (renderList.checkTriangleVisibility(v1, v2, v3) === false) continue;
                        var visible = renderList.checkBackfaceCulling(v1, v2, v3);
                        if (side !== THREE.DoubleSide) {
                            if (side === THREE.FrontSide && visible === false) continue;
                            if (side === THREE.BackSide && visible === true) continue
                        }
                        _face = getNextFaceInPool();
                        _face.id = object.id;
                        _face.v1.copy(v1);
                        _face.v2.copy(v2);
                        _face.v3.copy(v3);
                        _face.normalModel.copy(face.normal);
                        if (visible === false && (side === THREE.BackSide || side === THREE.DoubleSide)) {
                            _face.normalModel.negate()
                        }
                        _face.normalModel.applyMatrix3(_normalMatrix).normalize();
                        var faceVertexNormals = face.vertexNormals;
                        for (var n = 0, nl = Math.min(faceVertexNormals.length, 3); n < nl; n++) {
                            var normalModel = _face.vertexNormalsModel[n];
                            normalModel.copy(faceVertexNormals[n]);
                            if (visible === false && (side === THREE.BackSide || side === THREE.DoubleSide)) {
                                normalModel.negate()
                            }
                            normalModel.applyMatrix3(_normalMatrix).normalize()
                        }
                        _face.vertexNormalsLength = faceVertexNormals.length;
                        var vertexUvs = faceVertexUvs[f];
                        if (vertexUvs !== undefined) {
                            for (var u = 0; u < 3; u++) {
                                _face.uvs[u].copy(vertexUvs[u])
                            }
                        }
                        _face.color = face.color;
                        _face.material = material;
                        _face.z = (v1.positionScreen.z + v2.positionScreen.z + v3.positionScreen.z) / 3;
                        _face.renderOrder = object.renderOrder;
                        _renderData.elements.push(_face)
                    }
                }
            } else if (object instanceof THREE.Line) {
                _modelViewProjectionMatrix.multiplyMatrices(_viewProjectionMatrix, _modelMatrix);
                if (geometry instanceof THREE.BufferGeometry) {
                    var attributes = geometry.attributes;
                    if (attributes.position !== undefined) {
                        var positions = attributes.position.array;
                        for (var i = 0, l = positions.length; i < l; i += 3) {
                            renderList.pushVertex(positions[i], positions[i + 1], positions[i + 2])
                        }
                        if (attributes.color !== undefined) {
                            var colors = attributes.color.array;
                            for (var i = 0, l = colors.length; i < l; i += 3) {
                                renderList.pushColor(colors[i], colors[i + 1], colors[i + 2])
                            }
                        }
                        if (geometry.index !== null) {
                            var indices = geometry.index.array;
                            for (var i = 0, l = indices.length; i < l; i += 2) {
                                renderList.pushLine(indices[i], indices[i + 1])
                            }
                        } else {
                            var step = object instanceof THREE.LineSegments ? 2 : 1;
                            for (var i = 0, l = positions.length / 3 - 1; i < l; i += step) {
                                renderList.pushLine(i, i + 1)
                            }
                        }
                    }
                } else if (geometry instanceof THREE.Geometry) {
                    var vertices = object.geometry.vertices;
                    if (vertices.length === 0) continue;
                    v1 = getNextVertexInPool();
                    v1.positionScreen.copy(vertices[0]).applyMatrix4(_modelViewProjectionMatrix);
                    var step = object instanceof THREE.LineSegments ? 2 : 1;
                    for (var v = 1, vl = vertices.length; v < vl; v++) {
                        v1 = getNextVertexInPool();
                        v1.positionScreen.copy(vertices[v]).applyMatrix4(_modelViewProjectionMatrix);
                        if ((v + 1) % step > 0) continue;
                        v2 = _vertexPool[_vertexCount - 2];
                        _clippedVertex1PositionScreen.copy(v1.positionScreen);
                        _clippedVertex2PositionScreen.copy(v2.positionScreen);
                        if (clipLine(_clippedVertex1PositionScreen, _clippedVertex2PositionScreen) === true) {
                            _clippedVertex1PositionScreen.multiplyScalar(1 / _clippedVertex1PositionScreen.w);
                            _clippedVertex2PositionScreen.multiplyScalar(1 / _clippedVertex2PositionScreen.w);
                            _line = getNextLineInPool();
                            _line.id = object.id;
                            _line.v1.positionScreen.copy(_clippedVertex1PositionScreen);
                            _line.v2.positionScreen.copy(_clippedVertex2PositionScreen);
                            _line.z = Math.max(_clippedVertex1PositionScreen.z, _clippedVertex2PositionScreen.z);
                            _line.renderOrder = object.renderOrder;
                            _line.material = object.material;
                            if (object.material.vertexColors) {
                                _line.vertexColors[0].copy(object.geometry.colors[v]);
                                _line.vertexColors[1].copy(object.geometry.colors[v - 1])
                            }
                            _renderData.elements.push(_line)
                        }
                    }
                }
            } else if (object instanceof THREE.Points) {
                _modelViewProjectionMatrix.multiplyMatrices(_viewProjectionMatrix, _modelMatrix);
                if (geometry instanceof THREE.Geometry) {
                    var vertices = object.geometry.vertices;
                    for (var v = 0, vl = vertices.length; v < vl; v++) {
                        var vertex = vertices[v];
                        _vector4.set(vertex.x, vertex.y, vertex.z, 1);
                        _vector4.applyMatrix4(_modelViewProjectionMatrix);
                        pushPoint(_vector4, object, camera)
                    }
                } else if (geometry instanceof THREE.BufferGeometry) {
                    var attributes = geometry.attributes;
                    if (attributes.position !== undefined) {
                        var positions = attributes.position.array;
                        for (var i = 0, l = positions.length; i < l; i += 3) {
                            _vector4.set(positions[i], positions[i + 1], positions[i + 2], 1);
                            _vector4.applyMatrix4(_modelViewProjectionMatrix);
                            pushPoint(_vector4, object, camera)
                        }
                    }
                }
            } else if (object instanceof THREE.Sprite) {
                object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
                _vector4.set(_modelMatrix.elements[12], _modelMatrix.elements[13], _modelMatrix.elements[14], 1);
                _vector4.applyMatrix4(_viewProjectionMatrix);
                pushPoint(_vector4, object, camera)
            }
        }
        if (sortElements === true) {
            _renderData.elements.sort(painterSort)
        }
        return _renderData
    };

    function pushPoint(_vector4, object, camera) {
        var invW = 1 / _vector4.w;
        _vector4.z *= invW;
        if (_vector4.z >= -1 && _vector4.z <= 1) {
            _sprite = getNextSpriteInPool();
            _sprite.id = object.id;
            _sprite.x = _vector4.x * invW;
            _sprite.y = _vector4.y * invW;
            _sprite.z = _vector4.z;
            _sprite.renderOrder = object.renderOrder;
            _sprite.object = object;
            _sprite.rotation = object.rotation;
            _sprite.scale.x = object.scale.x * Math.abs(_sprite.x - (_vector4.x + camera.projectionMatrix.elements[0]) / (_vector4.w + camera.projectionMatrix.elements[12]));
            _sprite.scale.y = object.scale.y * Math.abs(_sprite.y - (_vector4.y + camera.projectionMatrix.elements[5]) / (_vector4.w + camera.projectionMatrix.elements[13]));
            _sprite.material = object.material;
            _renderData.elements.push(_sprite)
        }
    }

    function getNextObjectInPool() {
        if (_objectCount === _objectPoolLength) {
            var object = new THREE.RenderableObject();
            _objectPool.push(object);
            _objectPoolLength++;
            _objectCount++;
            return object
        }
        return _objectPool[_objectCount++]
    }

    function getNextVertexInPool() {
        if (_vertexCount === _vertexPoolLength) {
            var vertex = new THREE.RenderableVertex();
            _vertexPool.push(vertex);
            _vertexPoolLength++;
            _vertexCount++;
            return vertex
        }
        return _vertexPool[_vertexCount++]
    }

    function getNextFaceInPool() {
        if (_faceCount === _facePoolLength) {
            var face = new THREE.RenderableFace();
            _facePool.push(face);
            _facePoolLength++;
            _faceCount++;
            return face
        }
        return _facePool[_faceCount++]
    }

    function getNextLineInPool() {
        if (_lineCount === _linePoolLength) {
            var line = new THREE.RenderableLine();
            _linePool.push(line);
            _linePoolLength++;
            _lineCount++;
            return line
        }
        return _linePool[_lineCount++]
    }

    function getNextSpriteInPool() {
        if (_spriteCount === _spritePoolLength) {
            var sprite = new THREE.RenderableSprite();
            _spritePool.push(sprite);
            _spritePoolLength++;
            _spriteCount++;
            return sprite
        }
        return _spritePool[_spriteCount++]
    }

    function painterSort(a, b) {
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder
        } else if (a.z !== b.z) {
            return b.z - a.z
        } else if (a.id !== b.id) {
            return a.id - b.id
        } else {
            return 0
        }
    }

    function clipLine(s1, s2) {
        var alpha1 = 0, alpha2 = 1, bc1near = s1.z + s1.w, bc2near = s2.z + s2.w, bc1far = -s1.z + s1.w,
            bc2far = -s2.z + s2.w;
        if (bc1near >= 0 && bc2near >= 0 && bc1far >= 0 && bc2far >= 0) {
            return true
        } else if (bc1near < 0 && bc2near < 0 || bc1far < 0 && bc2far < 0) {
            return false
        } else {
            if (bc1near < 0) {
                alpha1 = Math.max(alpha1, bc1near / (bc1near - bc2near))
            } else if (bc2near < 0) {
                alpha2 = Math.min(alpha2, bc1near / (bc1near - bc2near))
            }
            if (bc1far < 0) {
                alpha1 = Math.max(alpha1, bc1far / (bc1far - bc2far))
            } else if (bc2far < 0) {
                alpha2 = Math.min(alpha2, bc1far / (bc1far - bc2far))
            }
            if (alpha2 < alpha1) {
                return false
            } else {
                s1.lerp(s2, alpha1);
                s2.lerp(s1, 1 - alpha2);
                return true
            }
        }
    }
};