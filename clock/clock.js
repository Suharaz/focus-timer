// Focus Clock Script
console.log('Clock script loaded');

const clockEl = document.getElementById('clock');

function pad(n) {
  return n.toString().padStart(2, '0');
}

function updateClock() {
  const now = new Date();
  const time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  clockEl.textContent = time;
}

// Update immediately
updateClock();
console.log('First update done');

// Update every second
setInterval(updateClock, 1000);
console.log('Interval set');

// Fullscreen on click
document.body.addEventListener('click', function() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});
