import { element, message } from './dom.js';
const form = element<HTMLFormElement>('#login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = element<HTMLButtonElement>('button', form);
  const error = element('#login-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': element<HTMLMetaElement>('meta[name="login-token"]').content,
      },
      body: JSON.stringify({ password: new FormData(form).get('password') }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        typeof result.detail === 'string' ? result.detail : 'Check your password and try again.',
      );
    form.reset();
    location.replace('/');
  } catch (failure) {
    error.textContent =
      failure instanceof TypeError
        ? 'Unable to reach the company. Try again shortly.'
        : message(failure);
  } finally {
    button.disabled = false;
  }
});
