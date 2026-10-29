// Phase 7 (Item 3) — native camera/mic permission flow, web-side
// coverage only. Nothing here runs on a device: the sandbox has no
// phone, no camera, no microphone (see docs/android.md checklist).
// What IS proven here: failure classification (the fix for the
// photographed "Camera could not be started" dead end), the exact
// settings-guidance wording, and that the web fallback chain is
// entered correctly when no native shell exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNativePlatform,
  getPlatform,
  ensureCameraPermission,
  ensureSpeechPermission,
  classifyCameraError,
  cameraFailureGuidance,
  classifyMicError,
  micFailureGuidance,
  CAMERA_SETTINGS_GUIDANCE,
  MIC_SETTINGS_GUIDANCE,
} from '../services/native';
import { isSpeechRecognitionSupported, listenOnce } from '../services/voice';

test('native shell is absent in the sandbox (web platform)', () => {
  assert.equal(isNativePlatform(), false);
  assert.equal(getPlatform(), 'web');
});

test('ensureCameraPermission / ensureSpeechPermission refuse on web (native-only, plugin web builds are unimplemented)', async () => {
  await assert.rejects(() => ensureCameraPermission(), /NATIVE_ONLY/);
  await assert.rejects(() => ensureSpeechPermission(), /NATIVE_ONLY/);
});

test('classifyCameraError: denial, missing camera, in-use, cancelled, unknown', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }), 'PERMISSION_DENIED');
  assert.equal(classifyCameraError({ name: 'SecurityError' }), 'PERMISSION_DENIED');
  assert.equal(classifyCameraError({ code: 'OS-PLUG-CAMR-0003' }), 'PERMISSION_DENIED');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'NO_CAMERA');
  assert.equal(classifyCameraError({ code: 'OS-PLUG-CAMR-0007' }), 'NO_CAMERA');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'CAMERA_IN_USE');
  assert.equal(classifyCameraError({ message: 'Camera is already in use' }), 'CAMERA_IN_USE');
  assert.equal(classifyCameraError({ code: 'OS-PLUG-CAMR-0006' }), 'CANCELLED');
  assert.equal(classifyCameraError(new Error('something odd')), 'UNAVAILABLE');
});

test('denied camera guidance names the exact Settings path (never a dead end)', () => {
  assert.match(CAMERA_SETTINGS_GUIDANCE, /Settings/);
  assert.match(CAMERA_SETTINGS_GUIDANCE, /Apps/);
  assert.match(CAMERA_SETTINGS_GUIDANCE, /Amar Dokan POS/);
  assert.match(CAMERA_SETTINGS_GUIDANCE, /Permissions/);
  assert.match(CAMERA_SETTINGS_GUIDANCE, /Camera/);
  assert.match(cameraFailureGuidance('PERMISSION_DENIED'), /Barcode box above/);
  assert.match(cameraFailureGuidance('CAMERA_IN_USE'), /another app/);
  assert.match(cameraFailureGuidance('NO_CAMERA'), /Barcode box above/);
  assert.match(cameraFailureGuidance('UNAVAILABLE'), /Retry/);
});

test('classifyMicError + mic guidance name the Microphone settings path', () => {
  assert.equal(classifyMicError({ message: 'permission denied' }), 'PERMISSION_DENIED');
  assert.equal(classifyMicError({ message: 'no speech detected' }), 'NO_SPEECH');
  assert.equal(classifyMicError(new Error('service unavailable')), 'UNAVAILABLE');
  assert.match(MIC_SETTINGS_GUIDANCE, /Microphone/);
  assert.match(MIC_SETTINGS_GUIDANCE, /Permissions/);
  assert.match(micFailureGuidance('PERMISSION_DENIED'), /text box below/);
});

test('voice fallback chain on web: no native shell, no Web Speech API -> UNSUPPORTED (typed input remains)', async () => {
  assert.equal(isSpeechRecognitionSupported(), false);
  await assert.rejects(() => listenOnce('bn'), /UNSUPPORTED/);
});
