// Reference-counted body scroll lock. Modal/BottomSheet/Sheet can be nested
// (the dispatcher mobile Sheet is explicitly designed for this — see its
// zIndex prop), so a naive "set overflow on open, clear on close" per
// instance would let the innermost overlay closing re-enable page scroll
// while an outer one is still open. This keeps a shared counter instead.
let lockCount = 0

export function lockScroll() {
  lockCount += 1
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden'
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = ''
  }
}
