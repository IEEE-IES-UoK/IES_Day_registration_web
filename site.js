'use strict';
/* Site configuration: never put a backend secret into this file. */
const CONFIG = {
  submissionEndpoint: '/api/register',
  previewMode: location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
};
const $ = id => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let submitted = false;
let submitting = false;
let requestId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let focusReturn = null;
const modal = $('confirmationOverlay');
const closeModal = $('closeModal');
const siteForm = $('registrationForm');
const submitButton = $('submitButton');

function fieldValidity(id, valid) {
  const wrapper = $(id);
  wrapper.classList.toggle('error', !valid);
  wrapper.querySelector('input').setAttribute('aria-invalid', String(!valid));
  return valid;
}
function showError(message) {
  const error = $('formError');
  error.textContent = message;
  error.hidden = false;
  error.setAttribute('tabindex', '-1');
  error.focus({ preventScroll: false });
}
function validate() {
  $('formError').hidden = true;
  const valid = [
    fieldValidity('fieldFirstName', $('firstName').value.trim().length >= 2 && $('firstName').value.trim().length <= 80),
    fieldValidity('fieldUniversity', $('university').value.trim().length >= 2 && $('university').value.trim().length <= 120),
    fieldValidity('fieldFaculty', $('faculty').value.trim().length >= 2 && $('faculty').value.trim().length <= 120),
    fieldValidity('fieldWhatsapp', /^(?:07\d{8}|\+?947\d{8}|\+?\d{8,15})$/.test($('whatsapp').value.replace(/[\s().-]+/g, '').trim()))
  ].every(Boolean);
  if (!valid) {
    $('formError').textContent = 'Please check the highlighted fields and try again.';
    $('formError').hidden = false;
    const first = document.querySelector('.field.error input');
    if (first) {
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  }
  return valid;
}
function payload() {
  return {
    requestId,
    firstName: $('firstName').value.trim(),
    university: $('university').value.trim(),
    faculty: $('faculty').value.trim(),
    whatsapp: $('whatsapp').value.replace(/[\s().-]+/g, '').trim(),
    website: $('website').value
  };
}
function openConfirmation(demo) {
  focusReturn = document.activeElement;
  modal.hidden = false;
  modal.classList.toggle('demo-modal', demo);
  document.body.classList.add('dialog-open');
  $('previewAlert').hidden = !demo;
  $('confirmationTitle').textContent = demo ? 'Registration preview' : 'Registration complete!';
  $('confirmationText').textContent = demo
    ? 'This is a local IEEE IES Day preview. Your details have not been saved. Use the deployed website to register.'
    : 'Your registration for IEEE IES Day is complete. We look forward to seeing you.';
  if (!demo) {
    submitted = true;
    siteForm.hidden = true;
    $('completedBanner').hidden = false;
  }
  closeModal.focus();
}
function dismissModal() {
  modal.hidden = true;
  document.body.classList.remove('dialog-open');
  if (!submitted && focusReturn && focusReturn.isConnected) focusReturn.focus();
  else $('completedBanner').focus();
}

document.querySelectorAll('a[href="#registration"]').forEach(link => link.addEventListener('click', () => {
  if (reduceMotion.matches) return;
  link.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.025)' }, { transform: 'scale(1)' }], { duration: 280 });
}));
closeModal.addEventListener('click', dismissModal);
modal.addEventListener('click', event => { if (event.target === modal) dismissModal(); });
document.addEventListener('keydown', event => {
  if (modal.hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); dismissModal(); }
  if (event.key === 'Tab') {
    const list = [...modal.querySelectorAll('a:not([hidden]),button:not([hidden])')].filter(item => item.getClientRects().length > 0);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
siteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitted || submitting || !validate()) return;
  if (CONFIG.previewMode) { openConfirmation(true); return; }
  submitting = true;
  siteForm.setAttribute('aria-busy', 'true');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving your registration…';
  $('formError').hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(CONFIG.submissionEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
      cache: 'no-store',
      signal: controller.signal
    });
    let result;
    try { result = await response.json(); }
    catch { throw Error('We could not confirm the registration. Please try again.'); }
    if (!response.ok || result.success !== true) throw Error(result.error || 'We could not save your registration. Please try again.');
    openConfirmation(false);
  } catch (error) {
    showError(error.name === 'AbortError'
      ? 'The request timed out. Please retry; your original registration will not be duplicated.'
      : (error.message || 'A connection problem occurred. Please try again.'));
  } finally {
    clearTimeout(timeout);
    submitting = false;
    siteForm.removeAttribute('aria-busy');
    submitButton.disabled = submitted;
    if (!submitted) submitButton.innerHTML = 'Complete registration <span aria-hidden="true">→</span>';
  }
});
