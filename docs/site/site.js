const figures = document.querySelectorAll('[data-viewport]');
const buttons = document.querySelectorAll('[data-profile]');
function selectProfile(profile) {
  for (const figure of figures) figure.hidden = figure.dataset.viewport !== profile;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.profile === profile));
}
for (const button of buttons) button.addEventListener('click', () => selectProfile(button.dataset.profile));
selectProfile('desktop');
function revealLinkedDetails() {
  let target;
  try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
  if (!target) return;
  let details = target.closest('details');
  while (details) { details.open = true; details = details.parentElement.closest('details'); }
}
addEventListener('hashchange', revealLinkedDetails);
revealLinkedDetails();
