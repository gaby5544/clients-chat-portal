// Face check helper — runs in its OWN short-lived process (spawned by faceMatch.js) so that the heavy
// model never blocks the live chat server and its memory is returned to the system when it exits.
// 100% free: open-source models (MIT) shipped inside the @vladmandic/face-api package, TensorFlow.js with the
// WebAssembly backend, no native add-ons, no cloud service, nothing leaves your server.
//   node faceWorker.cjs <idImagePath> <selfieImagePath>   ->  prints one JSON line
const path = require('path');
const out = (o) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(0); };
(async () => {
  let sharp, tf, wasm, faceapi;
  try {
    sharp = require('sharp'); tf = require('@tensorflow/tfjs'); wasm = require('@tensorflow/tfjs-backend-wasm');
    faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
  } catch (e) { return out({ available: false, error: 'face libraries not installed: ' + e.message.slice(0, 120) }); }
  try {
    const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')) + '/dist/';
    wasm.setWasmPaths(wasmDir, false);
    await tf.setBackend('wasm'); await tf.ready();
    const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);

    const analyse = async (file) => {
      const { data, info } = await sharp(file, { failOn: 'none' }).rotate().resize(960, 960, { fit: 'inside', withoutEnlargement: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const t = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
      try {
        const res = await faceapi.detectAllFaces(t, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 })).withFaceLandmarks().withFaceDescriptors();
        // the biggest face is the subject (an ID card can show a small second "ghost" photo; people may stand behind in a selfie)
        res.sort((a, b) => b.detection.box.area - a.detection.box.area);
        const main = res[0];
        const areaShare = main ? main.detection.box.area / (info.width * info.height) : 0;
        // a second face counts as "another person" only if it is nearly as large as the main one
        const others = res.filter((r, i) => i > 0 && r.detection.box.area > 0.35 * main.detection.box.area).length;
        return { faces: res.length, others, score: main ? +main.detection.score.toFixed(3) : 0, areaShare: +areaShare.toFixed(4), descriptor: main ? Array.from(main.descriptor) : null };
      } finally { t.dispose(); }
    };
    const [idImg, selfieImg] = [process.argv[2], process.argv[3]];
    const idR = idImg ? await analyse(idImg) : null;
    const selfieR = selfieImg ? await analyse(selfieImg) : null;
    let distance = null;
    if (idR && selfieR && idR.descriptor && selfieR.descriptor) distance = +faceapi.euclideanDistance(idR.descriptor, selfieR.descriptor).toFixed(3);
    out({ available: true, id: idR && { faces: idR.faces, others: idR.others, score: idR.score, areaShare: idR.areaShare }, selfie: selfieR && { faces: selfieR.faces, others: selfieR.others, score: selfieR.score, areaShare: selfieR.areaShare }, distance });
  } catch (e) { out({ available: false, error: String(e.message || e).slice(0, 200) }); }
})();
