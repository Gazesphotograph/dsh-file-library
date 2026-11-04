import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const css = source.match(/const CSS = `([\s\S]*?)`/u)[1]
const theme = await readFile(new URL('./fixtures/theme-palette.js', import.meta.url), 'utf8')
const palette = JSON.parse(theme.match(/var design_platform_css_default = ("(?:[^"\\]|\\.)*");/u)[1])
const light = {}, dark = {}
for (const [, selector, body] of palette.matchAll(/([^{}]+)\{([^{}]+)\}/gu)) {
  const variables = Object.fromEntries(body.split(';').filter(Boolean).map((part) => { const at = part.indexOf(':'); return [part.slice(0, at), part.slice(at + 1)] }))
  if (selector === 'body') { Object.assign(light, variables); Object.assign(dark, variables) }
  if (selector === 'body[data-ds-dark-theme]') Object.assign(dark, variables)
}
function resolved(value, tokens) {
  const match = /^var\((--[a-z0-9-]+)\)$/u.exec(value)
  if (!match) return value
  assert.ok(tokens[match[1]], `defined ${match[1]}`)
  return resolved(tokens[match[1]], tokens)
}
function declarations(selector) {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/gu)].find((match) => match[1].trim() === selector)
  assert.ok(rule, selector)
  return Object.fromEntries(rule[2].split(';').filter(Boolean).map((part) => { const at = part.indexOf(':'); return [part.slice(0, at), part.slice(at + 1)] }))
}
function luminance(value) {
  assert.match(value, /^#(?:[\da-f]{3}|[\da-f]{6})$/iu)
  let hex = value.slice(1)
  if (hex.length === 3) hex = [...hex].map((part) => part + part).join('')
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}
function contrast(a, b) { const one = luminance(a), two = luminance(b); return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05) }

test('all plugin alias variables exist in the actual native light and dark palettes', () => {
  const aliases = new Set([...css.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/gu)].map((match) => match[1]))
  for (const [mode, tokens] of [['light', light], ['dark', dark]]) for (const alias of aliases) assert.ok(tokens[alias], `${mode}: ${alias}`)
})

test('primary button and semantic badge text keep readable native contrast in both themes', () => {
  for (const [mode, tokens] of [['light', light], ['dark', dark]]) {
    for (const selector of ['.flb-btnPrimary', '.flb-badgeMod', '.flb-badgeSame']) {
      const rule = declarations(selector)
      const ratio = contrast(resolved(rule.background, tokens), resolved(rule.color, tokens))
      assert.ok(ratio >= 4.5, `${mode} ${selector}: ${ratio.toFixed(2)}:1`)
    }
  }
})
