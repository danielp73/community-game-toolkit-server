const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/session.js'), 'utf8');
const start = source.slice(source.indexOf('async function startCropEditor()'), source.indexOf('async function applyCrop()'));
const constrain = source.slice(source.indexOf('function constrainCropImage()'), source.indexOf('function renderCropCanvas()'));
for (const [name, imageWidth, imageHeight, width, height] of [
    ['landscape', 2000, 1000, 360, 180],
    ['portrait', 1000, 2000, 240, 480],
    ['wide panorama', 2000, 200, 360, 36],
    ['square desktop', 1000, 1000, 600, 600]
]) {
    test(`crop preserves ${name} preview without zooming`, async () => {
        const bitmap = {width: imageWidth, height: imageHeight};
        const context = {currentFile: {}, createImageBitmap: async () => bitmap,
            preview: {decode: async () => {}, getBoundingClientRect: () => ({width, height})},
            window: {devicePixelRatio: 2}, cropCanvas: {style: {}},
            setBusy() {}, setCropMode() {}, renderCropCanvas() {}, setStatus() {}, console};
        vm.createContext(context);
        vm.runInContext(start + '\n' + constrain, context);
        await context.startCropEditor();
        const state = context.cropState;
        assert.ok(state);
        assert.equal(state.width, width); assert.equal(state.height, height);
        assert.equal(context.cropCanvas.style.width, `${width}px`);
        assert.equal(context.cropCanvas.style.height, `${height}px`);
        assert.equal(state.offsetX, 0); assert.equal(state.offsetY, 0);
        assert.ok(Math.abs(state.scale * imageWidth - width) < .00001);
        assert.ok(Math.abs(state.scale * imageHeight - height) < .00001);
        assert.equal(state.frame.width, width); assert.equal(state.frame.height, height);
        // Moving a corner inward crops the existing picture without enlarging it.
        state.frame = {x: width / 4, y: height / 4, width: width / 2, height: height / 2};
        const originalScale = state.scale;
        context.constrainCropImage();
        assert.equal(state.scale, originalScale);
    });
}
