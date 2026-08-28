const FLIGHT_DURATION_MS = 13500;

let aircraftAudio;
let volumeTimer;
let soundStartedAt = 0;

export function setFlightSoundActive(isActive) {
  if (!isActive) {
    stopFlightSound();
    return;
  }

  startFlightSound();
}

function startFlightSound() {
  aircraftAudio ??= new Audio('/audio/Airplane.mp3');
  aircraftAudio.preload = 'auto';
  aircraftAudio.loop = false;
  aircraftAudio.currentTime = 0;
  aircraftAudio.volume = 0.72;
  soundStartedAt = Date.now();
  aircraftAudio.play().catch(() => {});

  window.clearInterval(volumeTimer);
  volumeTimer = window.setInterval(updateFlightSound, 100);
}

function updateFlightSound() {
  if (!aircraftAudio) {
    return;
  }

  const elapsed = Date.now() - soundStartedAt;
  const cycleElapsed = elapsed % FLIGHT_DURATION_MS;
  const cycleRatio = cycleElapsed / FLIGHT_DURATION_MS;

  if (elapsed >= FLIGHT_DURATION_MS && cycleElapsed < 140) {
    aircraftAudio.currentTime = 0;
    aircraftAudio.play().catch(() => {});
  }

  const distanceFade = cycleRatio < 0.48
    ? 1
    : Math.max(0, 1 - (cycleRatio - 0.48) / 0.48);
  aircraftAudio.volume = 0.72 * distanceFade;
}

function stopFlightSound() {
  window.clearInterval(volumeTimer);
  volumeTimer = undefined;

  if (aircraftAudio) {
    aircraftAudio.pause();
    aircraftAudio.currentTime = 0;
  }
}
