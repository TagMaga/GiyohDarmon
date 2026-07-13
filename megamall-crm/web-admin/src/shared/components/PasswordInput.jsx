import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * PasswordInput — password field with a show/hide toggle.
 *
 * Deliberately does not impose one visual style: pass `className` for
 * Tailwind `.input`-class fields, or `style` for the bespoke inline-styled
 * fields elsewhere in the app (dark panels, borderless underline fields).
 * Either way, the component reserves room for the eye button and never lets
 * text run under it.
 *
 * Hidden by default. The eye button is a real <button> (native keyboard
 * support, no tabIndex tricks) with an accessible label that flips between
 * "Показать пароль" / "Скрыть пароль".
 *
 * Props:
 *   value, onChange           — controlled input, as usual
 *   className {string}        — Tailwind classes (e.g. 'input')
 *   style     {object}        — inline style object (bespoke-themed fields)
 *   theme     {'light'|'dark'} — icon color; use 'dark' on dark backgrounds
 *   wrapperClassName {string}
 *   wrapperStyle     {object}
 *   inputRef  {ref}
 *   ...rest   — passed straight through to <input> (id, name, placeholder,
 *               required, disabled, autoComplete, onFocus, onBlur, onKeyDown, ...)
 */
export default function PasswordInput({
  value,
  onChange,
  className = '',
  style,
  theme = 'light',
  wrapperClassName = 'relative',
  wrapperStyle,
  inputRef,
  ...rest
}) {
  const [visible, setVisible] = useState(false)
  const iconClass = theme === 'dark'
    ? 'text-slate-400 hover:text-white'
    : 'text-slate-400 hover:text-slate-600'

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <input
        ref={inputRef}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={className ? `${className} pr-11` : undefined}
        style={style ? { ...style, paddingRight: 40 } : undefined}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center transition-colors ${iconClass}`}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
