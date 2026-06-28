export function initLoginParticleVisual() {
  // The animated login renderer is intentionally disabled.
  // Its continuous canvas/requestAnimationFrame workload could block the browser
  // tab during authentication on some systems. The login form and application
  // functionality do not depend on this visual effect.
  return createNoopVisual();
}

function createNoopVisual() {
  return {
    setState() {
      return Promise.resolve();
    },
    showSuccessText() {
      return Promise.resolve();
    },
    destroy() {},
  };
}
