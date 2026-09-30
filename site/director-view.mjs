// Optional enhancement: no timers, dependencies, network, wheel listeners or storage.
export function attachDirectorView(root) {
  const stage = root.querySelector(".director-stage");
  const board = root.querySelector(".director-board");
  const front = root.querySelector(".slate-front");
  const back = root.querySelector(".slate-back");
  const flip = root.querySelector(".director-flip");
  if (!stage || !board || !front || !back || !flip) return;
  if (!CSS.supports("transform-style", "preserve-3d")) return;

  let angle = -14;
  let pitch = 8;
  let gesture = null;
  const paint = () => {
    board.style.setProperty("--turn", `${angle}deg`);
    board.style.setProperty("--pitch", `${pitch}deg`);
    const facingFront = Math.cos((angle * Math.PI) / 180) >= 0;
    front.setAttribute("aria-hidden", String(!facingFront));
    back.setAttribute("aria-hidden", String(facingFront));
  };
  const finish = () => {
    const id = gesture?.id;
    gesture = null;
    root.classList.remove("is-dragging");
    if (id !== undefined && stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
  };
  stage.tabIndex = 0;
  stage.setAttribute("aria-describedby", "director-help");
  root.classList.add("is-interactive");
  flip.hidden = false;

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || gesture) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      angle,
      pitch,
      width: stage.clientWidth,
      dragging: false,
    };
    if (event.pointerType === "mouse") stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      // Let a vertical touch gesture remain native page scrolling.
      if (event.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx)) {
        finish();
        return;
      }
      gesture.dragging = true;
      stage.setPointerCapture(event.pointerId);
      stage.focus({ preventScroll: true });
      root.classList.add("is-dragging");
    }
    angle = gesture.angle + (dx / Math.max(gesture.width, 1)) * 360;
    pitch = Math.max(-20, Math.min(20, gesture.pitch - dy * 0.08));
    paint();
  });
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  // Touch starts with implicit capture on the image. Transferring it to the
  // stage bubbles a child lostpointercapture event; that must not end our drag.
  stage.addEventListener("lostpointercapture", (event) => {
    if (event.target === stage) finish();
  });
  window.addEventListener("blur", finish);
  const turnOver = () => {
    finish();
    angle = Math.round(angle / 180) * 180 + 180;
    pitch = 0;
    paint();
  };
  flip.addEventListener("click", turnOver);
  stage.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "Enter", " ", "Home", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Enter" || event.key === " ") {
      turnOver();
      return;
    }
    finish();
    if (event.key === "Home" || event.key === "Escape") {
      angle = 0;
      pitch = 0;
    } else angle += event.key === "ArrowRight" ? 30 : -30;
    paint();
  });
  paint();
}

for (const root of document.querySelectorAll("[data-director-view]")) attachDirectorView(root);
