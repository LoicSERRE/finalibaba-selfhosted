/**
 * A short vibration where the phone can give one (v2.18.1): the only
 * feedback the shake gesture has, since it deliberately puts nothing on
 * screen.
 *
 * Android: the Vibration API - which Chrome ignores until the page has had
 * a tap, so the first gesture after opening the app may stay silent there.
 * iPhone: Safari has no Vibration API at all; toggling a native switch
 * (`<input type="checkbox" switch>`, iOS 18+) plays the system haptic, so a
 * hidden one is toggled instead, once per pulse. Anything else: nothing,
 * silently - feedback is a nicety, never a requirement.
 */

/** One pulse when the amounts are hidden, two when they come back. */
export function hapticFor(hidden: boolean) {
  pulse(hidden ? 1 : 2);
}

function pulse(count: number) {
  const pattern = count === 1 ? [60] : [40, 80, 40];
  if (typeof navigator.vibrate === "function" && navigator.vibrate(pattern)) return;
  for (let i = 0; i < count; i++) setTimeout(switchHaptic, i * 120);
}

function switchHaptic() {
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  label.remove();
}
