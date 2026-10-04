// Overlay motion — make the next close count as a pointer close, as a real click would
// (jsdom's .click() fires no pointerdown). Call the returned function in afterEach.
export function pointerInput(): () => void {
  document.documentElement.dataset.input = 'pointer'
  return () => {
    delete document.documentElement.dataset.input
  }
}
