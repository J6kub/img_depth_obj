
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const fileInput = document.querySelector("#file");
const drop = document.querySelector("#drop");
const sourcePreview = document.querySelector("#sourcePreview");
const prompt = document.querySelector("#uploadPrompt");
const generateBtn = document.querySelector("#generate");
const fileMeta = document.querySelector("#fileMeta");
const progress = document.querySelector("#progress");
const progressText = document.querySelector("#progressText");
const progressTitle = document.querySelector("#progressTitle");
const viewerStatus = document.querySelector("#viewerStatus");
const emptyState = document.querySelector("#emptyState");
const viewerTools = document.querySelector("#viewerTools");
const results = document.querySelector("#results");
const canvasHost = document.querySelector("#canvasHost");

let selectedFile = null;
let renderer, scene, camera, controls;
let currentModel = null;

const BAR_LENGTH = 30;
const BAR_HEIGHT = 5;
const BAR_THICKNESS = 1;

// --------------------------------------------------
// FILE UPLOAD
// --------------------------------------------------

function chooseFile(file) {
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        alert("Please select a PNG, JPEG or WebP image.");
        return;
    }

    selectedFile = file;
    sourcePreview.src = URL.createObjectURL(file);
    sourcePreview.hidden = false;
    prompt.hidden = true;

    fileMeta.textContent =
        `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    generateBtn.disabled = false;
}

fileInput.addEventListener("change", e => {
    chooseFile(e.target.files[0]);
});

drop.addEventListener("dragover", e => {
    e.preventDefault();
    drop.style.borderColor = "#c4f06a";
});

drop.addEventListener("dragleave", () => {
    drop.style.borderColor = "";
});

drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.style.borderColor = "";
    chooseFile(e.dataTransfer.files[0]);
});

// --------------------------------------------------
// VIEWER INITIALIZATION
// --------------------------------------------------

function initViewer() {
    if (renderer) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171b16);

    camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    camera.position.set(40, 35, 60);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false
    });

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    canvasHost.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(
        new THREE.HemisphereLight(0xe8f2dc, 0x343b30, 2)
    );

    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(30, 50, 40);
    scene.add(light);

    const fillLight = new THREE.DirectionalLight(0xffbb88, 1);
    fillLight.position.set(-30, 10, -20);
    scene.add(fillLight);

    const resize = () => {
        const w = canvasHost.clientWidth;
        const h = canvasHost.clientHeight;

        if (!w || !h) return;

        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };

    new ResizeObserver(resize).observe(canvasHost);
    resize();

    const animate = () => {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    };

    animate();
}

// --------------------------------------------------
// CHOCOLATE BAR
// Dimensions: 30 x 5 x 1 cm
// X = length, Y = thickness, Z = height
// --------------------------------------------------

function createChocolateBar() {
    const group = new THREE.Group();

    const chocolateMaterial = new THREE.MeshStandardMaterial({
        color: 0x482317,
        roughness: 0.38,
        metalness: 0
    });

    const barGeometry = new THREE.BoxGeometry(
        1,
        5,
        15
    );

    const bar = new THREE.Mesh(barGeometry, chocolateMaterial);

    // Dark outline
    const edges = new THREE.EdgesGeometry(barGeometry);

    const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
            color: 0x28130d
        })
    );

    group.add(bar);
    group.add(outline);

    return group;
}

// --------------------------------------------------
// CAMERA FRAMING
// --------------------------------------------------

function frameModel() {
    if (!currentModel) return;

    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    camera.position.set(
        center.x + maxDim * 1.5,
        center.y + maxDim * 1.2,
        center.z + maxDim * 2.2
    );

    camera.near = maxDim / 1000;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
}

// --------------------------------------------------
// LOAD OBJ + CHOCOLATE
// --------------------------------------------------


function showOBJ(url) {
    initViewer();

    new OBJLoader().load(url, object => {
        if (currentModel) {
            scene.remove(currentModel);
        }

        currentModel = new THREE.Group();

        // Get original OBJ dimensions
        const originalBox = new THREE.Box3().setFromObject(object);
        const originalSize = originalBox.getSize(new THREE.Vector3());

        // Center OBJ at origin
        const originalCenter = originalBox.getCenter(new THREE.Vector3());
        object.position.sub(originalCenter);

        // Scale proportionally to fit chocolate surface
        // Chocolate X = 30 cm, Z = 5 cm
        const maxWidth = 15;
        const maxDepth = 5;

        const scale = Math.min(
            maxWidth / originalSize.x,
            maxDepth / originalSize.z
        );

        object.scale.setScalar(scale);

        // Recalculate dimensions after scaling
        const scaledBox = new THREE.Box3().setFromObject(object);
        const scaledSize = scaledBox.getSize(new THREE.Vector3());

        // Center horizontally and align bottom with chocolate top
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

        object.position.x -= scaledCenter.x;
        object.position.z -= scaledCenter.z;
        object.position.y -= scaledBox.min.y;

        // Model material
        object.traverse(child => {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xc4a77a,
                    roughness: 0.82,
                    metalness: 0.02,
                    side: THREE.DoubleSide
                });

                child.geometry.computeVertexNormals();
            }
        });

        // Chocolate bar: 30 x 5 x 1 cm
        const chocolate = createChocolateBar();

        // Chocolate centered at origin, top surface at Y = 0
        chocolate.position.set(-0.9, 2, 0);

        // Position OBJ directly on chocolate
        // Its bottom is now at Y = 0
        currentModel.add(chocolate);
        currentModel.add(object);

        scene.add(currentModel);

        // Camera
        frameModel();

        emptyState.hidden = true;
        viewerTools.hidden = false;
        viewerStatus.textContent = "MODEL LOADED";

        console.log("Original OBJ:", originalSize);
        console.log("Scaled OBJ:", scaledSize);
        console.log("Scale factor:", scale);
        console.log("Chocolate:", "30 x 5 x 1 cm");

    }, undefined, err => {
        console.error(err);
        alert("Could not load the OBJ preview.");
    });
}


// --------------------------------------------------
// GENERATION
// --------------------------------------------------

generateBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    generateBtn.disabled = true;
    progress.hidden = false;
    results.hidden = true;

    progressTitle.textContent = "Generating geometry";
    progressText.textContent = "Uploading image and waiting for ComfyUI…";
    viewerStatus.textContent = "GENERATING";

    try {
        const form = new FormData();
        form.append("image", selectedFile);

        const response = await fetch("/api/generate", {
            method: "POST",
            body: form
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Generation failed");
        }

        progressText.textContent = "Loading 3D preview…";

        showOBJ(data.obj_url + "?v=" + Date.now());

        document.querySelector("#depthLink").href = data.depth_url;
        document.querySelector("#downloadLink").href = data.download_url;

        results.hidden = false;

        progressTitle.textContent = "Complete";
        progressText.textContent = "Your OBJ mesh is ready.";

    } catch (err) {
        console.error(err);

        progressTitle.textContent = "Generation failed";
        progressText.textContent = err.message;
        viewerStatus.textContent = "ERROR";

    } finally {
        generateBtn.disabled = false;
    }
});

// --------------------------------------------------
// RESET CAMERA
// --------------------------------------------------

document.querySelector("#resetView").addEventListener("click", () => {
    frameModel();
});
